"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Category, Product } from "@/types/database";
import { findSibling } from "@/lib/categories";
import { TARGETS, type ImportPlan, type ImportRow, type Target, buildRows, categoryFor, initialMapping, planImport } from "@/lib/import";
import { stockOf } from "@/lib/inventory";
import { productTitle } from "@/lib/fields";
import CoachTip from "@/components/CoachTip";
import OwnerOnly from "@/components/OwnerOnly";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { IconArrowLeft, IconCheck, IconTable, IconX, Spinner } from "@/components/ui/Icons";

type Sheet = { name: string; headers: string[]; rows: Record<string, unknown>[] };
type Existing = "update" | "skip";

/** Importar Excel: elegir archivo → decir qué es cada columna → ver qué pasará → importar por tandas. */
export default function ImportPage() {
  const supabase = createClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [variantIds, setVariantIds] = useState<Set<string>>(new Set());
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetIx, setSheetIx] = useState(0);
  const [fileName, setFileName] = useState("");
  const [reading, setReading] = useState(false);
  const [mapping, setMapping] = useState<Record<string, Target>>({});
  const [existing, setExisting] = useState<Existing>("update");
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ created: number; updated: number; cats: number; skipped: number } | null>(null);

  async function loadInventory() {
    const [c, p, v] = await Promise.all([
      supabase.from("categories").select("*").order("name"),
      supabase.from("products").select("*").is("deleted_at", null),
      supabase.from("product_variants").select("product_id"),
    ]);
    setCategories(c.data ?? []);
    setProducts((p.data ?? []) as Product[]);
    setVariantIds(new Set((v.data ?? []).map((x) => x.product_id)));
  }
  useEffect(() => {
    loadInventory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setReading(true);
    setResult(null);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const list: Sheet[] = wb.SheetNames.map((name) => {
        const ws = wb.Sheets[name];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
        const headers = rows.length ? Object.keys(rows[0]) : [];
        return { name, headers, rows: rows.filter((r) => Object.values(r).some((v) => v !== "" && v !== null)) };
      }).filter((s) => s.rows.length);
      if (!list.length) return toast("error", "La planilla está vacía o no tiene encabezados en la primera fila.");
      setSheets(list);
      setSheetIx(0);
      setFileName(file.name);
      setMapping(initialMapping(list[0].headers));
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "No se pudo leer el archivo");
    } finally {
      setReading(false);
    }
  }
  function pickSheet(ix: number) {
    setSheetIx(ix);
    setMapping(initialMapping(sheets[ix].headers));
  }

  const sheet = sheets[sheetIx];
  const rows = useMemo<ImportRow[]>(() => (sheet ? buildRows(sheet.rows, mapping) : []), [sheet, mapping]);
  const plan = useMemo<ImportPlan | null>(() => (rows.length ? planImport(rows, products, categories) : null), [rows, products, categories]);
  const hasName = Object.values(mapping).includes("nombre");
  const toDo = plan ? plan.creates.length + (existing === "update" ? plan.updates.length : 0) : 0;

  async function run() {
    if (!plan || !sheet) return;
    const ok = await confirm({
      title: `¿Importar ${toDo} producto${toDo === 1 ? "" : "s"}?`,
      body: `${plan.creates.length} nuevos${plan.updates.length ? `, ${plan.updates.length} que ya existen (${existing === "update" ? "se actualizan precio y stock" : "se dejan como están"})` : ""}${plan.newCategories.length ? ` y ${plan.newCategories.length} categoría${plan.newCategories.length === 1 ? "" : "s"} nueva${plan.newCategories.length === 1 ? "" : "s"}` : ""}. Se puede deshacer producto por producto desde la papelera.`,
      confirmLabel: "Importar",
    });
    if (!ok) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    setBusy({ done: 0, total: toDo });
    let cats = [...categories];
    let created = 0, updated = 0, newCats = 0;
    try {
      // 1) Categorías que faltan (principal y subcategoría)
      for (const nc of plan.newCategories) {
        let top = findSibling(cats, null, nc.top);
        if (!top) {
          const { data, error } = await supabase.from("categories").insert({ user_id: user.id, name: nc.top.trim(), parent_id: null }).select().single();
          if (error) throw error;
          top = data as Category;
          cats = [...cats, top];
          newCats++;
        }
        if (nc.sub && !findSibling(cats, top.id, nc.sub)) {
          const { data, error } = await supabase.from("categories").insert({ user_id: user.id, name: nc.sub.trim(), parent_id: top.id }).select().single();
          if (error) throw error;
          cats = [...cats, data as Category];
          newCats++;
        }
      }
      // 2) Productos nuevos, por tandas de 100 (la base rellena el negocio)
      const inserts = plan.creates.map((r) => ({
        user_id: user.id,
        category_id: categoryFor(cats, r)?.id ?? null,
        status: "confirmed" as const,
        data: { ...r.data, stock: r.data.stock ?? 0 },
        ai_meta: { etiqueta: `Importado de ${fileName}` },
        min_stock: r.min_stock,
        expires_at: r.expires_at,
      }));
      for (let i = 0; i < inserts.length; i += 100) {
        const chunk = inserts.slice(i, i + 100);
        const { data, error } = await supabase.from("products").insert(chunk).select("id,data");
        if (error) throw error;
        created += chunk.length;
        // Stock inicial como entrada, para que Ventas y movimientos lo explique
        const moves = (data ?? []).filter((p) => Number(p.data.stock) > 0).map((p) => ({ user_id: user.id, product_id: p.id, product_name: productTitle(p.data) || null, tipo: "entrada" as const, cantidad: Number(p.data.stock), motivo: "importado de Excel", stock_resultante: Number(p.data.stock) }));
        if (moves.length) await supabase.from("stock_movements").insert(moves);
        setBusy({ done: created + updated, total: toDo });
      }
      // 3) Los que ya existen: precio, costo, código y stock (el stock de productos con variantes no se toca)
      if (existing === "update") {
        for (const u of plan.updates) {
          const p = u.product;
          const next = { ...p.data };
          for (const k of ["precio", "precio_compra", "precio_mayorista", "unidades_por_paquete", "marca", "codigo_barras", "descripcion"]) if (u.row.data[k] !== undefined && u.row.data[k] !== "") next[k] = u.row.data[k];
          const canStock = !variantIds.has(p.id) && u.row.data.stock !== undefined;
          const before = stockOf(p) ?? 0;
          const after = canStock ? Number(u.row.data.stock) : before;
          if (canStock) next.stock = after;
          const patch: Partial<Product> = { data: next };
          if (u.row.min_stock !== null) patch.min_stock = u.row.min_stock;
          if (u.row.expires_at) patch.expires_at = u.row.expires_at;
          const cat = categoryFor(cats, u.row);
          if (cat && !p.category_id) patch.category_id = cat.id;
          const { error } = await supabase.from("products").update(patch).eq("id", p.id);
          if (error) throw error;
          if (canStock && after !== before) await supabase.from("stock_movements").insert({ user_id: user.id, product_id: p.id, product_name: productTitle(next) || null, tipo: "ajuste", cantidad: Math.abs(after - before), motivo: `${after > before ? "+" : "−"}${Math.abs(after - before)} · importado de Excel`, stock_resultante: after });
          updated++;
          if (updated % 10 === 0) setBusy({ done: created + updated, total: toDo });
        }
      }
      navigator.vibrate?.(30);
      setResult({ created, updated, cats: newCats, skipped: plan.skipped.length + (existing === "skip" ? plan.updates.length : 0) });
      setSheets([]);
      await loadInventory();
    } catch (e) {
      toast("error", `Se importaron ${created + updated} y hubo un error: ${e instanceof Error ? e.message : "desconocido"}`);
      await loadInventory();
    } finally {
      setBusy(null);
    }
  }

  return (
    <OwnerOnly>
      <div className={`mx-auto max-w-3xl space-y-4 ${sheet && !busy ? "has-action" : ""}`}>
        <header className="animate-in">
          <Link href="/settings" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"><IconArrowLeft size={16} /> Ajustes</Link>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Importar desde Excel</h1>
          <p className="text-sm text-slate-500">Trae tu inventario desde una planilla (.xlsx o .csv). Tú dices qué es cada columna y ves qué pasará antes de importar.</p>
        </header>
        <CoachTip screen="import" title="Tres pasos">
          <b>1.</b> Elige el archivo (la primera fila deben ser los títulos: Nombre, Precio, Stock…). <b>2.</b> Revisa a qué dato va cada columna. <b>3.</b> Mira la vista previa e importa. Si un producto ya existe (mismo código o mismo nombre) se actualiza en vez de duplicarse.
        </CoachTip>

        {result && (
          <section className="animate-in rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900 ring-1 ring-emerald-200">
            <p className="font-bold">Listo: {result.created} producto{result.created === 1 ? "" : "s"} nuevo{result.created === 1 ? "" : "s"}{result.updated ? `, ${result.updated} actualizado${result.updated === 1 ? "" : "s"}` : ""}{result.cats ? `, ${result.cats} categoría${result.cats === 1 ? "" : "s"} nueva${result.cats === 1 ? "" : "s"}` : ""}{result.skipped ? ` · ${result.skipped} fila${result.skipped === 1 ? "" : "s"} sin importar` : ""}.</p>
            <Link href="/products" className="mt-1 inline-block font-semibold underline">Ver el inventario →</Link>
          </section>
        )}

        <section className="animate-in card space-y-3 p-4">
          <p className="text-sm font-bold text-ink">1 · El archivo</p>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand-300 bg-brand-50/50 px-4 py-6 text-sm font-semibold text-brand-800 hover:bg-brand-50">
            {reading ? <Spinner /> : <IconTable size={20} />} {fileName || "Elegir planilla (.xlsx, .xls o .csv)"}
            <input type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          {sheets.length > 1 && (
            <label className="block text-xs font-semibold uppercase text-slate-500">
              Hoja
              <select className="input mt-1 normal-case" value={sheetIx} onChange={(e) => pickSheet(Number(e.target.value))}>
                {sheets.map((s, i) => <option key={s.name} value={i}>{s.name} ({s.rows.length} filas)</option>)}
              </select>
            </label>
          )}
          <p className="text-xs text-slate-500">¿No tienes planilla? Descarga tu inventario en <Link href="/export" className="underline">Exportar a Excel</Link>, complétalo y vuelve a subirlo: las columnas ya vienen con los nombres correctos.</p>
        </section>

        {sheet && (
          <section className="animate-in card space-y-3 p-4">
            <p className="text-sm font-bold text-ink">2 · Qué es cada columna <span className="font-normal text-slate-500">· {sheet.rows.length} filas</span></p>
            {!hasName && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">Falta decir qué columna es el <b>Nombre del producto</b>.</p>}
            <ul className="divide-y divide-slate-100">
              {sheet.headers.map((h) => (
                <li key={h} className="grid grid-cols-1 items-center gap-1 py-2 sm:grid-cols-2 sm:gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink">{h}</span>
                    <span className="block truncate text-[11px] text-slate-400">ej.: {String(sheet.rows[0]?.[h] ?? "")}{sheet.rows[1] ? ` · ${String(sheet.rows[1]?.[h] ?? "")}` : ""}</span>
                  </span>
                  <select className={`input py-1.5 text-sm ${mapping[h] === "ignorar" ? "text-slate-400" : ""}`} value={mapping[h] ?? "otro"} onChange={(e) => setMapping({ ...mapping, [h]: e.target.value as Target })}>
                    {TARGETS.map((t) => <option key={t.key} value={t.key} disabled={t.key !== "otro" && t.key !== "ignorar" && mapping[h] !== t.key && Object.values(mapping).includes(t.key)}>{t.label}</option>)}
                  </select>
                </li>
              ))}
            </ul>
          </section>
        )}

        {sheet && plan && hasName && (
          <section className="animate-in card space-y-3 p-4">
            <p className="text-sm font-bold text-ink">3 · Qué va a pasar</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat n={plan.creates.length} label="nuevos" tone="emerald" />
              <Stat n={plan.updates.length} label="ya existen" tone="amber" />
              <Stat n={plan.skipped.length} label="sin importar" tone={plan.skipped.length ? "rose" : undefined} />
            </div>
            {plan.newCategories.length > 0 && (
              <p className="text-xs text-slate-600"><b>Categorías nuevas:</b> {plan.newCategories.map((c) => (c.sub ? `${c.top} › ${c.sub}` : c.top)).join(", ")}</p>
            )}
            {plan.updates.length > 0 && (
              <div className="rounded-xl bg-slate-50 p-3 text-sm">
                <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Con los que ya existen</p>
                <label className="flex items-center gap-2"><input type="radio" checked={existing === "update"} onChange={() => setExisting("update")} /> Actualizar precio, costo, código y stock con lo de la planilla</label>
                <label className="flex items-center gap-2"><input type="radio" checked={existing === "skip"} onChange={() => setExisting("skip")} /> Dejarlos como están (solo agregar los nuevos)</label>
                <p className="mt-1 text-[11px] text-slate-500">Los productos con variantes (tallas, colores…) no cambian de stock desde la planilla.</p>
              </div>
            )}
            {plan.skipped.length > 0 && (
              <details className="text-xs text-slate-600">
                <summary className="cursor-pointer font-semibold text-rose-700">Filas que no se importan ({plan.skipped.length})</summary>
                <ul className="mt-1 max-h-40 overflow-y-auto">
                  {plan.skipped.slice(0, 50).map((r) => <li key={r.n}>Fila {r.n + 1}: {r.error}{r.nombre ? ` · ${r.nombre}` : ""}</li>)}
                </ul>
              </details>
            )}
            <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-500">
                  <tr><th className="px-2 py-1.5">Producto</th><th className="px-2 py-1.5">Categoría</th><th className="px-2 py-1.5 text-right">Precio</th><th className="px-2 py-1.5 text-right">Stock</th><th className="px-2 py-1.5">Qué pasa</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...plan.creates.map((r) => ({ r, what: "Nuevo" })), ...plan.updates.map((u) => ({ r: u.row, what: existing === "update" ? `Actualiza (${u.motivo})` : "Se deja" }))].slice(0, 30).map(({ r, what }) => (
                    <tr key={r.n}>
                      <td className="max-w-[10rem] truncate px-2 py-1 font-medium text-ink">{r.nombre}</td>
                      <td className="max-w-[8rem] truncate px-2 py-1 text-slate-500">{r.categoria}{r.subcategoria ? ` › ${r.subcategoria}` : ""}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{r.data.precio ?? "—"}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{r.data.stock ?? "—"}</td>
                      <td className={`px-2 py-1 ${what === "Nuevo" ? "text-emerald-700" : "text-amber-700"}`}>{what}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {toDo > 30 && <p className="px-2 py-1 text-[11px] text-slate-400">…y {toDo - 30} más</p>}
            </div>
          </section>
        )}

        {busy && (
          <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-6">
            <div className="w-full max-w-xs rounded-3xl bg-white p-5 text-center shadow-2xl">
              <Spinner />
              <p className="mt-2 font-bold text-ink">Importando… {busy.done} de {busy.total}</p>
              <p className="text-xs text-slate-500">No cierres esta pantalla.</p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-brand-600 transition-all" style={{ width: `${busy.total ? Math.round((busy.done / busy.total) * 100) : 0}%` }} /></div>
            </div>
          </div>
        )}

        {sheet && !busy && (
          <div className="sticky-action">
            <div className="flex gap-2">
              <button onClick={() => { setSheets([]); setFileName(""); }} className="btn-secondary btn-lg"><IconX size={18} /></button>
              <button onClick={run} disabled={!hasName || toDo === 0} className="btn-primary btn-lg flex-1"><IconCheck size={20} /> Importar {toDo} producto{toDo === 1 ? "" : "s"}</button>
            </div>
          </div>
        )}
      </div>
    </OwnerOnly>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone?: "emerald" | "amber" | "rose" }) {
  const c = tone === "emerald" ? "text-emerald-700" : tone === "amber" ? "text-amber-700" : tone === "rose" ? "text-rose-700" : "text-slate-500";
  return (
    <div className="rounded-xl bg-slate-50 py-2">
      <p className={`text-xl font-bold tabular-nums ${c}`}>{n}</p>
      <p className="text-[11px] text-slate-500">{label}</p>
    </div>
  );
}
