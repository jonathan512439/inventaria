"use client";

import Link from "next/link";
import type { Category, FieldTemplate, Product } from "@/types/database";
import { fieldLabel, getEffectiveFields, getValue, productTitle } from "@/lib/fields";
import { fmtMoney, priceOf, stockOf } from "@/lib/inventory";
import Photo from "./ui/Photo";
import { IconBox, IconChevronRight, IconPlus } from "./ui/Icons";

interface Props {
  product: Product;
  categories: Category[];
  templates: FieldTemplate[];
  /** Muestra la subcategoría (cuando la lista mezcla varias) */
  showSub?: boolean;
  onAdjust: (p: Product) => void;
}

const HIDDEN = new Set(["nombre", "name", "producto", "titulo", "precio", "price", "stock", "cantidad", "existencias"]);

/** Fila de inventario: foto, nombre, subcategoría, todos los datos, precio, stock y atajo ± . */
export default function ProductRow({ product: p, categories, templates, showSub, onAdjust }: Props) {
  const price = priceOf(p);
  const stock = stockOf(p);
  const out = (stock ?? 0) <= 0;
  const cat = p.category_id ? categories.find((c) => c.id === p.category_id) : null;
  const fields = getEffectiveFields(templates, categories, p.category_id);
  // Datos a mostrar: los definidos para su categoría (menos nombre/precio/stock) y cualquier otro guardado
  const shown: { label: string; value: string }[] = [];
  const seen = new Set<string>();
  fields.forEach((f) => {
    if (HIDDEN.has(f.name)) return;
    const v = getValue(p.data, f.name);
    seen.add(f.name);
    if (v !== undefined && v !== null && v !== "") shown.push({ label: fieldLabel(f.name), value: String(v) });
  });
  Object.entries(p.data).forEach(([k, v]) => {
    if (seen.has(k) || HIDDEN.has(k) || v === null || v === undefined || v === "") return;
    shown.push({ label: fieldLabel(k), value: String(v) });
  });

  return (
    <li className="min-w-0">
      <div className="flex w-full min-w-0 items-stretch gap-3 rounded-3xl bg-white p-3 shadow-card ring-1 ring-slate-900/10">
        <Link href={`/products/${p.id}`} className="shrink-0">
          {p.image_url ? (
            <Photo src={p.image_url} loading="lazy" wrapperClassName="h-[92px] w-[92px] rounded-2xl ring-1 ring-slate-900/5" className="h-[92px] w-[92px] object-cover" />
          ) : (
            <span className="grid h-[92px] w-[92px] place-items-center rounded-2xl bg-slate-100 text-slate-400"><IconBox size={28} /></span>
          )}
        </Link>

        <div className="flex min-w-0 flex-1 flex-col">
          <Link href={`/products/${p.id}`} className="group flex items-start gap-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-bold leading-tight text-ink group-hover:text-brand-700">{productTitle(p.data) || "Sin nombre"}</span>
              {showSub && cat && <span className="block truncate text-[11px] text-slate-500">{cat.parent_id ? cat.name : "sin subcategoría"}</span>}
            </span>
            <IconChevronRight size={16} className="mt-0.5 shrink-0 text-slate-300" />
          </Link>

          {/* Todos los datos del producto */}
          {shown.length > 0 && (
            <dl className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[12px] leading-tight">
              {shown.map((d) => (
                <div key={d.label} className="flex min-w-0 max-w-full gap-1">
                  <dt className="shrink-0 text-slate-400">{d.label}:</dt>
                  <dd className="m-0 truncate font-medium text-slate-700">{d.value}</dd>
                </div>
              ))}
            </dl>
          )}

          <div className="mt-auto flex items-center justify-between gap-2 pt-2">
            <span className="flex items-center gap-2">
              {price !== null ? <span className="text-base font-bold tabular-nums text-emerald-700">Bs {fmtMoney(price)}</span> : <span className="text-xs font-semibold text-amber-700">Sin precio</span>}
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${out ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-700"}`}>
                {out ? "Agotado" : `Stock ${stock}`}
              </span>
            </span>
            <button type="button" onClick={() => onAdjust(p)} className="btn-secondary btn-sm shrink-0 border-brand-400 text-brand-700" title="Sumar o restar stock">
              <IconPlus size={14} />/− Stock
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}
