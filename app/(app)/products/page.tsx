"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import CoachTip from "@/components/CoachTip";
import { cacheGet, cacheSet, isNetworkError } from "@/lib/offline";
import { createClient } from "@/lib/supabase/client";
import type { Category, Product } from "@/types/database";
import { categoryPath } from "@/lib/categories";
import { productTitle } from "@/lib/fields";
import { categoryColor } from "@/lib/colors";
import { useFlow } from "@/components/FlowProvider";
import { SUMMARY_COLS, computeShelves, fmtMoney, fromSummary, priceOf, stockOf, timeAgo, type CategoryStats } from "@/lib/inventory";
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
  const [results, setResults] = useState<Product[] | null>(null); // null = buscando
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [salesMonth, setSalesMonth] = useState<{ total: number; count: number } | null>(null);
  const [variantsOf, setVariantsOf] = useState<Map<string, { stock: number }[]>>(new Map());
  const { alerts, isOwner } = useFlow();

  useEffect(() => {
    (async () => {
      // Vista ligera (≈200 B por producto): nombre, precio, stock y costo ya resueltos en la base
      const [c, p] = await Promise.all([
        supabase.from("categories").select("*"),
        supabase.from("product_summaries").select(SUMMARY_COLS).order("updated_at", { ascending: false }),
      ]);
      if ((c.error && isNetworkError(c.error)) || (p.error && isNetworkError(p.error))) {
        // Sin conexión: última copia guardada en el celular
        const cached = await cacheGet<{ categories: Category[]; products: Product[] }>("inventory");
        if (cached) {
          setCategories(cached.data.categories);
          setProducts(cached.data.products);
          setCachedAt(cached.at);
        }
        setLoading(false);
        return;
      }
      const cats = c.data ?? [];
      const list = (p.data ?? []).map(fromSummary);
      setCategories(cats);
      setProducts(list);
      setLoading(false);
      cacheSet("inventory", { categories: cats, products: list });
      const start = new Date();
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      const [{ data: sales }, { data: vs }] = await Promise.all([
        supabase.from("sales").select("total").gte("created_at", start.toISOString()),
        supabase.from("product_variants").select("product_id,stock"),
      ]);
      setSalesMonth({ total: (sales ?? []).reduce((s, r) => s + Number(r.total ?? 0), 0), count: (sales ?? []).length });
      const m = new Map<string, { stock: number }[]>();
      (vs ?? []).forEach((v) => m.set(v.product_id, [...(m.get(v.product_id) ?? []), { stock: v.stock }]));
      setVariantsOf(m);
    })();
  }, [supabase]);

  const confirmed = useMemo(() => products.filter((p) => p.status === "confirmed"), [products]);
  const { shelves, orphan, total } = useMemo(() => computeShelves(confirmed, categories, variantsOf, alerts), [confirmed, categories, variantsOf, alerts]);
  const pendingCount = products.length - confirmed.length;

  // Búsqueda en el servidor (nombre, marca, descripción, etiqueta, código), con espera de 250 ms
  const q = search.trim().toLowerCase();
  useEffect(() => {
    if (!q) return setResults(null);
    setResults(null);
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("product_summaries")
        .select(SUMMARY_COLS)
        .eq("status", "confirmed")
        .ilike("search", `%${q.replace(/[%_]/g, "")}%`)
        .order("updated_at", { ascending: false })
        .limit(40);
      setResults((data ?? []).map(fromSummary));
    }, 250);
    return () => clearTimeout(t);
  }, [q, supabase]);

  return (
    <div className="space-y-5">
      <header className="animate-in flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Mi inventario</h1>
          <p className="text-sm text-slate-500">{loading ? " " : `${total.products} producto${total.products === 1 ? "" : "s"} en ${shelves.length} categoría${shelves.length === 1 ? "" : "s"}`}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/products/new" className="btn-primary btn-sm"><IconPlus size={16} /> Producto</Link>
          <Link href="/sell" className="btn-success btn-sm"><IconTag size={16} /> Vender</Link>
          <Link href="/purchases" className="btn-secondary btn-sm hidden sm:inline-flex"><IconPlus size={16} /> Compra</Link>
          <Link href="/export" className="btn-secondary btn-sm"><IconDownload size={16} /> Excel</Link>
          <Link href="/products/table" className="btn-secondary btn-sm hidden md:inline-flex"><IconTable size={16} /> Tabla</Link>
        </div>
      </header>

      {cachedAt && (
        <p className="animate-in rounded-2xl bg-slate-800 px-3 py-2 text-center text-xs font-semibold text-white">
          Sin conexión · mostrando el inventario guardado a las {new Date(cachedAt).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}
        </p>
      )}
      <CoachTip screen="products" title="Tu inventario, estante por estante">
        Cada tarjeta es una categoría: toca para ver sus productos y subcategorías. Dentro, <b>+/− Stock</b> registra ventas y reposiciones sin editar nada.
      </CoachTip>

      {/* Resumen */}
      {!loading && total.products > 0 && (
        <div className="animate-in grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Productos" value={String(total.products)} hint={`en ${shelves.length} categoría${shelves.length === 1 ? "" : "s"}`} />
          <Link href="/restock" className="rounded-2xl bg-white p-3 shadow-card ring-1 ring-slate-900/10 transition hover:ring-orange-400">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Por reponer</p>
            <p className={`text-xl font-bold tabular-nums ${total.alerts.porReponer ? "text-orange-700" : "text-ink"}`}>{total.alerts.porReponer}</p>
            <p className="truncate text-[11px] text-slate-400">{total.alerts.porReponer ? "ver lista de reposición" : `${fmtMoney(total.units)} unidades en total`}</p>
          </Link>
          <Stat label="Valor de venta" value={`Bs ${fmtMoney(total.saleValue)}`} tone="ok" hint="precio × stock" />
          {!isOwner ? (
            <Stat label="Categorías" value={String(shelves.length)} hint="estantes" />
          ) : total.costValue > 0 ? (
            <Stat label="Ganancia estimada" value={`Bs ${fmtMoney(total.saleValue - total.costValue)}`} tone="ok" hint={`costo Bs ${fmtMoney(total.costValue)}`} />
          ) : (
            <Stat label="Ganancia estimada" value="—" hint="agrega precio de compra" />
          )}
          <Stat
            label="Por atender"
            value={String(total.alerts.agotados + total.alerts.sinPrecio + total.alerts.porVencer)}
            tone={total.alerts.agotados + total.alerts.sinPrecio + total.alerts.porVencer ? "warn" : undefined}
            hint={
              total.alerts.agotados + total.alerts.sinPrecio + total.alerts.porVencer
                ? [total.alerts.agotados ? `${total.alerts.agotados} agotados` : "", total.alerts.sinPrecio ? `${total.alerts.sinPrecio} sin precio` : "", total.alerts.porVencer ? `${total.alerts.porVencer} por vencer` : "", total.alerts.variantesAgotadas ? `${total.alerts.variantesAgotadas} variantes en 0` : ""].filter(Boolean).join(" · ")
                : total.alerts.variantesAgotadas
                  ? `${total.alerts.variantesAgotadas} variantes agotadas`
                  : "todo en orden"
            }
          />
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
        results === null ? <ListSkeleton rows={3} /> : <SearchResults results={results} categories={categories} />
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
          <ul className="stagger grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {shelves.map((s) => {
              const col = categoryColor(s.category.name);
              return (
                <li key={s.category.id} className="min-w-0">
                  <Link href={`/products/c/${s.category.id}`} className="press group flex h-full flex-col rounded-3xl bg-white p-4 shadow-card ring-1 ring-slate-900/10 transition hover:ring-brand-400" style={{ borderTop: `5px solid ${col.dot}` }}>
                    <div className="flex items-center gap-3">
                      <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-2xl ring-1 ${col.bg} ${col.ring}`}>{s.category.icon || "🏷️"}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-lg font-bold text-ink">{s.category.name}</span>
                        <span className="block text-xs text-slate-500">
                          {s.products} producto{s.products === 1 ? "" : "s"} · {s.children.length} subcategoría{s.children.length === 1 ? "" : "s"}
                        </span>
                      </span>
                      <IconChevronRight className="shrink-0 text-slate-300 group-hover:text-brand-500" />
                    </div>

                    {/* Cifras */}
                    <dl className="mt-3 grid grid-cols-3 gap-2">
                      <Mini label="Unidades" value={fmtMoney(s.units)} />
                      <Mini label="Valor venta" value={s.saleValue > 0 ? `Bs ${fmtMoney(s.saleValue)}` : "—"} tone="ok" />
                      {isOwner && s.costValue > 0 ? (
                        <Mini label="Ganancia" value={`Bs ${fmtMoney(s.saleValue - s.costValue)}`} tone="ok" />
                      ) : (
                        <Mini label="Poco stock" value={String(s.lowStock)} tone={s.lowStock ? "warn" : undefined} />
                      )}
                    </dl>

                    <AlertLine stats={s} />

                    {/* Subcategorías */}
                    {s.children.length > 0 && (
                      <p className="mt-2 flex flex-wrap gap-1">
                        {s.children.slice(0, 6).map((c) => (
                          <span key={c.category.id} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${c.products ? `${col.bg} ${col.text}` : "bg-slate-100 text-slate-400"}`}>
                            {c.category.name} <b>{c.products}</b>
                          </span>
                        ))}
                        {s.children.length > 6 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">+{s.children.length - 6}</span>}
                      </p>
                    )}

                    {/* Pie: último agregado y el más valioso */}
                    {(s.lastAdded || s.topProduct) && (
                      <p className="mt-auto pt-3 text-[11px] leading-snug text-slate-500">
                        {s.lastAdded && <span className="block truncate">Último agregado <b className="text-slate-700">{timeAgo(s.lastAdded)}</b></span>}
                        {s.topProduct && (
                          <span className="block truncate">
                            Más valor en stock: <b className="text-slate-700">{productTitle(s.topProduct.product.data) || "Sin nombre"}</b> · Bs {fmtMoney(s.topProduct.value)}
                          </span>
                        )}
                      </p>
                    )}
                  </Link>
                </li>
              );
            })}
            {orphan.products > 0 && (
              <li>
                <Link href="/products/c/none" className="press group flex h-full flex-col justify-center rounded-3xl border-2 border-dashed border-amber-300 bg-amber-50/60 p-4 transition hover:border-amber-500">
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

const TONE = { ok: "text-emerald-700", warn: "text-amber-700", none: "text-ink" };

function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: "ok" | "warn"; hint?: string }) {
  return (
    <div className="rounded-2xl bg-white p-3 shadow-card ring-1 ring-slate-900/10">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${TONE[tone ?? "none"]}`}>{value}</p>
      {hint && <p className="truncate text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  return (
    <div className="min-w-0 rounded-xl bg-slate-50 px-2 py-1.5">
      <dt className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={`m-0 truncate text-sm font-bold tabular-nums ${TONE[tone ?? "none"]}`}>{value}</dd>
    </div>
  );
}

function AlertLine({ stats }: { stats: CategoryStats }) {
  const { alerts } = stats;
  const items = [
    alerts.agotados ? { t: `${alerts.agotados} agotado${alerts.agotados === 1 ? "" : "s"}`, c: "bg-rose-100 text-rose-700" } : null,
    alerts.porReponer - alerts.agotados > 0 ? { t: `${alerts.porReponer - alerts.agotados} por reponer`, c: "bg-orange-100 text-orange-800" } : null,
    alerts.porVencer ? { t: `${alerts.porVencer} por vencer`, c: "bg-amber-100 text-amber-800" } : null,
    alerts.variantesAgotadas ? { t: `${alerts.variantesAgotadas} variante${alerts.variantesAgotadas === 1 ? "" : "s"} agotada${alerts.variantesAgotadas === 1 ? "" : "s"}`, c: "bg-rose-100 text-rose-700" } : null,
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
    <ul className="stagger grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
      {results.map((p) => {
        const stock = stockOf(p);
        const price = priceOf(p);
        return (
          <li key={p.id} className="min-w-0">
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
