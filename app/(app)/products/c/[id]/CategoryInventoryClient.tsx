"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Category, FieldTemplate, Product, ProductVariant, VariantAxis } from "@/types/database";
import { getDescendantIds } from "@/lib/categories";
import { categoryColor } from "@/lib/colors";
import { SUMMARY_COLS, applyFilters, fromSummary, type Filter } from "@/lib/inventory";
import { exportToExcel } from "@/lib/export";
import ProductTable from "@/components/ProductTable";
import ProductRow from "@/components/ProductRow";
import StockAdjust from "@/components/StockAdjust";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { cacheGet, cacheSet, isNetworkError } from "@/lib/offline";
import { IconArrowLeft, IconCamera, IconDownload, IconList, IconTable } from "@/components/ui/Icons";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "porReponer", label: "Por reponer" },
  { key: "porVencer", label: "Por vencer" },
  { key: "agotados", label: "Agotados" },
  { key: "sinPrecio", label: "Sin precio" },
  { key: "sinFoto", label: "Sin foto" },
  { key: "hoy", label: "Agregados hoy" },
];

/** Nivel 2 del inventario: una categoría con sus subcategorías en chips y los productos en cuadrícula. */
export default function CategoryInventoryClient() {
  const { id } = useParams<{ id: string }>();
  const supabase = createClient();
  const [categories, setCategories] = useState<Category[]>([]);
  const [templates, setTemplates] = useState<FieldTemplate[]>([]);
  // Resúmenes ligeros de toda la categoría (para chips, filtros y conteos) + filas completas solo de la página visible
  const [products, setProducts] = useState<Product[]>([]);
  const [full, setFull] = useState<Map<string, Product>>(new Map());
  const [loading, setLoading] = useState(true);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [sub, setSub] = useState<string | null>(null); // subcategoría elegida (null = toda la categoría)
  const [filters, setFilters] = useState<Set<Filter>>(new Set());
  const [view, setView] = useState<"list" | "table">("list");
  const [limit, setLimit] = useState(40);
  const [adjusting, setAdjusting] = useState<Product | null>(null);
  const [axes, setAxes] = useState<VariantAxis[]>([]);
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const variantsOf = useMemo(() => {
    const m = new Map<string, ProductVariant[]>();
    variants.forEach((v) => m.set(v.product_id, [...(m.get(v.product_id) ?? []), v]));
    return m;
  }, [variants]);

  const isOrphan = id === "none";

  useEffect(() => {
    (async () => {
      const [c, t, a] = await Promise.all([
        supabase.from("categories").select("*"),
        supabase.from("field_templates").select("*").order("sort_order"),
        supabase.from("variant_axes").select("*").order("sort_order"),
      ]);
      if (c.error && isNetworkError(c.error)) {
        const cached = await cacheGet<{ categories: Category[]; templates: FieldTemplate[]; axes: VariantAxis[]; products: Product[]; full: [string, Product][]; variants: ProductVariant[] }>(`category:${id}`);
        if (cached) {
          setCategories(cached.data.categories);
          setTemplates(cached.data.templates);
          setAxes(cached.data.axes);
          setProducts(cached.data.products);
          setFull(new Map(cached.data.full));
          setVariants(cached.data.variants);
          setCachedAt(cached.at);
        }
        setLoading(false);
        return;
      }
      const cats = c.data ?? [];
      setCategories(cats);
      setTemplates(t.data ?? []);
      setAxes((a.data ?? []) as VariantAxis[]);
      let query = supabase.from("product_summaries").select(SUMMARY_COLS).eq("status", "confirmed").order("updated_at", { ascending: false });
      if (isOrphan) {
        const valid = cats.map((x) => x.id);
        query = valid.length ? query.or(`category_id.is.null,category_id.not.in.(${valid.join(",")})`) : query;
      } else {
        query = query.in("category_id", getDescendantIds(cats, id));
      }
      const { data } = await query;
      setProducts((data ?? []).map(fromSummary));
      setLoading(false);
    })();
  }, [supabase, id, isOrphan]);

  /** Trae las filas completas (todos los datos) de los productos indicados que aún no están en caché. */
  async function loadFull(ids: string[]): Promise<Map<string, Product>> {
    const missing = ids.filter((x) => !full.has(x));
    if (!missing.length) return full;
    const fetched = new Map<string, Product>();
    for (let i = 0; i < missing.length; i += 100) {
      const chunk = missing.slice(i, i + 100);
      const [{ data }, { data: vs }] = await Promise.all([
        supabase.from("products").select("*").in("id", chunk),
        supabase.from("product_variants").select("*").in("product_id", chunk).order("created_at"),
      ]);
      (data ?? []).forEach((row) => fetched.set(row.id, row as Product));
      if (vs?.length) setVariants((cur) => [...cur.filter((v) => !chunk.includes(v.product_id)), ...(vs as ProductVariant[])]);
    }
    // Fusión con lo que otras cargas hayan traído mientras tanto
    setFull((cur) => {
      const merged = new Map(cur);
      fetched.forEach((row, key) => merged.set(key, row));
      return merged;
    });
    const out = new Map(full);
    fetched.forEach((row, key) => out.set(key, row));
    return out;
  }

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
  const visible = useMemo(() => applyFilters(scoped, filters, variantsOf, categories), [scoped, filters, variantsOf, categories]);
  // Página visible: filas completas (datos, variantes) solo para lo que se muestra
  const pageIds = useMemo(() => visible.slice(0, limit).map((p) => p.id), [visible, limit]);
  useEffect(() => {
    if (pageIds.length) loadFull(pageIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIds.join(",")]);
  const rowOf = (p: Product) => full.get(p.id) ?? p;
  // Copia para consultar sin conexión (resúmenes + filas ya cargadas)
  useEffect(() => {
    if (!loading && !cachedAt && products.length) cacheSet(`category:${id}`, { categories, templates, axes, products, full: Array.from(full.entries()), variants });
  }, [loading, cachedAt, id, categories, templates, axes, products, full, variants]);

  async function exportVisible() {
    const map = await loadFull(visible.map((p) => p.id));
    await exportToExcel({ products: visible.map((p) => map.get(p.id) ?? p), categories, templates, fileName: title.toLowerCase().replace(/\s+/g, "-"), variants, axes });
  }
  const col = categoryColor(top?.name);
  const toggleFilter = (k: Filter) =>
    setFilters((s) => {
      const n = new Set(s);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  const title = isOrphan ? "Sin categoría" : top?.name ?? "…";

  return (
    <div className="w-full space-y-4 overflow-x-hidden">
      {cachedAt && (
        <p className="animate-in rounded-2xl bg-slate-800 px-3 py-2 text-center text-xs font-semibold text-white">
          Sin conexión · datos guardados a las {new Date(cachedAt).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}
        </p>
      )}
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
            <button onClick={exportVisible} className="btn-secondary btn-sm" disabled={!visible.length}>
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
        <ProductTable products={visible.slice(0, limit).map(rowOf)} categories={categories} templates={templates} mode="confirmed" onChanged={() => location.reload()} />
      ) : (
        <>
          <ul className="stagger grid w-full grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {visible.slice(0, limit).map((p) => (
              <ProductRow key={p.id} product={rowOf(p)} categories={categories} templates={templates} showSub={!sub} variants={variantsOf.get(p.id)} axes={axes} onAdjust={(x) => setAdjusting(rowOf(x))} />
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
          variants={variantsOf.get(adjusting.id)}
          onClose={() => setAdjusting(null)}
          onSaved={(u, v) => {
            setFull((m) => new Map(m).set(u.id, u));
            setProducts((ps) => ps.map((x) => (x.id === u.id ? { ...x, data: { ...x.data, stock: (u.data.stock ?? u.data.cantidad ?? u.data.existencias) as number | null } } : x)));
            if (v) setVariants((vs) => vs.map((x) => (x.id === v.id ? v : x)));
          }}
        />
      )}
    </div>
  );
}
