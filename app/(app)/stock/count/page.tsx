"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Category, Product, ProductVariant, StockCount } from "@/types/database";
import { getDescendantIds } from "@/lib/categories";
import { SUMMARY_COLS, fromSummary, stockOf } from "@/lib/inventory";
import { productTitle } from "@/lib/fields";
import { categoryColor } from "@/lib/colors";
import BarcodeCamera from "@/components/BarcodeCamera";
import { ChipFilter, EmptyState, ListRow, ScreenHeader, Stat } from "@/components/ui/Screen";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { applyCount, newOpId } from "@/lib/data/ops";
import { friendlyError } from "@/lib/errors";
import { IconArrowLeft, IconCheck, IconChevronRight, IconClipboard, IconSearch, IconTag, IconX, Spinner } from "@/components/ui/Icons";

interface Row {
  key: string;
  productId: string;
  variantId: string | null;
  name: string;
  variant: string | null;
  code: string | null;
  expected: number;
}

type Show = "all" | "pending" | "diff";

const REASONS = ["Conteo físico", "Merma o rotura", "Robo o pérdida", "Error de registro", "Devolución"];
const NONE: Category = { id: "none", user_id: "", parent_id: null, name: "Sin categoría", icon: "🏷️", min_stock_default: null, alerts_off: false, created_at: "" } as Category;

