"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Category, FieldTemplate, Product } from "@/types/database";
import { getDescendantIds } from "@/lib/categories";
import { productTitle } from "@/lib/fields";
import { categoryColor } from "@/lib/colors";
import { applyFilters, fmtMoney, priceOf, stockOf, type Filter } from "@/lib/inventory";
import { exportToExcel } from "@/lib/export";
import ProductTable from "@/components/ProductTable";
import ProductRow from "@/components/ProductRow";
import StockAdjust from "@/components/StockAdjust";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { IconArrowLeft, IconCamera, IconDownload, IconList, IconTable } from "@/components/ui/Icons";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "agotados", label: "Agotados" },
  { key: "sinPrecio", label: "Sin precio" },
  { key: "sinFoto", label: "Sin foto" },
  { key: "hoy", label: "Agregados hoy" },
];

/** Nivel 2 del inventario: una categoría con sus subcategorías en chips y los productos en cuadrícula. */
export default function CategoryInventoryPage() {
  const { id } = useParams<{ id: string }>();
  const supabase = createClient();
  const [categories, setCategories] = useState<Category[]>([]);
  const [templates, setTemplates] = useState<FieldTemplate[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [sub, setSub] = useState<string | null>(null); // subcategoría elegida (null = toda la categoría)
  const [filters, setFilters] = useState<Set<Filter>>(new Set());
  const [view, setView] = useState<"list" | "table">("list");
  const [limit, setLimit] = useState(40);
  const [adjusting, setAdjusting] = useState<Product | null>(null);

  const isOrphan = id === "none";

  useEffect(() => {
    (async () => {
      const [c, t] = await Promise.all([supabase.from("categories").select("*"), supabase.from("field_templates").select("*").order("sort_order")]);
      const cats = c.data ?? [];
      setCategories(cats);
      setTemplates(t.data ?? []);
      let query = supabase.from("products").select("*").eq("status", "confirmed").order("updated_at", { ascending: false });
      if (isOrphan) {
        const valid = cats.map((x) => x.id);
        query = valid.length ? query.or(`category_id.is.null,category_id.not.in.(${valid.join(",")})`) : query;
      } else {
        query = query.in("category_id", getDescendantIds(cats, id));
      }
      const { data } = await query;
      setProducts((data ?? []) as Product[]);
      setLoading(false);
    })();
  }, [supabase, id, isOrphan]);

  const category = categories.find((c) => c.id === id) ?? null;
  const top = category?.parent_id ? categories.find((c) => c.id === category.parent_id) ?? category : category;
  const subs = useMemo(() => (top ? categories.filter((c) => c.parent_id === top.id).sort((a, b) => a.name.localeCompare(b.name, "es")) : []), [categories, top]);
  useEffect(() => {
    if (category?.parent_id) setSub(category.id); // entramos por una subcategoría
  }, [category]);

  const countIn = (catId: string) => {
    const ids = new Set(getDescendantIds(categories, catId));
    return products.filter((p) => p.category_id && ids.has(p.category_id)).length;
  };
  const inTop = useMemo(() => (top ? products.filter((p) => p.category_id && getDescendantIds(categories, top.id).includes(p.category_id)) : products), [products, categories, top]);
  const scoped = useMemo(() => (sub ? inTop.filter((p) => p.category_id && getDescendantIds(categories, sub).includes(p.category_id)) : inTop), [inTop, sub, categories]);
  const visible = useMemo(() => applyFilters(scoped, filters), [scoped, filters]);
  const col = categoryColor(top?.name);
  const toggleFilter = (k: Filter) =>
    setFilters((s) => {
      const n = new Set(s);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  const title = isOrphan ? "Sin categoría" : top?.name ?? "…";

  return (
    <div className="space-y-4">
      <header className="animate-in">
        <Link href="/products" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"><IconArrowLeft size={16} /> Mi inventario</Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-center gap-3">
            {!isOrphan && <span className={`grid h-12 w-12 place-items-center rounded-2xl text-2xl ring-1 ${col.bg} ${col.ring}`}>{top?.icon || "🏷️"}</span>}
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
              <p className="text-sm text-slate-500">{loading ? " " : `${scoped.length} producto${scoped.length === 1 ? "" : "s"}${sub ? ` en ${categories.find((c) => c.id === sub)?.name}` : ""}`}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => exportToExcel({ products: visible, categories, templates, fileName: title.toLowerCase().replace(/\s+/g, "-") })} className="btn-secondary btn-sm" disabled={!visible.length}>
              <IconDownload size={16} /> Excel de {sub ? "esta subcategoría" : title}
            </button>
            <button onClick={() => setView(view === "list" ? "table" : "list")} className="btn-secondary btn-sm hidden md:inline-flex">
              {view === "list" ? <IconTable size={16} /> : <IconList size={16} />} {view === "list" ? "Tabla" : "Lista"}
            </button>
          </div>
        </div>
      </header>

      {/* Subcategorías */}
      {subs.length > 0 && (
        <div className="no-scrollbar animate-in -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
          <button onClick={() => setSub(null)} className={`chip shrink-0 ${sub === null ? "chip-active" : ""}`}>Todo <span className="opacity-70">{inTop.length}</span></button>
          {subs.map((s) => (
            <button key={s.id} onClick={() => setSub(sub === s.id ? null : s.id)} className={`chip shrink-0 ${sub === s.id ? "chip-active" : ""}`}>
              {s.name} <span className="opacity-70">{countIn(s.id)}</span>
            </button>
          ))}
        </div>
      )}

      {/* Filtros de acción */}
      <div className="animate-in flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold uppercase tracking-wide text-slate-500">Mostrar solo</span>
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => toggleFilter(f.key)} className={`rounded-full border-2 px-3 py-1 font-semibold transition ${filters.has(f.key) ? "border-amber-500 bg-amber-100 text-amber-900" : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"}`}>
            {f.label}
          </button>
        ))}
        {filters.size > 0 && <button onClick={() => setFilters(new Set())} className="text-brand-700 underline">Quitar filtros</button>}
      </div>

      {loading ? (
        <ListSkeleton rows={6} />
      ) : visible.length === 0 ? (
        <div className="animate-in card mx-auto max-w-sm text-center">
          <p className="text-lg font-bold text-ink">{filters.size ? "Nada con esos filtros" : `Aún no hay productos en ${sub ? categories.find((c) => c.id === sub)?.name : title}`}</p>
          {!filters.size && <Link href="/capture" className="btn-primary mt-4 w-full"><IconCamera size={18} /> Agregar con foto</Link>}
        </div>
      ) : view === "table" ? (
        <ProductTable products={visible} categories={categories} templates={templates} mode="confirmed" onChanged={() => location.reload()} />
      ) : (
        <>
          <ul className="stagger mx-auto grid w-full max-w-3xl grid-cols-1 gap-3">
            {visible.slice(0, limit).map((p) => (
              <ProductRow key={p.id} product={p} categories={categories} templates={templates} showSub={!sub} onAdjust={setAdjusting} />
            ))}
          </ul>
          {visible.length > limit && (
            <button onClick={() => setLimit((l) => l + 40)} className="btn-secondary mx-auto block">Ver más ({visible.length - limit} restantes)</button>
          )}
        </>
      )}

      {adjusting && (
        <StockAdjust
          product={adjusting}
          onClose={() => setAdjusting(null)}
          onSaved={(u) => setProducts((ps) => ps.map((x) => (x.id === u.id ? u : x)))}
        />
      )}
    </div>
  );
}
