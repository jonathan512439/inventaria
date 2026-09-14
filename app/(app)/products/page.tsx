"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Category, FieldTemplate, Product } from "@/types/database";
import { buildTree, categoryPath, getDescendantIds } from "@/lib/categories";
import { normalizeFieldName, productTitle } from "@/lib/fields";
import ProductTable from "@/components/ProductTable";
import { IconBox, IconCamera, IconChevronRight, IconDownload, IconGrid, IconSearch, IconTable } from "@/components/ui/Icons";
import { ListSkeleton } from "@/components/ui/Skeleton";
import Photo from "@/components/ui/Photo";
import { IllustrationCapture } from "@/components/guide/Illustrations";
import { categoryColor } from "@/lib/colors";

export default function ProductsPage() {
  const supabase = createClient();
  const [categories, setCategories] = useState<Category[]>([]);
  const [templates, setTemplates] = useState<FieldTemplate[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"cards" | "table">("cards");
  const [limit, setLimit] = useState(60);

  const load = useCallback(async () => {
    const [c, t, p] = await Promise.all([
      supabase.from("categories").select("*"),
      supabase.from("field_templates").select("*").order("sort_order"),
      supabase.from("products").select("*").eq("status", "confirmed").order("updated_at", { ascending: false }),
    ]);
    setCategories(c.data ?? []);
    setTemplates(t.data ?? []);
    setProducts(p.data ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const roots = useMemo(() => buildTree(categories), [categories]);
  const countByCat = useMemo(() => {
    const m = new Map<string | null, number>();
    products.forEach((p) => m.set(p.category_id, (m.get(p.category_id) ?? 0) + 1));
    return m;
  }, [products]);

  const visible = useMemo(() => {
    const allowed = filter ? new Set(getDescendantIds(categories, filter)) : null;
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (allowed && (!p.category_id || !allowed.has(p.category_id))) return false;
      if (q && !(JSON.stringify(p.data) + (p.ai_meta?.etiqueta ?? "")).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [products, categories, filter, search]);

  const findKey = (p: Product, names: string[]) => {
    const keys = Object.keys(p.data);
    for (const n of names) {
      const k = keys.find((x) => normalizeFieldName(x) === n);
      if (k && p.data[k] !== undefined && p.data[k] !== null && p.data[k] !== "") return k;
    }
    return undefined;
  };
  const priceKey = (p: Product) => findKey(p, ["precio", "precio_venta", "price"]);
  const stockKey = (p: Product) => findKey(p, ["stock", "cantidad", "existencias"]);

  return (
    <div className="space-y-4">
      <header className="animate-in flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Mi inventario</h1>
          <p className="text-sm text-slate-500">{loading ? " " : `${products.length} producto${products.length === 1 ? "" : "s"}`}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/export" className="btn-secondary btn-sm"><IconDownload size={16} /> Excel</Link>
          <button onClick={() => setView(view === "cards" ? "table" : "cards")} className="btn-secondary btn-sm hidden md:inline-flex">
            {view === "cards" ? <IconTable size={16} /> : <IconGrid size={16} />}
            {view === "cards" ? "Tabla" : "Tarjetas"}
          </button>
        </div>
      </header>

      {/* Búsqueda */}
      <div className="animate-in relative mx-auto w-full max-w-xl md:max-w-none">
        <IconSearch size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="input pl-11" placeholder="Buscar por nombre, marca, código…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {/* Subcategorías como chips */}
      {roots.length > 0 && (
        <div className="no-scrollbar animate-in -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
          <button onClick={() => setFilter(null)} className={`chip shrink-0 ${filter === null ? "chip-active" : ""}`}>
            Todo <span className="opacity-70">{products.length}</span>
          </button>
          {roots.map((c) => {
            const n = getDescendantIds(categories, c.id).reduce((s, id) => s + (countByCat.get(id) ?? 0), 0);
            const col = categoryColor(c.name);
            return (
              <button key={c.id} onClick={() => setFilter(filter === c.id ? null : c.id)} className={`chip shrink-0 ${filter === c.id ? "chip-active" : ""}`}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: col.dot }} />
                {c.icon ? `${c.icon} ` : ""}{c.name} <span className="opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
      )}

      {loading ? (
        <ListSkeleton rows={6} />
      ) : products.length === 0 ? (
        <div className="animate-in card mx-auto max-w-sm text-center">
          <div className="mx-auto h-[190px] w-[150px]"><IllustrationCapture /></div>
          <h2 className="mt-4 text-lg font-bold">Tu inventario está vacío</h2>
          <p className="mt-1 text-sm text-slate-500">Empieza tomando una foto de un producto.</p>
          <Link href="/capture" className="btn-primary mt-5 w-full"><IconCamera size={18} /> Agregar productos</Link>
        </div>
      ) : view === "table" ? (
        <ProductTable products={visible} categories={categories} templates={templates} mode="confirmed" onChanged={load} />
      ) : (
        <>
          <ul className="stagger mx-auto grid w-full max-w-xl grid-cols-1 gap-3 md:max-w-none md:grid-cols-2">
            {visible.slice(0, limit).map((p) => {
              const pk = priceKey(p);
              const sk = stockKey(p);
              const cat = p.category_id ? categories.find((c) => c.id === p.category_id) : null;
              const top = cat?.parent_id ? categories.find((c) => c.id === cat.parent_id) ?? cat : cat;
              const col = categoryColor(top?.name);
              const stockN = sk ? Number(p.data[sk]) : NaN;
              return (
                <li key={p.id} className="min-w-0">
                  <Link
                    href={`/products/${p.id}`}
                    className="press group flex w-full min-w-0 items-stretch gap-3 overflow-hidden rounded-3xl bg-white p-3 shadow-card ring-1 ring-slate-900/10 transition hover:ring-brand-400"
                    style={{ borderLeft: `5px solid ${col.dot}` }}
                  >
                    {p.image_url ? (
                      <Photo src={p.image_url} loading="lazy" wrapperClassName="h-[84px] w-[84px] shrink-0 rounded-2xl ring-1 ring-slate-900/5" className="h-[84px] w-[84px] object-cover" />
                    ) : (
                      <span className="grid h-[84px] w-[84px] shrink-0 place-items-center rounded-2xl bg-slate-100 text-slate-400"><IconBox size={28} /></span>
                    )}
                    <span className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
                      <span className="block truncate text-[15px] font-bold leading-tight text-ink">{productTitle(p.data) || "Sin nombre"}</span>
                      <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-tight">
                        {top ? (
                          <>
                            <span className={`inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 font-semibold ${col.bg} ${col.text}`}>
                              {top.icon ? `${top.icon} ` : ""}{top.name}
                            </span>
                            {cat && cat.parent_id ? (
                              <span className="truncate text-slate-600"><span className="text-slate-400">Subcategoría:</span> <b>{cat.name}</b></span>
                            ) : (
                              <span className="text-amber-700">sin subcategoría</span>
                            )}
                          </>
                        ) : (
                          <span className="text-amber-700">Sin categoría</span>
                        )}
                      </span>
                      <span className="mt-1.5 flex items-center gap-2">
                        {pk ? (
                          <span className="text-base font-bold tabular-nums text-emerald-700">{fmtMoney(p.data[pk])}</span>
                        ) : (
                          <span className="text-xs font-medium text-amber-700">Sin precio</span>
                        )}
                        {sk && (
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${Number.isFinite(stockN) && stockN <= 0 ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-700"}`}>
                            Stock {String(p.data[sk])}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="grid shrink-0 place-items-center text-slate-300 group-hover:text-brand-500"><IconChevronRight /></span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {visible.length > limit && (
            <button onClick={() => setLimit((l) => l + 60)} className="btn-secondary mx-auto block">
              Ver más ({visible.length - limit} restantes)
            </button>
          )}
          {visible.length === 0 && <p className="py-8 text-center text-sm text-slate-500">Nada coincide con tu búsqueda.</p>}
        </>
      )}
    </div>
  );
}

function fmtMoney(v: string | number | null) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return String(v ?? "");
  return n.toLocaleString("es", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
