"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Category, Product, ProductVariant } from "@/types/database";
import { getDescendantIds } from "@/lib/categories";
import { SUMMARY_COLS, fmtMoney, fromSummary, priceOf, stockOf } from "@/lib/inventory";
import { productTitle } from "@/lib/fields";
import { useFlow } from "@/components/FlowProvider";
import CoachTip from "@/components/CoachTip";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { IconArrowLeft, IconCheck, IconSearch, IconTag, Spinner } from "@/components/ui/Icons";

type Row = { key: string; productId: string; variantId: string | null; name: string; variant: string | null; code: string | null; price: number | null; stock: number };
type Format = "a4" | "roll";

/**
 * Etiquetas imprimibles: código de barras (Code 128) con nombre y precio, en hoja A4 (24 por hoja)
 * o rollo de 50×30 mm. A los productos sin código se les asigna uno interno (IA + 6 números) que
 * el escáner de la app reconoce igual que un código de barras comercial.
 */
export default function LabelsPage() {
  const supabase = createClient();
  const toast = useToast();
  const confirm = useConfirm();
  const flow = useFlow();
  const [products, setProducts] = useState<Product[]>([]);
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [catId, setCatId] = useState("");
  const [q, setQ] = useState("");
  const [onlyNoCode, setOnlyNoCode] = useState(false);
  const [selected, setSelected] = useState<Map<string, number>>(new Map());
  const [format, setFormat] = useState<Format>("a4");
  const [showPrice, setShowPrice] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [preview, setPreview] = useState(false);

  async function load() {
    const [p, v, c] = await Promise.all([
      supabase.from("product_summaries").select(SUMMARY_COLS).eq("status", "confirmed").order("nombre"),
      supabase.from("product_variants").select("*").order("created_at"),
      supabase.from("categories").select("*").order("name"),
    ]);
    setProducts((p.data ?? []).map(fromSummary));
    setVariants((v.data ?? []) as ProductVariant[]);
    setCategories(c.data ?? []);
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo<Row[]>(() => {
    const byProduct = new Map<string, ProductVariant[]>();
    variants.forEach((v) => byProduct.set(v.product_id, [...(byProduct.get(v.product_id) ?? []), v]));
    const ids = catId ? new Set(getDescendantIds(categories, catId)) : null;
    const needle = q.trim().toLowerCase();
    const out: Row[] = [];
    products.forEach((p) => {
      if (ids && (!p.category_id || !ids.has(p.category_id))) return;
      const name = productTitle(p.data) || "Sin nombre";
      if (needle && !name.toLowerCase().includes(needle) && !String(p.data.codigo_barras ?? "").toLowerCase().includes(needle)) return;
      const vs = byProduct.get(p.id);
      const price = priceOf(p);
      if (vs?.length) vs.forEach((v) => out.push({ key: v.id, productId: p.id, variantId: v.id, name, variant: v.label, code: v.codigo_barras || null, price: v.precio ?? price, stock: v.stock }));
      else out.push({ key: p.id, productId: p.id, variantId: null, name, variant: null, code: String(p.data.codigo_barras || "") || null, price, stock: stockOf(p) ?? 0 });
    });
    return onlyNoCode ? out.filter((r) => !r.code) : out;
  }, [products, variants, categories, catId, q, onlyNoCode]);

  const chosen = rows.filter((r) => selected.has(r.key));
  const withoutCode = chosen.filter((r) => !r.code);
  const totalLabels = chosen.reduce((a, r) => a + (selected.get(r.key) ?? 1), 0);

  function toggle(r: Row) {
    const m = new Map(selected);
    if (m.has(r.key)) m.delete(r.key);
    else m.set(r.key, 1);
    setSelected(m);
  }
  function setQty(key: string, n: number) {
    const m = new Map(selected);
    m.set(key, Math.max(1, Math.min(200, n || 1)));
    setSelected(m);
  }
  function selectAll(on: boolean) {
    const m = new Map(selected);
    rows.forEach((r) => (on ? m.set(r.key, m.get(r.key) ?? 1) : m.delete(r.key)));
    setSelected(m);
  }

  /** Código interno único: «IA» + 6 números, distinto de todos los códigos del negocio. */
  async function assignInternalCodes() {
    const targets = withoutCode;
    if (!targets.length) return;
    const ok = await confirm({ title: `¿Crear código interno para ${targets.length} producto${targets.length === 1 ? "" : "s"}?`, body: "Se guarda como su código de barras (IA + 6 números). La cámara de la app lo reconocerá al vender o contar.", confirmLabel: "Crear códigos" });
    if (!ok) return;
    setAssigning(true);
    const used = new Set<string>([...products.map((p) => String(p.data.codigo_barras ?? "").toUpperCase()), ...variants.map((v) => (v.codigo_barras ?? "").toUpperCase())]);
    const fresh = () => {
      for (;;) {
        const c = "IA" + String(Math.floor(100000 + Math.random() * 900000));
        if (!used.has(c)) {
          used.add(c);
          return c;
        }
      }
    };
    let done = 0;
    for (const r of targets) {
      const code = fresh();
      if (r.variantId) {
        const { error } = await supabase.from("product_variants").update({ codigo_barras: code }).eq("id", r.variantId);
        if (error) continue;
      } else {
        const { data: p } = await supabase.from("products").select("data").eq("id", r.productId).maybeSingle();
        if (!p) continue;
        const keys = Object.keys(p.data);
        const key = ["codigo_barras", "codigo", "sku", "barcode", "ean"].map((k) => keys.find((x) => x.toLowerCase() === k)).find(Boolean) ?? "codigo_barras";
        const { error } = await supabase.from("products").update({ data: { ...p.data, [key]: code } }).eq("id", r.productId);
        if (error) continue;
      }
      done++;
    }
    setAssigning(false);
    toast("success", `${done} código${done === 1 ? "" : "s"} interno${done === 1 ? "" : "s"} creado${done === 1 ? "" : "s"}`);
    await load();
  }

  const labels = useMemo(() => chosen.filter((r) => r.code).flatMap((r) => Array.from({ length: selected.get(r.key) ?? 1 }, (_, i) => ({ ...r, i }))), [chosen, selected]);

  function print() {
    setPreview(true);
    setTimeout(() => window.print(), 400);
  }

  return (
    <div className="has-action mx-auto max-w-3xl space-y-4">
      <header className="animate-in print:hidden">
        <Link href="/settings" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"><IconArrowLeft size={16} /> Ajustes</Link>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Etiquetas para imprimir</h1>
        <p className="text-sm text-slate-500">Código de barras, nombre y precio de cada producto. Pégalas en el estante o en el producto y la cámara de la app las lee.</p>
      </header>
      <div className="print:hidden">
        <CoachTip screen="labels" title="Para los productos sin código">
          Marca los productos, toca <b>Crear códigos internos</b> si alguno no tiene código de barras y luego <b>Imprimir</b>. En A4 salen 24 etiquetas por hoja (papel adhesivo de 3 × 8); en rollo, una por etiqueta de 50 × 30 mm.
        </CoachTip>
      </div>

      <section className="animate-in card space-y-3 p-4 print:hidden">
        <div className="grid gap-2 sm:grid-cols-2">
          <select className="input" value={catId} onChange={(e) => setCatId(e.target.value)}>
            <option value="">Todas las categorías</option>
            {categories.filter((c) => !c.parent_id).map((c) => <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ` : ""}{c.name}</option>)}
          </select>
          <label className="relative block">
            <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" placeholder="Buscar producto o código" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={onlyNoCode} onChange={(e) => setOnlyNoCode(e.target.checked)} /> Solo sin código</label>
          <span className="flex-1" />
          <button onClick={() => selectAll(true)} className="btn-ghost btn-sm">Marcar todos ({rows.length})</button>
          <button onClick={() => selectAll(false)} className="btn-ghost btn-sm">Ninguno</button>
        </div>
        {loading ? (
          <ListSkeleton rows={5} />
        ) : rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">Nada que mostrar con ese filtro.</p>
        ) : (
          <ul className="max-h-[50vh] divide-y divide-slate-100 overflow-y-auto">
            {rows.map((r) => {
              const on = selected.has(r.key);
              return (
                <li key={r.key} className={`flex items-center gap-2 py-2 ${on ? "" : "opacity-80"}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(r)} className="h-5 w-5 shrink-0" />
                  <button onClick={() => toggle(r)} className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm font-semibold text-ink">{r.name}{r.variant ? <span className="font-normal text-slate-500"> · {r.variant}</span> : null}</span>
                    <span className="block truncate text-[11px] text-slate-500">{r.code ? <span className="font-mono">{r.code}</span> : <span className="text-amber-700">sin código</span>}{r.price !== null ? ` · Bs ${fmtMoney(r.price)}` : ""} · {r.stock} en stock</span>
                  </button>
                  {on && (
                    <span className="flex shrink-0 items-center gap-1 text-xs text-slate-500">
                      <input type="number" inputMode="numeric" min={1} max={200} className="input w-16 py-1 text-center" value={selected.get(r.key) ?? 1} onChange={(e) => setQty(r.key, Number(e.target.value))} />
                      <button onClick={() => setQty(r.key, r.stock)} className="btn-ghost btn-sm" title="Una por unidad en stock">= stock</button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {chosen.length > 0 && (
        <section className="animate-in card space-y-3 p-4 print:hidden">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-bold text-ink">{totalLabels} etiqueta{totalLabels === 1 ? "" : "s"}</span>
            <span className="text-slate-500">de {chosen.length} producto{chosen.length === 1 ? "" : "s"}</span>
            <span className="flex-1" />
            <div className="flex gap-1">
              <button onClick={() => setFormat("a4")} className={`chip ${format === "a4" ? "chip-active" : ""}`}>Hoja A4</button>
              <button onClick={() => setFormat("roll")} className={`chip ${format === "roll" ? "chip-active" : ""}`}>Rollo 50×30</button>
            </div>
            <label className="flex items-center gap-2"><input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} /> Con precio</label>
          </div>
          {withoutCode.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <span className="flex-1">{withoutCode.length} de los marcados no tiene{withoutCode.length === 1 ? "" : "n"} código: no se pueden imprimir todavía.</span>
              <button onClick={assignInternalCodes} disabled={assigning} className="btn-primary btn-sm">{assigning ? <Spinner /> : <IconTag size={14} />} Crear códigos internos</button>
            </div>
          )}
          <button onClick={() => setPreview((v) => !v)} className="btn-ghost btn-sm">{preview ? "Ocultar vista previa" : "Ver cómo quedan"}</button>
        </section>
      )}

      {(preview || labels.length > 0) && labels.length > 0 && (
        <div id="labels-sheet" className={`${preview ? "" : "hidden print:block"} ${format === "a4" ? "labels-a4" : "labels-roll"}`}>
          {labels.map((l) => (
            <Label key={`${l.key}-${l.i}`} code={l.code!} name={l.name} variant={l.variant} price={showPrice ? l.price : null} business={flow.business?.name ?? ""} />
          ))}
        </div>
      )}

      <div className="sticky-action print:hidden">
        <button onClick={print} disabled={labels.length === 0} className="btn-primary btn-lg w-full"><IconCheck size={20} /> Imprimir {labels.length} etiqueta{labels.length === 1 ? "" : "s"}</button>
      </div>

      <style jsx global>{`
        .label {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          overflow: hidden;
          background: #fff;
          color: #000;
          box-sizing: border-box;
          padding: 2mm 2.5mm;
          break-inside: avoid;
        }
        .label .l-name { font: 700 9.5pt/1.1 system-ui, sans-serif; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
        .label .l-sub { font: 500 7.5pt/1.1 system-ui, sans-serif; color: #444; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .label .l-price { font: 800 11pt/1 system-ui, sans-serif; white-space: nowrap; }
        .label svg { width: 100%; height: 11mm; }
        .labels-a4 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2mm; }
        .labels-a4 .label { height: 34mm; border: 1px dashed #ddd; }
        .labels-roll { display: grid; grid-template-columns: repeat(auto-fill, 50mm); gap: 2mm; }
        .labels-roll .label { width: 50mm; height: 30mm; border: 1px dashed #ddd; }
        @media print {
          @page { margin: 8mm; }
          body * { visibility: hidden !important; }
          #labels-sheet, #labels-sheet * { visibility: visible !important; }
          #labels-sheet { position: absolute; left: 0; top: 0; width: 100%; margin: 0; padding: 0; }
          .labels-a4 { gap: 0; }
          .labels-a4 .label { border: none; height: 35mm; }
          .labels-roll { display: block; }
          .labels-roll .label { border: none; page-break-after: always; }
        }
      `}</style>
      <style jsx global>{`
        ${format === "roll" ? "@media print { @page { size: 50mm 30mm; margin: 0; } }" : "@media print { @page { size: A4 portrait; } }"}
      `}</style>
    </div>
  );
}

/** Una etiqueta: nombre, variante, precio y el código en Code 128 (la app lo lee con la cámara). */
function Label({ code, name, variant, price, business }: { code: string; name: string; variant: string | null; price: number | null; business: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    let alive = true;
    import("jsbarcode").then(({ default: JsBarcode }) => {
      if (!alive || !ref.current) return;
      try {
        JsBarcode(ref.current, code, { format: "CODE128", displayValue: true, fontSize: 10, height: 34, width: 1.4, margin: 0, textMargin: 1, font: "system-ui" });
      } catch {
        /* código con caracteres raros: se deja vacío */
      }
    });
    return () => {
      alive = false;
    };
  }, [code]);
  return (
    <div className="label">
      <div>
        <div className="l-name">{name}</div>
        {(variant || business) && <div className="l-sub">{[variant, business].filter(Boolean).join(" · ")}</div>}
      </div>
      <svg ref={ref} />
      {price !== null && <div className="l-price">Bs {fmtMoney(price)}</div>}
    </div>
  );
}
