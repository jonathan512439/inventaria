"use client";

import { useState } from "react";
import Link from "next/link";
import type { Category, FieldTemplate, Product, ProductVariant, VariantAxis } from "@/types/database";
import { axesFor, summarizeVariants } from "@/lib/variants";
import { fieldLabel, getEffectiveFields, getValue, productTitle } from "@/lib/fields";
import { daysToExpiry, fmtMoney, minStockOf, needsRestock, priceOf, stockOf } from "@/lib/inventory";
import { categoryColor } from "@/lib/colors";
import Photo from "./ui/Photo";
import { IconBox, IconChevronRight } from "./ui/Icons";

interface Props {
  product: Product;
  categories: Category[];
  templates: FieldTemplate[];
  /** Muestra la subcategoría (cuando la lista mezcla varias) */
  showSub?: boolean;
  /** Variantes del producto (si tiene) y ejes de su categoría, para el resumen */
  variants?: ProductVariant[];
  axes?: VariantAxis[];
  onAdjust: (p: Product) => void;
}

const HIDDEN = new Set(["nombre", "name", "producto", "titulo", "precio", "price", "stock", "cantidad", "existencias", "descripcion"]);
const MAX_VISIBLE = 4;

/** Fila de inventario: foto, nombre, datos, precio, stock y atajo ± . Nunca más ancha que la pantalla. */
export default function ProductRow({ product: p, categories, templates, showSub, variants = [], axes = [], onAdjust }: Props) {
  const [expanded, setExpanded] = useState(false);
  const price = priceOf(p);
  const stock = stockOf(p);
  const out = (stock ?? 0) <= 0;
  const low = !out && needsRestock(p, categories);
  const minStock = minStockOf(p, categories);
  const days = daysToExpiry(p.expires_at);
  const cat = p.category_id ? categories.find((c) => c.id === p.category_id) : null;
  const top = cat?.parent_id ? categories.find((c) => c.id === cat.parent_id) ?? cat : cat;
  const col = categoryColor(top?.name);
  const fields = getEffectiveFields(templates, categories, p.category_id);
  const vsum = summarizeVariants(variants, axesFor(axes, categories, p.category_id));

  // Datos a mostrar: los definidos para su categoría (sin nombre/precio/stock/descripción) + otros guardados
  const details: { label: string; value: string }[] = [];
  const seen = new Set<string>();
  fields.forEach((f) => {
    if (HIDDEN.has(f.name)) return;
    seen.add(f.name);
    const v = getValue(p.data, f.name);
    if (v !== undefined && v !== null && v !== "") details.push({ label: fieldLabel(f.name), value: String(v) });
  });
  Object.entries(p.data).forEach(([k, v]) => {
    if (seen.has(k) || HIDDEN.has(k) || v === null || v === undefined || v === "") return;
    details.push({ label: fieldLabel(k), value: String(v) });
  });
  const descripcion = String(getValue(p.data, "descripcion") ?? "");
  const visibleDetails = expanded ? details : details.slice(0, MAX_VISIBLE);
  const hidden = details.length - visibleDetails.length;

  return (
    <li className="w-full min-w-0">
      <article className="w-full min-w-0 overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-slate-900/10">
        {/* Franja de color de la categoría */}
        <div className="h-1" style={{ background: col.dot }} />

        <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-3 p-3">
          {/* Foto */}
          <Link href={`/products/${p.id}`} className="relative block h-[84px] w-[84px] overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-900/5">
            {p.image_url ? (
              <Photo src={p.image_url} loading="lazy" wrapperClassName="h-full w-full" className="h-full w-full object-cover" />
            ) : (
              <span className="grid h-full w-full place-items-center text-slate-300"><IconBox size={28} /></span>
            )}
            {out && <span className="absolute inset-x-0 bottom-0 bg-rose-600/90 py-0.5 text-center text-[10px] font-bold text-white">AGOTADO</span>}
          </Link>

          {/* Contenido */}
          <div className="min-w-0">
            <Link href={`/products/${p.id}`} className="group flex min-w-0 items-start gap-1">
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 break-words text-[15px] font-bold leading-snug text-ink group-hover:text-brand-700">{productTitle(p.data) || "Sin nombre"}</span>
                {showSub && (
                  <span className={`mt-1 inline-block max-w-full truncate rounded-full px-2 py-0.5 text-[11px] font-semibold ${cat?.parent_id ? `${col.bg} ${col.text}` : "bg-amber-100 text-amber-800"}`}>
                    {cat?.parent_id ? cat.name : "sin subcategoría"}
                  </span>
                )}
              </span>
              <IconChevronRight size={16} className="mt-1 shrink-0 text-slate-300 group-hover:text-brand-500" />
            </Link>

            {/* Precio y stock */}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {price !== null ? (
                <span className="text-lg font-bold tabular-nums leading-none text-emerald-700">Bs {fmtMoney(price)}</span>
              ) : (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Sin precio</span>
              )}
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${out ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-700"}`}>
                {out ? "0 en stock" : `${stock} en stock`}
              </span>
              {low && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-800">por reponer · mín. {minStock}</span>}
              {days !== null && days <= 30 && (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${days < 0 ? "bg-rose-100 text-rose-700" : days <= 7 ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"}`}>
                  {days < 0 ? `vencido hace ${-days} d` : days === 0 ? "vence hoy" : `vence en ${days} d`}
                </span>
              )}
              {vsum && vsum.agotadas > 0 && (
                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700">{vsum.agotadas} variante{vsum.agotadas === 1 ? "" : "s"} agotada{vsum.agotadas === 1 ? "" : "s"}</span>
              )}
            </div>
            {vsum && <p className="mt-1 truncate text-[11px] font-medium text-violet-800" title={vsum.text}>{variants.length} variantes · {vsum.text}</p>}
          </div>
        </div>

        {/* Datos del producto */}
        {(details.length > 0 || descripcion) && (
          <div className="border-t border-slate-100 px-3 py-2">
            {details.length > 0 && (
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-3">
                {visibleDetails.map((d) => (
                  <div key={d.label} className="min-w-0">
                    <dt className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400">{d.label}</dt>
                    <dd className="m-0 truncate text-[13px] font-medium text-slate-800" title={d.value}>{d.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {expanded && descripcion && <p className="mt-2 break-words text-[13px] leading-snug text-slate-600">{descripcion}</p>}
            {(hidden > 0 || descripcion) && (
              <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-1.5 text-[12px] font-semibold text-brand-700 hover:underline">
                {expanded ? "Ver menos" : hidden > 0 ? `Ver ${hidden} dato${hidden === 1 ? "" : "s"} más${descripcion ? " y descripción" : ""}` : "Ver descripción"}
              </button>
            )}
          </div>
        )}

        {/* Acción */}
        <div className="border-t border-slate-100 p-2">
          <button type="button" onClick={() => onAdjust(p)} className="btn-secondary w-full border-brand-400 py-2 text-brand-700">
            <span className="text-base font-bold leading-none">+ / −</span> Stock: sumar, vender o retirar
          </button>
        </div>
      </article>
    </li>
  );
}