/**
 * Contar (C7.5 · RECONSTRUCCION_VISUAL.md §3.2, F20): elegir categoría → contar con escáner (+1 por lectura) o
 * escribiendo cuántos hay → ver diferencias → corregir con `apply_count` (una operación: acta, diferencias y
 * ajustes sobre el stock real al cerrar). Lo que no se cuenta no se toca.
 */
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
  const [show, setShow] = useState<Show>("all");
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  // Id del conteo en curso (idempotencia): se renueva al guardarlo
  const [countId, setCountId] = useState(newOpId);
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

  const tops = useMemo(() => [...categories.filter((c) => !c.parent_id), NONE], [categories]);

  async function begin(cat: Category) {
    setTop(cat);
    setRows(null);
    setCounted({});
    setReason({});
    setUnknown(null);
    setShow("all");
    setQ("");
    // "none" = los productos que quedaron sin categoría (la IA no siempre acierta y no deben perderse)
    let query = supabase.from("product_summaries").select(SUMMARY_COLS).eq("status", "confirmed").order("nombre");
    if (cat.id === "none") {
      const valid = categories.map((c) => c.id);
      query = valid.length ? query.or(`category_id.is.null,category_id.not.in.(${valid.join(",")})`) : query.is("category_id", null);
    } else {
      query = query.in("category_id", getDescendantIds(categories, cat.id));
    }
    const { data: ps, error } = await query;
    if (error) {
      setTop(null);
      return toast("error", friendlyError(error));
    }
    const products: Product[] = (ps ?? []).map(fromSummary);
    const { data: vs } = products.length ? await supabase.from("product_variants").select("*").in("product_id", products.map((p) => p.id)).order("created_at") : { data: [] as ProductVariant[] };
    const byProduct = new Map<string, ProductVariant[]>();
    ((vs ?? []) as ProductVariant[]).forEach((v) => byProduct.set(v.product_id, [...(byProduct.get(v.product_id) ?? []), v]));
    const list: Row[] = [];
    products.forEach((p) => {
      const name = productTitle(p.data) || "Sin nombre";
      const variants = byProduct.get(p.id);
      if (variants?.length) variants.forEach((v) => list.push({ key: v.id, productId: p.id, variantId: v.id, name, variant: v.label, code: v.codigo_barras || String(p.data.codigo_barras || "") || null, expected: v.stock }));
      else list.push({ key: p.id, productId: p.id, variantId: null, name, variant: null, code: String(p.data.codigo_barras || "") || null, expected: stockOf(p) ?? 0 });
    });
    setRows(list);
  }

  function addOne(key: string) {
    setCounted((c) => ({ ...c, [key]: String((parseInt(c[key] ?? "0", 10) || 0) + 1) }));
    setLastHit(key);
    setTimeout(() => setLastHit((k) => (k === key ? null : k)), 1200);
  }

  /** Cada lectura del escáner suma 1 al producto de ese código; si el código es nuevo, pregunta de quién es. */
  async function onCode(code: string) {
    if (!rows) return;
    const hit = rows.find((r) => r.code && r.code.toUpperCase() === code.toUpperCase());
    if (hit) return addOne(hit.key);
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
      if (error) return toast("error", /product_variants_codigo/.test(error.message) ? "Ese código ya está en otra variante" : friendlyError(error));
    } else {
      // Columna del sistema (020): la base lo copia a `data` con la clave que ya use el producto
      const { error } = await supabase.from("products").update({ codigo_barras: code }).eq("id", r.productId);
      if (error) return toast("error", friendlyError(error));
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

  async function leave() {
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
  }

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
    let count: StockCount;
    try {
      const out = await applyCount(supabase, {
        id: countId,
        categoryId: top.id === "none" ? null : top.id,
        categoryName: top.name,
        rows: toApply.map((r) => ({ product_id: r.productId, variant_id: r.variantId, expected: r.expected, counted: parsed(r)!, reason: parsed(r) !== r.expected ? reason[r.key] ?? REASONS[0] : null })),
      });
      count = out.count;
    } catch (e) {
      setSaving(false);
      return toast("error", friendlyError(e));
    }
    setCountId(newOpId());
    setSaving(false);
    navigator.vibrate?.(30);
    toast("success", `Listo: contaste ${toApply.length} producto${toApply.length === 1 ? "" : "s"} y se corrigieron ${stats.diffs}`);
    setHistory((h) => [count as StockCount, ...h]);
    setTop(null);
    setRows(null);
  }

  // ---------- Contando una categoría ----------
  if (top) {
    const col = categoryColor(top.name);
    const term = q.trim().toLowerCase();
    const visible = (rows ?? []).filter((r) => {
      const c = parsed(r);
      if (show === "pending" && c !== null) return false;
      if (show === "diff" && (c === null || c === r.expected)) return false;
      return !term || `${r.name} ${r.variant ?? ""} ${r.code ?? ""}`.toLowerCase().includes(term);
    });
    return (
      <div className="has-action mx-auto max-w-3xl space-y-4">
        <header className="animate-in">
          <button type="button" onClick={leave} className="mb-2 inline-flex min-h-[44px] items-center gap-1 text-sm text-muted hover:text-brand-700">
            <IconArrowLeft size={16} /> Elegir otra categoría
          </button>
          <div className="flex items-center gap-3">
            <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-2xl ring-1 ${col.bg} ${col.ring}`}>{top.icon || "🏷️"}</span>
            <h1 className="min-w-0 flex-1 truncate text-2xl font-bold tracking-tight text-ink">Contando {top.name}</h1>
          </div>
        </header>

        {!rows ? (
          <ListSkeleton rows={6} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<IconClipboard size={28} />} title="No hay productos para contar" body="Esta categoría no tiene productos en inventario." action={<button type="button" onClick={() => setTop(null)} className="btn-secondary">Elegir otra categoría</button>} />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Contados" value={`${stats.done}/${rows.length}`} />
              <Stat label="No coinciden" value={stats.diffs} tone={stats.diffs ? "warn" : undefined} />
              <Stat label="Diferencia" value={stats.units} hint="unidades" tone={stats.units ? "warn" : undefined} />
            </div>

            <BarcodeCamera onCode={onCode} label="Escanear para contar (+1 por lectura)" />
            {rows.some((r) => !r.code) && (
              <p className="rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-600">
                {rows.filter((r) => !r.code).length} de {rows.length} productos todavía no tienen su código guardado. Escanéalos: la app te preguntará de cuál es y lo aprende para la próxima.
              </p>
            )}

            {unknown && (
              <div className="animate-in rounded-2xl border-2 border-warn-300 bg-warn-50 p-3">
                <div className="flex items-start gap-2">
                  <IconTag size={18} className="mt-0.5 shrink-0 text-warn-700" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-warn-900">Código nuevo: <span className="font-mono">{unknown.code}</span></p>
                    <p className="text-xs text-warn-800">{unknown.note} Elige de qué producto es y lo guardamos para siempre.</p>
                  </div>
                  <button type="button" onClick={() => setUnknown(null)} className="btn-ghost h-11 w-11 shrink-0 p-0" aria-label="Cerrar"><IconX size={18} /></button>
                </div>
                <input className="input mt-2 min-h-[44px]" placeholder="Buscar el producto por nombre…" value={assignQ} onChange={(e) => setAssignQ(e.target.value)} autoFocus />
                <ul className="mt-1.5 max-h-56 space-y-1 overflow-y-auto overscroll-contain">
                  {rows
                    .filter((r) => !assignQ.trim() || `${r.name} ${r.variant ?? ""}`.toLowerCase().includes(assignQ.trim().toLowerCase()))
                    .slice(0, 20)
                    .map((r) => (
                      <li key={r.key}>
                        <button type="button" onClick={() => assignCode(r)} className="flex min-h-[44px] w-full items-center gap-2 rounded-xl bg-white px-3 py-2 text-left ring-1 ring-warn-200 hover:ring-warn-400">
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{r.name}{r.variant ? <span className="text-violet-800"> · {r.variant}</span> : null}</span>
                          {r.code ? <span className="shrink-0 text-xs text-muted">ya tiene código</span> : null}
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            )}

            <div className="space-y-2">
              <div className="relative">
                <IconSearch size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
                <input className="input min-h-[44px] pl-11" placeholder="Buscar en esta categoría…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar en esta categoría" />
              </div>
              <ChipFilter<Show>
                value={[show]}
                onToggle={(v) => setShow((s) => (s === v ? "all" : v))}
                items={[
                  { value: "all", label: "Todos", count: rows.length },
                  { value: "pending", label: "Faltan contar", count: rows.length - stats.done },
                  { value: "diff", label: "No coinciden", count: stats.diffs, tone: "warn" },
                ]}
              />
            </div>

            <ul className="space-y-1.5">
              {visible.map((r) => {
                const c = parsed(r);
                const diff = c === null ? null : c - r.expected;
                return (
                  <li key={r.key} className={`rounded-2xl bg-white p-3 shadow-card ring-1 transition ${lastHit === r.key ? "ring-2 ring-ok-500" : diff === null ? "ring-slate-900/10" : diff === 0 ? "ring-ok-300" : "ring-warn-400"}`}>
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-ink">{r.name}{r.variant ? <span className="text-violet-800"> · {r.variant}</span> : null}</span>
                        <span className="block text-xs text-muted">
                          La app dice <b className="text-ink">{r.expected}</b>
                          {diff !== null && diff !== 0 ? <span className={diff > 0 ? "text-ok-700" : "text-danger-700"}> · {diff > 0 ? `hay ${diff} de más` : `faltan ${-diff}`}</span> : diff === 0 ? <span className="text-ok-700"> · coincide ✓</span> : null}
                        </span>
                      </span>
                      {c === null && (
                        <button type="button" onClick={() => setCounted({ ...counted, [r.key]: String(r.expected) })} className="btn-secondary btn-sm min-h-[44px] shrink-0" aria-label={`Hay ${r.expected}, coincide`}>
                          <IconCheck size={16} /> {r.expected}
                        </button>
                      )}
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        placeholder="¿cuántos?"
                        aria-label={`Cuántos hay de ${r.name}${r.variant ? ` ${r.variant}` : ""}`}
                        className="input min-h-[44px] w-24 shrink-0 text-center text-lg font-bold tabular-nums"
                        value={counted[r.key] ?? ""}
                        onChange={(e) => setCounted({ ...counted, [r.key]: e.target.value })}
                      />
                    </div>
                    {diff !== null && diff !== 0 && (
                      <select className="input mt-2 min-h-[44px] text-sm" value={reason[r.key] ?? REASONS[0]} onChange={(e) => setReason({ ...reason, [r.key]: e.target.value })} aria-label="Motivo de la diferencia">
                        {REASONS.map((x) => <option key={x}>{x}</option>)}
                      </select>
                    )}
                  </li>
                );
              })}
              {visible.length === 0 && <li className="py-6 text-center text-sm text-muted">{show === "pending" ? "Ya contaste todo ✓" : show === "diff" ? "Nada que corregir por ahora" : "Sin resultados"}</li>}
            </ul>
            <div className="sticky-action">
              <button type="button" onClick={close} disabled={saving || !stats.done} className="btn-success btn-lg mx-auto flex w-full max-w-3xl">
                {saving ? <Spinner /> : <IconCheck size={20} />} {stats.diffs ? `Terminar y corregir ${stats.diffs}` : "Terminar conteo"}
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  // ---------- Elegir categoría ----------
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <ScreenHeader
        title="Contar"
        subtitle="Revisa cuántas unidades hay de verdad y corrige lo que no coincide."
        back={{ href: "/products", label: "Productos" }}
        help={
          <>
            <p>Elige una categoría y ve producto por producto: escribe cuántos hay en el estante, toca <b>✓</b> si hay lo mismo que dice la app, o escanea cada unidad (suma de a uno).</p>
            <p>Lo que no cuentes se queda como está. Al terminar, la app corrige los que no coincidían y anota el motivo.</p>
          </>
        }
      />

      {loading ? (
        <ListSkeleton rows={4} />
      ) : (
        <>
          <section className="animate-in card p-1">
            <p className="px-3 pb-1 pt-2 text-xs font-bold uppercase tracking-wide text-muted">¿Qué vas a contar?</p>
            <ul className="grid gap-0.5 sm:grid-cols-2">
              {tops.map((c) => {
                const col = categoryColor(c.name);
                return (
                  <li key={c.id}>
                    <ListRow
                      onClick={() => begin(c)}
                      icon={<span className={`grid h-10 w-10 place-items-center rounded-xl text-xl ring-1 ${col.bg} ${col.ring}`}>{c.icon || "🏷️"}</span>}
                      title={c.name}
                      end={<IconChevronRight className="shrink-0 text-slate-300" />}
                    />
                  </li>
                );
              })}
            </ul>
          </section>

          {history.length > 0 && (
            <section className="animate-in card p-3">
              <h2 className="mb-2 text-sm font-bold text-ink">Veces que contaste</h2>
              <ul className="divide-y divide-slate-100 text-sm">
                {history.map((h) => (
                  <li key={h.id} className="flex min-h-[56px] items-center gap-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-ink">{h.category_name ?? "Categoría"}</span>
                      <span className="block text-xs text-muted">{new Date(h.started_at).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · {h.items} producto{h.items === 1 ? "" : "s"} contados</span>
                    </span>
                    <span className={`badge ${h.differences ? "bg-warn-100 text-warn-800" : "bg-ok-100 text-ok-800"}`}>{h.differences ? `${h.differences} corregidos · ${h.diff_units} unid.` : "todo coincidía"}</span>
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
