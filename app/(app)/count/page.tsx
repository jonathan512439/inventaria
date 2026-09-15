"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Category, Product, ProductVariant, StockCount } from "@/types/database";
import { getDescendantIds } from "@/lib/categories";
import { SUMMARY_COLS, fromSummary, stockOf } from "@/lib/inventory";
import { categoryColor } from "@/lib/colors";
import BarcodeCamera from "@/components/BarcodeCamera";
import CoachTip from "@/components/CoachTip";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { IconArrowLeft, IconCheck, IconChevronRight, IconTag, IconX, Spinner } from "@/components/ui/Icons";

interface Row {
  key: string;
  productId: string;
  variantId: string | null;
  name: string;
  variant: string | null;
  code: string | null;
  expected: number;
}

const REASONS = ["Conteo físico", "Merma o rotura", "Robo o pérdida", "Error de registro", "Devolución"];

/** Toma de inventario física: contar una categoría, ver diferencias y ajustar con motivo. */
export default function CountPage() {
  const supabase = createClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [categories, setCategories] = useState<Category[]>([]);
  const [history, setHistory] = useState<StockCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [top, setTop] = useState<Category | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [onlyPending, setOnlyPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastHit, setLastHit] = useState<string | null>(null);
  // Código leído que no pertenece a ningún producto de esta categoría: se puede asignar aquí mismo
  const [unknown, setUnknown] = useState<{ code: string; note: string } | null>(null);
  const [assignQ, setAssignQ] = useState("");

  useEffect(() => {
    (async () => {
      const [c, h] = await Promise.all([
        supabase.from("categories").select("*").order("name"),
        supabase.from("stock_counts").select("*").order("started_at", { ascending: false }).limit(10),
      ]);
      setCategories(c.data ?? []);
      setHistory((h.data ?? []) as StockCount[]);
      setLoading(false);
    })();
  }, [supabase]);

  const tops = useMemo(() => categories.filter((c) => !c.parent_id), [categories]);

  async function begin(cat: Category) {
    setTop(cat);
    setRows(null);
    setCounted({});
    setReason({});
    setUnknown(null);
    // "none" = los productos que quedaron sin categoría (la IA no siempre acierta y no deben perderse)
    let query = supabase.from("product_summaries").select(SUMMARY_COLS).eq("status", "confirmed").order("nombre");
    if (cat.id === "none") {
      const valid = categories.map((c) => c.id);
      query = valid.length ? query.or(`category_id.is.null,category_id.not.in.(${valid.join(",")})`) : query.is("category_id", null);
    } else {
      query = query.in("category_id", getDescendantIds(categories, cat.id));
    }
    const { data: ps } = await query;
    const products: Product[] = (ps ?? []).map(fromSummary);
    const { data: vs } = products.length ? await supabase.from("product_variants").select("*").in("product_id", products.map((p) => p.id)).order("created_at") : { data: [] as ProductVariant[] };
    const byProduct = new Map<string, ProductVariant[]>();
    ((vs ?? []) as ProductVariant[]).forEach((v) => byProduct.set(v.product_id, [...(byProduct.get(v.product_id) ?? []), v]));
    const list: Row[] = [];
    products.forEach((p) => {
      const name = String(p.data.nombre || "Sin nombre");
      const variants = byProduct.get(p.id);
      if (variants?.length) variants.forEach((v) => list.push({ key: v.id, productId: p.id, variantId: v.id, name, variant: v.label, code: v.codigo_barras || String(p.data.codigo_barras || "") || null, expected: v.stock }));
      else list.push({ key: p.id, productId: p.id, variantId: null, name, variant: null, code: String(p.data.codigo_barras || "") || null, expected: stockOf(p) ?? 0 });
    });
    setRows(list);
  }

  function addOne(key: string) {
    setCounted((c) => ({ ...c, [key]: String((parseInt(c[key] ?? "0", 10) || 0) + 1) }));
    setLastHit(key);
    setTimeout(() => setLastHit(null), 1200);
  }

  /** Cada lectura del escáner suma 1 al producto de ese código; si el código es nuevo, pregunta de quién es. */
  async function onCode(code: string) {
    if (!rows) return;
    const hit = rows.find((r) => r.code && r.code.toUpperCase() === code.toUpperCase());
    if (hit) return addOne(hit.key);
    // ¿Existe en otra categoría del inventario?
    let note = "Este código todavía no está guardado en ningún producto.";
    try {
      const res = await fetch(`/api/barcode?code=${encodeURIComponent(code)}`);
      const json = (await res.json().catch(() => ({}))) as { found?: string; product?: { data: Record<string, unknown> } };
      if (json.found === "own" && json.product) note = `Ese código es de «${String(json.product.data?.nombre ?? "otro producto")}», que está en otra categoría.`;
    } catch {
      /* sin conexión: se ofrece asignarlo igual */
    }
    setUnknown({ code, note });
    setAssignQ("");
  }

  /** Guarda el código leído en el producto (o variante) elegido y lo cuenta. */
  async function assignCode(r: Row) {
    if (!unknown) return;
    const code = unknown.code;
    if (r.variantId) {
      const { error } = await supabase.from("product_variants").update({ codigo_barras: code }).eq("id", r.variantId);
      if (error) return toast("error", /product_variants_codigo/.test(error.message) ? "Ese código ya está en otra variante" : error.message);
    } else {
      const { data: p } = await supabase.from("products").select("data").eq("id", r.productId).maybeSingle();
      if (!p) return toast("error", "No se encontró el producto");
      const keys = Object.keys(p.data);
      const key = ["codigo_barras", "codigo", "sku", "barcode", "ean"].map((k) => keys.find((x) => x.toLowerCase() === k)).find(Boolean) ?? "codigo_barras";
      const { error } = await supabase.from("products").update({ data: { ...p.data, [key]: code } }).eq("id", r.productId);
      if (error) return toast("error", error.message);
    }
    setRows((rs) => (rs ? rs.map((x) => (x.key === r.key ? { ...x, code } : x)) : rs));
    setUnknown(null);
    addOne(r.key);
    navigator.vibrate?.(20);
    toast("success", `Código guardado en «${r.name}${r.variant ? ` · ${r.variant}` : ""}». La próxima vez se reconocerá solo.`);
  }

  const parsed = (r: Row) => (counted[r.key] === undefined || counted[r.key] === "" ? null : Math.max(0, parseInt(counted[r.key], 10) || 0));
  const stats = useMemo(() => {
    if (!rows) return { done: 0, diffs: 0, units: 0 };
    let done = 0, diffs = 0, units = 0;
    rows.forEach((r) => {
      const c = parsed(r);
      if (c === null) return;
      done++;
      if (c !== r.expected) {
        diffs++;
        units += Math.abs(c - r.expected);
      }
    });
    return { done, diffs, units };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, counted]);

  async function close() {
    if (!rows || !top) return;
    const toApply = rows.filter((r) => parsed(r) !== null);
    if (!toApply.length) return toast("info", "Escribe cuántas unidades hay de al menos un producto");
    const faltan = toApply.filter((r) => (parsed(r) ?? 0) < r.expected).length;
    const sobran = toApply.filter((r) => (parsed(r) ?? 0) > r.expected).length;
    const ok = await confirm({
      title: "¿Terminamos el conteo?",
      body: stats.diffs
        ? "Vamos a dejar el stock igual a lo que contaste. Los productos que coincidían no se tocan."
        : "Todo coincidió con lo que dice la app: no hay nada que corregir. Igual queda anotado que contaste.",
      details: [
        { label: "Productos contados", value: String(toApply.length) },
        { label: "Coinciden", value: String(toApply.length - stats.diffs), tone: "ok" },
        ...(faltan ? [{ label: "Falta mercadería", value: `${faltan} producto${faltan === 1 ? "" : "s"}`, tone: "danger" as const }] : []),
        ...(sobran ? [{ label: "Hay de más", value: `${sobran} producto${sobran === 1 ? "" : "s"}`, tone: "warn" as const }] : []),
        ...(stats.units ? [{ label: "Diferencia total", value: `${stats.units} unidades`, tone: "warn" as const }] : []),
      ],
      confirmLabel: stats.diffs ? `Sí, corregir ${stats.diffs}` : "Terminar",
      cancelLabel: "Seguir contando",
      tone: "success",
    });
    if (!ok) return;
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: count, error } = await supabase
      .from("stock_counts")
      .insert({ user_id: user!.id, category_id: top.id === "none" ? null : top.id, category_name: top.name, items: toApply.length, differences: stats.diffs, diff_units: stats.units, closed_at: new Date().toISOString() })
      .select()
      .single();
    if (error || !count) {
      setSaving(false);
      return toast("error", error?.message ?? "No se pudo guardar el conteo");
    }
    await supabase.from("stock_count_items").insert(
      toApply.map((r) => ({ count_id: count.id, user_id: user!.id, product_id: r.productId, variant_id: r.variantId, product_name: r.name, variant_label: r.variant, expected: r.expected, counted: parsed(r), reason: parsed(r) !== r.expected ? reason[r.key] ?? REASONS[0] : null }))
    );
    // Ajustes de stock con su movimiento
    for (const r of toApply) {
      const c = parsed(r)!;
      if (c === r.expected) continue;
      if (r.variantId) await supabase.from("product_variants").update({ stock: c }).eq("id", r.variantId);
      else {
        const { data: p } = await supabase.from("products").select("data").eq("id", r.productId).maybeSingle();
        if (p) {
          const keys = Object.keys(p.data);
          const key = ["stock", "cantidad", "existencias"].map((k) => keys.find((x) => x.toLowerCase() === k)).find(Boolean) ?? "stock";
          await supabase.from("products").update({ data: { ...p.data, [key]: c } }).eq("id", r.productId);
        }
      }
      await supabase.from("stock_movements").insert({
        user_id: user!.id,
        product_id: r.productId,
        product_name: r.name,
        variant_id: r.variantId,
        variant_label: r.variant,
        tipo: "ajuste",
        cantidad: Math.abs(c - r.expected),
        motivo: `${c > r.expected ? "+" : "−"}${Math.abs(c - r.expected)} · ${reason[r.key] ?? REASONS[0]}`,
        stock_resultante: c,
        count_id: count.id,
      });
    }
    setSaving(false);
    navigator.vibrate?.(30);
    toast("success", `Listo: contaste ${toApply.length} producto${toApply.length === 1 ? "" : "s"} y se corrigieron ${stats.diffs}`);
    setHistory((h) => [count as StockCount, ...h]);
    setTop(null);
    setRows(null);
  }

  const visibleRows = rows?.filter((r) => !onlyPending || parsed(r) === null) ?? [];

  if (top) {
    const col = categoryColor(top.name);
    return (
      <div className="has-action mx-auto max-w-3xl space-y-4">
        <header className="animate-in">
          <button
            onClick={async () => {
              if (stats.done) {
                const ok = await confirm({
                  title: "¿Salir sin terminar?",
                  body: `Contaste ${stats.done} producto${stats.done === 1 ? "" : "s"} y todavía no se guardó nada. Si sales, se pierde ese avance.`,
                  confirmLabel: "Salir y perder lo contado",
                  cancelLabel: "Seguir contando",
                  tone: "danger",
                });
                if (!ok) return;
              }
              setTop(null);
              setRows(null);
            }}
            className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"
          >
            <IconArrowLeft size={16} /> Elegir otra categoría
          </button>
          <div className="flex items-center gap-3">
            <span className={`grid h-12 w-12 place-items-center rounded-2xl text-2xl ring-1 ${col.bg} ${col.ring}`}>{top.icon || "🏷️"}</span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-ink">Contando {top.name}</h1>
                    <p className="text-sm text-slate-500">{rows ? `Ya contaste ${stats.done} de ${rows.length}${stats.diffs ? ` · ${stats.diffs} no coincide${stats.diffs === 1 ? "" : "n"}` : ""}` : "Cargando…"}</p>
            </div>
          </div>
        </header>

        {!rows ? (
          <ListSkeleton rows={6} />
        ) : (
          <>
            <div className="animate-in space-y-2">
              <BarcodeCamera onCode={onCode} label="Escanear para contar (+1 por lectura)" />
              {rows.some((r) => !r.code) && (
                <p className="rounded-xl bg-slate-100 px-3 py-2 text-[11px] text-slate-600">
                  {rows.filter((r) => !r.code).length} de {rows.length} productos todavía no tienen su código guardado. Escanéalos: la app te preguntará de cuál es y lo aprende para la próxima.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white p-2 shadow-card ring-1 ring-slate-900/10">
                <button onClick={() => setOnlyPending((v) => !v)} className={`chip ${onlyPending ? "chip-active" : ""}`}>
                  {onlyPending ? "Viendo solo los que faltan" : "Ocultar los que ya conté"}
                  <span className="opacity-70">{rows.length - stats.done}</span>
                </button>
                <span className="min-w-0 flex-1 text-[11px] text-slate-500">
                  {onlyPending
                    ? `Estás viendo los ${rows.length - stats.done} productos que aún no has contado.`
                    : `Estás viendo los ${rows.length} productos de esta categoría. Toca el botón para ver solo los que te faltan.`}
                </span>
              </div>
            </div>
            {unknown && (
              <div className="animate-in rounded-2xl border-2 border-amber-300 bg-amber-50 p-3">
                <div className="flex items-start gap-2">
                  <IconTag size={18} className="mt-0.5 shrink-0 text-amber-700" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-amber-900">Código nuevo: <span className="font-mono">{unknown.code}</span></p>
                    <p className="text-xs text-amber-800">{unknown.note} Elige de qué producto es y lo guardamos para siempre.</p>
                  </div>
                  <button onClick={() => setUnknown(null)} className="btn-ghost btn-sm" aria-label="Cerrar"><IconX size={16} /></button>
                </div>
                <input className="input mt-2 py-2" placeholder="Buscar el producto por nombre…" value={assignQ} onChange={(e) => setAssignQ(e.target.value)} autoFocus />
                <ul className="mt-1.5 max-h-56 space-y-1 overflow-y-auto">
                  {rows
                    .filter((r) => !assignQ.trim() || `${r.name} ${r.variant ?? ""}`.toLowerCase().includes(assignQ.trim().toLowerCase()))
                    .slice(0, 20)
                    .map((r) => (
                      <li key={r.key}>
                        <button onClick={() => assignCode(r)} className="flex w-full items-center gap-2 rounded-xl bg-white px-3 py-2 text-left ring-1 ring-amber-200 hover:ring-amber-400">
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{r.name}{r.variant ? <span className="text-violet-800"> · {r.variant}</span> : null}</span>
                          {r.code ? <span className="shrink-0 text-[10px] text-slate-400">ya tiene código</span> : null}
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            )}

            <ul className="stagger space-y-1.5">
              {visibleRows.map((r) => {
                const c = parsed(r);
                const diff = c === null ? null : c - r.expected;
                return (
                  <li key={r.key} className={`rounded-2xl bg-white p-3 shadow-card ring-1 transition ${lastHit === r.key ? "ring-emerald-500" : diff === null ? "ring-slate-900/10" : diff === 0 ? "ring-emerald-300" : "ring-amber-400"}`}>
                    <div className="flex items-center gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-ink">{r.name}{r.variant ? <span className="text-violet-800"> · {r.variant}</span> : null}</span>
                        <span className="block text-xs text-slate-500">La app dice <b className="text-ink">{r.expected}</b>{diff !== null && diff !== 0 ? <span className={diff > 0 ? "text-emerald-700" : "text-rose-700"}> · {diff > 0 ? `hay ${diff} de más` : `faltan ${-diff}`}</span> : diff === 0 ? <span className="text-emerald-700"> · coincide ✓</span> : null}</span>
                      </span>
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        placeholder="¿cuántos?"
                        className="input w-24 py-2 text-center text-lg font-bold tabular-nums"
                        value={counted[r.key] ?? ""}
                        onChange={(e) => setCounted({ ...counted, [r.key]: e.target.value })}
                      />
                    </div>
                    {diff !== null && diff !== 0 && (
                      <select className="input mt-2 py-1.5 text-sm" value={reason[r.key] ?? REASONS[0]} onChange={(e) => setReason({ ...reason, [r.key]: e.target.value })}>
                        {REASONS.map((x) => <option key={x}>{x}</option>)}
                      </select>
                    )}
                  </li>
                );
              })}
              {visibleRows.length === 0 && <li className="py-6 text-center text-sm text-slate-500">{rows.length ? "Todo contado" : "Esta categoría no tiene productos en inventario"}</li>}
            </ul>
            <div className="sticky-action">
              <button onClick={close} disabled={saving || !stats.done} className="btn-success btn-lg w-full">
                {saving ? <Spinner /> : <IconCheck size={20} />} Terminar y corregir {stats.diffs} producto{stats.diffs === 1 ? "" : "s"}
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <header className="animate-in">
        <Link href="/products" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"><IconArrowLeft size={16} /> Mi inventario</Link>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Contar lo que tengo</h1>
        <p className="text-sm text-slate-500">Revisa cuántas unidades hay de verdad en el estante. Si no coincide con lo que dice la app, se corrige al instante y queda anotado.</p>
      </header>
      <CoachTip screen="count" title="Así funciona">
        Elige una categoría y ve producto por producto: escribe cuántos hay en el estante (o escanea cada unidad, que suma de a uno). Lo que no escribas se queda como está. Al terminar, la app corrige sola los que no coincidían.
      </CoachTip>

      {loading ? (
        <ListSkeleton rows={4} />
      ) : (
        <>
          <ul className="stagger grid grid-cols-1 gap-2 sm:grid-cols-2">
            {[...tops, { id: "none", user_id: "", parent_id: null, name: "Sin categoría", icon: "🏷️", min_stock_default: null, alerts_off: false, created_at: "" } as Category].map((c) => {
              const col = categoryColor(c.name);
              return (
                <li key={c.id}>
                  <button onClick={() => begin(c)} className="press flex w-full items-center gap-3 rounded-2xl bg-white p-3 text-left shadow-card ring-1 ring-slate-900/10 hover:ring-brand-400">
                    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xl ring-1 ${col.bg} ${col.ring}`}>{c.icon || "🏷️"}</span>
                    <span className="min-w-0 flex-1 truncate font-semibold text-ink">{c.name}</span>
                    <IconChevronRight className="text-slate-300" />
                  </button>
                </li>
              );
            })}
          </ul>

          {history.length > 0 && (
            <section className="animate-in card p-3">
              <h2 className="mb-2 text-sm font-bold text-ink">Veces que contaste</h2>
              <ul className="divide-y divide-slate-100 text-sm">
                {history.map((h) => (
                  <li key={h.id} className="flex items-center gap-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-ink">{h.category_name ?? "Categoría"}</span>
                      <span className="block text-xs text-slate-500">{new Date(h.started_at).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · {h.items} producto{h.items === 1 ? "" : "s"} contados</span>
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${h.differences ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>{h.differences ? `${h.differences} corregidos · ${h.diff_units} unid.` : "todo coincidía"}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
