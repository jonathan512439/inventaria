"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Category, Product } from "@/types/database";
import { categoryPath } from "@/lib/categories";
import { productTitle } from "@/lib/fields";
import { categoryColor } from "@/lib/colors";
import { computeShelves, fmtMoney, priceOf, stockOf, type Alerts } from "@/lib/inventory";
import { ListSkeleton } from "@/components/ui/Skeleton";
import Photo from "@/components/ui/Photo";
import { IllustrationCapture } from "@/components/guide/Illustrations";
import { IconAlert, IconBox, IconCamera, IconChevronRight, IconDownload, IconPlus, IconSearch, IconTable, IconTag } from "@/components/ui/Icons";

/** Nivel 1 del inventario: estantes por categoría con totales y alertas. */
export default function ProductsPage() {
  const supabase = createClient();
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [salesMonth, setSalesMonth] = useState<{ total: number; count: number } | null>(null);

  useEffect(() => {
    (async () => {
      const [c, p] = await Promise.all([
        supabase.from("categories").select("*"),
        supabase.from("products").select("id,user_id,category_id,status,data,ai_meta,image_url,created_at,updated_at").order("updated_at", { ascending: false }),
      ]);
      setCategories(c.data ?? []);
      setProducts((p.data ?? []) as Product[]);
      setLoading(false);
      const start = new Date();
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      const { data: sales } = await supabase.from("stock_movements").select("total").eq("tipo", "venta").gte("created_at", start.toISOString());
      setSalesMonth({ total: (sales ?? []).reduce((s, r) => s + (r.total ?? 0), 0), count: (sales ?? []).length });
    })();
  }, [supabase]);

  const confirmed = useMemo(() => products.filter((p) => p.status === "confirmed"), [products]);
  const { shelves, orphan, total } = useMemo(() => computeShelves(confirmed, categories), [confirmed, categories]);
  const pendingCount = products.length - confirmed.length;

  const q = search.trim().toLowerCase();
  const results = q
    ? confirmed.filter((p) => (JSON.stringify(p.data) + (p.ai_meta?.etiqueta ?? "") + categoryPath(categories, p.category_id)).toLowerCase().includes(q)).slice(0, 40)
    : [];

  return (
    <div className="space-y-5">
      <header className="animate-in flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Mi inventario</h1>
          <p className="text-sm text-slate-500">{loading ? " " : `${total.products} producto${total.products === 1 ? "" : "s"} en ${shelves.length} categoría${shelves.length === 1 ? "" : "s"}`}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/products/new" className="btn-primary btn-sm"><IconPlus size={16} /> Producto</Link>
          <Link href="/movements" className="btn-secondary btn-sm border-emerald-400 text-emerald-800"><IconTag size={16} /> Ventas</Link>
          <Link href="/export" className="btn-secondary btn-sm"><IconDownload size={16} /> Excel</Link>
          <Link href="/products/table" className="btn-secondary btn-sm hidden md:inline-flex"><IconTable size={16} /> Tabla</Link>
        </div>
      </header>

      {/* Resumen */}
      {!loading && total.products > 0 && (
        <div className="animate-in grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat label="Productos" value={String(total.products)} />
          <Stat label="Unidades" value={fmtMoney(total.units)} />
          <Stat label="Valor de venta" value={`Bs ${fmtMoney(total.saleValue)}`} tone="ok" />
          <Link href="/movements" className="rounded-2xl bg-emerald-600 p-3 text-white shadow-card transition hover:brightness-110">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-white/70">Ventas este mes</p>
            <p className="text-xl font-bold tabular-nums">Bs {fmtMoney(salesMonth?.total ?? 0)}</p>
            <p className="text-[11px] text-white/80">{salesMonth ? `${salesMonth.count} venta${salesMonth.count === 1 ? "" : "s"} · ver detalle` : "…"}</p>
          </Link>
        </div>
      )}

      {/* Búsqueda global */}
      <div className="animate-in relative">
        <IconSearch size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
        <input id="inv-search" className="input pl-11" placeholder="Buscar en todo el inventario…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {q ? (
        <SearchResults results={results} categories={categories} />
      ) : loading ? (
        <ListSkeleton rows={4} />
      ) : confirmed.length === 0 ? (
        <div className="animate-in card mx-auto max-w-sm text-center">
          <div className="mx-auto h-[190px] w-[150px]"><IllustrationCapture /></div>
          <h2 className="mt-4 text-lg font-bold">Tu inventario está vacío</h2>
          <p className="mt-1 text-sm text-slate-500">{pendingCount ? `Tienes ${pendingCount} pendientes de revisar.` : "Empieza tomando una foto de un producto."}</p>
          {pendingCount ? (
            <Link href="/review" className="btn-success mt-5 w-full">Revisar pendientes ({pendingCount})</Link>
          ) : (
            <Link href="/capture" className="btn-primary mt-5 w-full"><IconCamera size={18} /> Agregar con foto</Link>
          )}
          <Link href="/products/new" className="btn-secondary mt-2 w-full"><IconPlus size={18} /> Escribirlo a mano</Link>
        </div>
      ) : (
        <>
          {pendingCount > 0 && (
            <Link href="/review" className="animate-in flex items-center gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <IconAlert size={18} className="shrink-0" />
              <span className="flex-1"><b>{pendingCount} pendiente{pendingCount === 1 ? "" : "s"}</b> de revisar todavía no cuentan en el inventario.</span>
              <span className="btn-secondary btn-sm">Revisar</span>
            </Link>
          )}

          {/* Estantes */}
          <ul className="stagger grid gap-3 md:grid-cols-2">
            {shelves.map((s) => {
              const col = categoryColor(s.category.name);
              return (
                <li key={s.category.id}>
                  <Link href={`/products/c/${s.category.id}`} className="press group block rounded-3xl bg-white p-4 shadow-card ring-1 ring-slate-900/10 transition hover:ring-brand-400" style={{ borderTop: `5px solid ${col.dot}` }}>
                    <div className="flex items-center gap-3">
                      <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-2xl ring-1 ${col.bg} ${col.ring}`}>{s.category.icon || "🏷️"}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-lg font-bold text-ink">{s.category.name}</span>
                        <span className="block text-xs text-slate-500">
                          {s.products} producto{s.products === 1 ? "" : "s"} · {fmtMoney(s.units)} unid. · {s.children.length} subcategoría{s.children.length === 1 ? "" : "s"}
                        </span>
                      </span>
                      <IconChevronRight className="shrink-0 text-slate-300 group-hover:text-brand-500" />
                    </div>
                    <AlertLine alerts={s.alerts} />
                    {s.children.length > 0 && (
                      <p className="mt-2 truncate text-xs text-slate-500">
                        {s.children.filter((c) => c.products > 0).map((c) => `${c.category.name} ${c.products}`).join(" · ") || "sin productos en subcategorías"}
                      </p>
                    )}
                    {s.saleValue > 0 && <p className="mt-1 text-xs font-semibold text-emerald-700">Valor de venta Bs {fmtMoney(s.saleValue)}</p>}
                  </Link>
                </li>
              );
            })}
            {orphan.products > 0 && (
              <li>
                <Link href="/products/c/none" className="press group block rounded-3xl border-2 border-dashed border-amber-300 bg-amber-50/60 p-4 transition hover:border-amber-500">
                  <div className="flex items-center gap-3">
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-amber-100 text-amber-700"><IconAlert size={22} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-lg font-bold text-amber-900">Sin categoría</span>
                      <span className="block text-xs text-amber-800">{orphan.products} producto{orphan.products === 1 ? "" : "s"} por ordenar</span>
                    </span>
                    <IconChevronRight className="shrink-0 text-amber-400" />
                  </div>
                </Link>
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: "ok"; hint?: string }) {
  return (
    <div className="rounded-2xl bg-white p-3 shadow-card ring-1 ring-slate-900/10">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${tone === "ok" ? "text-emerald-700" : "text-ink"}`}>{value}</p>
      {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

function AlertLine({ alerts }: { alerts: Alerts }) {
  const items = [
    alerts.agotados ? { t: `${alerts.agotados} agotado${alerts.agotados === 1 ? "" : "s"}`, c: "bg-rose-100 text-rose-700" } : null,
    alerts.sinPrecio ? { t: `${alerts.sinPrecio} sin precio`, c: "bg-amber-100 text-amber-800" } : null,
    alerts.sinFoto ? { t: `${alerts.sinFoto} sin foto`, c: "bg-slate-100 text-slate-600" } : null,
  ].filter(Boolean) as { t: string; c: string }[];
  if (!items.length) return <p className="mt-2 text-xs font-semibold text-emerald-700">✓ todo en orden</p>;
  return (
    <p className="mt-2 flex flex-wrap gap-1.5">
      {items.map((i) => (
        <span key={i.t} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${i.c}`}>⚠ {i.t}</span>
      ))}
    </p>
  );
}

function SearchResults({ results, categories }: { results: Product[]; categories: Category[] }) {
  if (!results.length) return <p className="py-8 text-center text-sm text-slate-500">Nada coincide con tu búsqueda.</p>;
  return (
    <ul className="stagger grid gap-2 md:grid-cols-2">
      {results.map((p) => {
        const stock = stockOf(p);
        const price = priceOf(p);
        return (
          <li key={p.id}>
            <Link href={`/products/${p.id}`} className="press flex items-center gap-3 rounded-2xl bg-white p-3 shadow-card ring-1 ring-slate-900/10 hover:ring-brand-400">
              {p.image_url ? <Photo src={p.image_url} wrapperClassName="h-14 w-14 shrink-0 rounded-xl" className="h-14 w-14 object-cover" /> : <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-400"><IconBox /></span>}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-ink">{productTitle(p.data) || "Sin nombre"}</span>
                <span className="block truncate text-xs text-slate-500">{categoryPath(categories, p.category_id)}</span>
              </span>
              <span className="text-right text-xs">
                {price !== null && <span className="block font-bold text-emerald-700">Bs {fmtMoney(price)}</span>}
                <span className={`block ${(stock ?? 0) <= 0 ? "text-rose-600" : "text-slate-500"}`}>stock {stock ?? "—"}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
