"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Category, Product, ProductVariant, VariantAxis } from "@/types/database";
import { axesFor, sameValues, variantLabel, variantTotals } from "@/lib/variants";
import { fmtMoney } from "@/lib/inventory";
import VariantGrid from "./VariantGrid";
import StockAdjust from "./StockAdjust";
import { useToast } from "./ui/Toast";
import { useConfirm } from "./ui/Confirm";
import { IconTrash, Spinner } from "./ui/Icons";

interface Props {
  product: Product;
  categories: Category[];
  axes: VariantAxis[];
  variants: ProductVariant[];
  /** Tras cualquier cambio (stock, alta, baja): el padre recarga */
  onChanged: () => void;
}

/** Ficha del producto: cuadrícula de variantes con stock por casilla y detalle (precio, código) por variante. */
export default function ProductVariants({ product, categories, axes, variants, onChanged }: Props) {
  const supabase = createClient();
  const toast = useToast();
  const ask = useConfirm();
  const axesHere = useMemo(() => axesFor(axes, categories, product.category_id), [axes, categories, product.category_id]);
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const [adjusting, setAdjusting] = useState<ProductVariant | null>(null);
  const [detail, setDetail] = useState(false);
  const [edits, setEdits] = useState<Record<string, { precio: string; codigo: string }>>({});
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);

  // Filas/columnas = opciones presentes en las variantes guardadas (+ las que el usuario agregue)
  useEffect(() => {
    setChosen((prev) => {
      const next: Record<string, string[]> = { ...prev };
      variants.forEach((v) => Object.entries(v.values).forEach(([k, val]) => {
        next[k] = next[k] ?? [];
        if (!next[k].includes(val)) next[k] = [...next[k], val];
      }));
      return next;
    });
  }, [variants]);

  const find = (values: Record<string, string>) => variants.find((v) => sameValues(v.values, values));
  const totals = variantTotals(variants);

  async function createCell(values: Record<string, string>) {
    setCreating(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("product_variants")
      .insert({ user_id: user!.id, product_id: product.id, values, label: variantLabel(values, axesHere), stock: 0 })
      .select()
      .single();
    setCreating(false);
    if (error) return toast("error", error.message);
    onChanged();
    setAdjusting(data as ProductVariant); // pedir cuántas hay
  }

  async function removeVariant(v: ProductVariant) {
    const ok = await ask({
      title: `¿Quitar ${v.label}?`,
      body: "Esa combinación desaparece del producto y su stock deja de contarse.",
      details: [{ label: "Stock que deja de contarse", value: String(v.stock), tone: "warn" }],
      confirmLabel: "Quitar variante",
      tone: "danger",
    });
    if (!ok) return;
    const { error } = await supabase.from("product_variants").delete().eq("id", v.id);
    if (error) return toast("error", error.message);
    onChanged();
  }

  async function saveDetails() {
    setSaving(true);
    for (const [id, e] of Object.entries(edits)) {
      const precio = e.precio.trim() === "" ? null : Number(e.precio.replace(",", "."));
      const codigo = e.codigo.trim() || null;
      const { error } = await supabase.from("product_variants").update({ precio: Number.isFinite(precio as number) ? precio : null, codigo_barras: codigo }).eq("id", id);
      if (error) {
        setSaving(false);
        return toast("error", /product_variants_codigo/.test(error.message) ? "Ese código de barras ya está en otra variante" : error.message);
      }
    }
    setSaving(false);
    setEdits({});
    toast("success", "Variantes guardadas");
    onChanged();
  }

  if (!axesHere.length && !variants.length) return null;

  return (
    <div className="rounded-2xl border-2 border-violet-200 bg-violet-50/40 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-bold text-violet-900">Variantes</p>
        <p className="text-xs text-violet-800">
          {variants.length ? <>{variants.length} variante{variants.length === 1 ? "" : "s"} · stock total <b>{totals.stock}</b>{totals.agotadas ? <> · <span className="font-semibold text-rose-700">{totals.agotadas} agotada{totals.agotadas === 1 ? "" : "s"}</span></> : null}</> : "aún sin variantes"}
        </p>
      </div>

      {axesHere.length ? (
        <div className="mt-2">
          <VariantGrid
            axes={axesHere}
            chosen={chosen}
            onChosen={setChosen}
            getCell={(values) => {
              const v = find(values);
              return v ? { exists: true, stock: v.stock, hint: v.codigo_barras ? "▮▮▮" : undefined } : { exists: false, stock: null };
            }}
            onCell={(values) => {
              const v = find(values);
              if (v) setAdjusting(v);
              else if (!creating) createCell(values);
            }}
          />
        </div>
      ) : (
        <p className="mt-1 text-xs text-violet-800">
          Esta categoría no tiene ejes de variación definidos. Agrégalos en <Link href="/store" className="font-semibold underline">Mi tienda</Link> para crear más variantes.
        </p>
      )}

      {totals.agotadas > 0 && (
        <p className="mt-2 text-xs font-semibold text-rose-700">● Agotado: {variants.filter((v) => v.stock <= 0).map((v) => v.label).join(", ")}</p>
      )}

      {variants.length > 0 && (
        <div className="mt-3">
          <button type="button" onClick={() => setDetail((d) => !d)} className="text-xs font-semibold text-violet-800 underline">
            {detail ? "Ocultar precio y código por variante" : "Precio y código de barras por variante"}
          </button>
          {detail && (
            <div className="mt-2 space-y-1.5">
              {variants.map((v) => {
                const e = edits[v.id] ?? { precio: v.precio !== null ? String(v.precio) : "", codigo: v.codigo_barras ?? "" };
                return (
                  <div key={v.id} className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-xl bg-white p-2 ring-1 ring-violet-100 sm:grid-cols-[1fr_96px_1fr_auto]">
                    <span className="min-w-0 truncate text-sm font-semibold text-ink">{v.label} <span className="text-xs font-normal text-slate-500">· {v.stock} en stock</span></span>
                    <button type="button" onClick={() => removeVariant(v)} className="rounded-full p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600 sm:order-last" title="Quitar variante"><IconTrash size={14} /></button>
                    <input type="number" inputMode="decimal" step="any" className="input py-1.5 text-sm tabular-nums" placeholder={`Bs ${fmtMoney(Number(product.data.precio ?? 0) || 0)}`} value={e.precio} onChange={(ev) => setEdits({ ...edits, [v.id]: { ...e, precio: ev.target.value } })} title="Precio propio (vacío = el del producto)" />
                    <input className="input py-1.5 text-sm" placeholder="Código de barras" value={e.codigo} onChange={(ev) => setEdits({ ...edits, [v.id]: { ...e, codigo: ev.target.value } })} />
                  </div>
                );
              })}
              <p className="text-[11px] text-slate-500">Precio vacío = usa el del producto. El código de barras permite que el escáner sume stock directo a esa variante.</p>
              {Object.keys(edits).length > 0 && (
                <button type="button" onClick={saveDetails} disabled={saving} className="btn-primary btn-sm">{saving ? <Spinner size={14} /> : null} Guardar variantes</button>
              )}
            </div>
          )}
        </div>
      )}

      {adjusting && (
        <StockAdjust
          product={product}
          variants={variants.some((v) => v.id === adjusting.id) ? variants : [...variants, adjusting]}
          variant={adjusting}
          onClose={() => setAdjusting(null)}
          onSaved={() => onChanged()}
        />
      )}
    </div>
  );
}
