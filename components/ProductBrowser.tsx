"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Category, Product, ProductVariant } from "@/types/database";
import { fromSummary, money, stockOf, SUMMARY_COLS } from "@/lib/inventory";
import { getDescendantIds } from "@/lib/categories";
import { productTitle } from "@/lib/fields";
import { suggestedPrice } from "@/lib/sales";
import { cachedInventory, isNetworkError, localVariants } from "@/lib/offline";
import Photo from "./ui/Photo";
import VariantPickSheet from "./VariantPickSheet";
import { IconBox, IconChevronRight } from "./ui/Icons";

const PAGE = 20;
const ALL = "__all";

/**
 * Lista de productos para quien no recuerda el nombre (R3 · R4): categorías y subcategorías en chips, y los
 * productos de 20 en 20, ordenados por nombre. Tocar uno lo agrega (si tiene tallas o colores, pregunta cuál).
 * Se usa debajo del buscador en Vender y en Entrada de inventario. Sin conexión, lee la copia del celular.
 */
export default function ProductBrowser({
  onPick,
  inList,
  showPrice = true,
  disableOutOfStockVariants = false,
  title = "Todos los productos",
}: {
  onPick: (product: Product, variant: ProductVariant | null) => void;
  /** Cuántas unidades de ese producto ya están en la venta o la entrada (se marca en la fila) */
  inList?: (productId: string) => number;
  showPrice?: boolean;
  disableOutOfStockVariants?: boolean;
  title?: string;
}) {
  const supabase = createClient();
  const [open, setOpen] = useState(true);
  const [cats, setCats] = useState<Category[]>([]);
  const [top, setTop] = useState<string>(ALL);
  const [sub, setSub] = useState<string>(ALL);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Product[] | null>(null);
  const [count, setCount] = useState(0);
  const [offline, setOffline] = useState(false);
  const [picking, setPicking] = useState<{ product: Product; variants: ProductVariant[] } | null>(null);

  useEffect(() => {
    supabase
      .from("categories")
      .select("*")
      .order("name")
      .then(async ({ data, error }) => setCats(error && isNetworkError(error) ? (await cachedInventory())?.data.categories ?? [] : ((data ?? []) as Category[])));
  }, [supabase]);

  const tops = useMemo(() => cats.filter((c) => !c.parent_id).sort((a, b) => a.name.localeCompare(b.name, "es")), [cats]);
  const subs = useMemo(() => (top === ALL ? [] : cats.filter((c) => c.parent_id === top).sort((a, b) => a.name.localeCompare(b.name, "es"))), [cats, top]);
  const scope = useMemo(() => {
    const id = sub !== ALL ? sub : top !== ALL ? top : null;
    return id ? getDescendantIds(cats, id) : null;
  }, [cats, top, sub]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setRows(null);
    (async () => {
      let q = supabase.from("product_summaries").select(SUMMARY_COLS, { count: "exact" }).eq("status", "confirmed").order("nombre").range(page * PAGE, page * PAGE + PAGE - 1);
      if (scope) q = q.in("category_id", scope);
      const { data, error, count: n } = await q;
      if (!alive) return;
      if (error && isNetworkError(error)) {
        const inv = (await cachedInventory())?.data;
        const all = (inv?.products ?? [])
          .filter((p) => p.status === "confirmed" && (!scope || (p.category_id && scope.includes(p.category_id))))
          .sort((a, b) => String(a.data.nombre ?? "").localeCompare(String(b.data.nombre ?? ""), "es"));
        setOffline(true);
        setCount(all.length);
        setRows(all.slice(page * PAGE, page * PAGE + PAGE));
        return;
      }
      setOffline(false);
      setCount(n ?? 0);
      setRows((data ?? []).map(fromSummary));
    })();
    return () => {
      alive = false;
    };
  }, [supabase, scope, page, open]);

  async function pick(p: Product) {
    const { data, error } = await supabase.from("product_variants").select("*").eq("product_id", p.id).order("created_at");
    const vs = error && isNetworkError(error) ? await localVariants(p.id) : ((data ?? []) as ProductVariant[]);
    if (vs.length) return setPicking({ product: p, variants: vs });
    onPick(p, null);
    navigator.vibrate?.(10);
  }

  const pages = Math.max(1, Math.ceil(count / PAGE));
  const chooseTop = (id: string) => {
    setTop(id);
    setSub(ALL);
    setPage(0);
  };
  const chooseSub = (id: string) => {
    setSub(id);
    setPage(0);
  };

  return (
    <section className="card space-y-2 p-3">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-h-[44px] w-full items-center gap-2 text-left" aria-expanded={open}>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-ink">{title}</span>
          <span className="block text-xs text-muted">{open ? "Elige una categoría y toca el producto" : "Ver la lista por categorías"}</span>
        </span>
        <IconChevronRight className={`shrink-0 text-brand-600 transition ${open ? "rotate-90" : ""}`} />
      </button>

      {open && (
        <>
          {/* Categorías */}
          <div className="no-scrollbar -mx-3 flex gap-1.5 overflow-x-auto px-3" role="tablist" aria-label="Categorías">
            {[{ id: ALL, name: "Todas", icon: null as string | null }, ...tops].map((c) => (
              <button key={c.id} type="button" onClick={() => chooseTop(c.id)} className={`chip min-h-[40px] shrink-0 ${top === c.id ? "chip-active" : ""}`} aria-pressed={top === c.id}>
                {c.icon ? `${c.icon} ` : ""}{c.name}
              </button>
            ))}
          </div>
          {subs.length > 0 && (
            <div className="no-scrollbar -mx-3 flex gap-1.5 overflow-x-auto px-3" aria-label="Subcategorías">
              {[{ id: ALL, name: "Toda la categoría" }, ...subs].map((c) => (
                <button key={c.id} type="button" onClick={() => chooseSub(c.id)} className={`min-h-[36px] shrink-0 rounded-full border px-3 text-xs font-semibold ${sub === c.id ? "border-violet-600 bg-violet-600 text-white" : "border-slate-200 bg-white text-slate-600"}`} aria-pressed={sub === c.id}>
                  {c.name}
                </button>
              ))}
            </div>
          )}

          {/* Productos */}
          {rows === null ? (
            <ul className="space-y-1" aria-hidden>
              {Array.from({ length: 4 }, (_, i) => <li key={i} className="h-[52px] animate-pulse rounded-xl bg-slate-100" />)}
            </ul>
          ) : rows.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted">No hay productos en esta categoría.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rows.map((p) => {
                const stock = stockOf(p) ?? 0;
                const n = inList?.(p.id) ?? 0;
                return (
                  <li key={p.id}>
                    <button type="button" onClick={() => pick(p)} className="flex min-h-[52px] w-full items-center gap-2.5 py-1.5 text-left hover:bg-brand-50">
                      {p.image_url ? (
                        <Photo src={p.image_url} wrapperClassName="h-10 w-10 shrink-0 rounded-lg" className="h-10 w-10 object-cover" />
                      ) : (
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-400"><IconBox size={18} /></span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ink">{productTitle(p.data) || "Sin nombre"}</span>
                        <span className={`block text-xs ${stock <= 0 ? "font-semibold text-danger-600" : "text-muted"}`}>{stock <= 0 ? "Agotado" : `${stock} en stock`}</span>
                      </span>
                      {n > 0 && <span className="shrink-0 rounded-full bg-ok-100 px-2 py-0.5 text-xs font-bold text-ok-800">×{n}</span>}
                      {showPrice && <span className="shrink-0 text-sm font-bold tabular-nums text-ink">{money(suggestedPrice(p, null))}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Páginas */}
          {count > PAGE && (
            <div className="flex items-center justify-between gap-2 pt-1">
              <button type="button" onClick={() => setPage((x) => Math.max(0, x - 1))} disabled={page === 0} className="btn-secondary min-h-[44px] px-3 disabled:opacity-40">‹ Anterior</button>
              <span className="text-xs text-muted">{page * PAGE + 1}–{Math.min(count, page * PAGE + PAGE)} de {count}</span>
              <button type="button" onClick={() => setPage((x) => Math.min(pages - 1, x + 1))} disabled={page >= pages - 1} className="btn-secondary min-h-[44px] px-3 disabled:opacity-40">Siguiente ›</button>
            </div>
          )}
          {offline && <p className="text-xs text-muted">Sin conexión: lista guardada en el celular.</p>}
        </>
      )}

      <VariantPickSheet
        picking={picking}
        disableOutOfStock={disableOutOfStockVariants}
        onClose={() => setPicking(null)}
        onPick={(p, v) => {
          onPick(p, v);
          setPicking(null);
          navigator.vibrate?.(10);
        }}
      />
    </section>
  );
}
