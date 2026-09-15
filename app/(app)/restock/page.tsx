"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Category, Product, ProductVariant } from "@/types/database";
import { categoryPath } from "@/lib/categories";
import { SUMMARY_COLS, daysToExpiry, expiringSoon, fmtMoney, fromSummary, minStockOf, needsRestock, stockOf } from "@/lib/inventory";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { IconArrowLeft, IconDownload, IconTag } from "@/components/ui/Icons";

export default function RestockPage() {
  return (
    <Suspense>
      <Restock />
    </Suspense>
  );
}

interface Line {
  key: string;
  productId: string;
  name: string;
  variant: string | null;
  where: string;
  stock: number;
  min: number;
  suggested: number;
  supplier: string | null;
}

/** Lista de reposición: todo lo que está bajo su mínimo (por producto y por variante), lista para pedir. */
function Restock() {
  const params = useSearchParams();
  const supabase = createClient();
  const toast = useToast();
  const [tab, setTab] = useState<"reponer" | "vencer">(params.get("tab") === "vencer" ? "vencer" : "reponer");
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [lastSupplier, setLastSupplier] = useState<Map<string, string>>(new Map());
  const [qty, setQty] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [c, p, v, pi] = await Promise.all([
        supabase.from("categories").select("*"),
        supabase.from("product_summaries").select(SUMMARY_COLS).eq("status", "confirmed"),
        supabase.from("product_variants").select("*"),
        supabase.from("purchase_items").select("product_id,purchase_id,created_at,purchases(supplier_name)").order("created_at", { ascending: false }).limit(500),
      ]);
      setCategories(c.data ?? []);
      setProducts((p.data ?? []).map(fromSummary));
      setVariants((v.data ?? []) as ProductVariant[]);
      const m = new Map<string, string>();
      (pi.data ?? []).forEach((r) => {
        const name = (r as unknown as { purchases?: { supplier_name?: string | null } | null }).purchases?.supplier_name;
        if (r.product_id && name && !m.has(r.product_id)) m.set(r.product_id, name);
      });
      setLastSupplier(m);
      setLoading(false);
    })();
  }, [supabase]);

  const lines = useMemo<Line[]>(() => {
    const out: Line[] = [];
    const byProduct = new Map<string, ProductVariant[]>();
    variants.forEach((v) => byProduct.set(v.product_id, [...(byProduct.get(v.product_id) ?? []), v]));
    for (const p of products) {
      const name = String(p.data.nombre || "Sin nombre");
      const where = p.category_id ? categoryPath(categories, p.category_id) : "Sin categoría";
      const vs = byProduct.get(p.id);
      if (vs?.length) {
        // Con variantes: el mínimo del producto aplica a cada variante salvo que la variante tenga el suyo
        const pmin = minStockOf(p, categories);
        vs.forEach((v) => {
          const min = typeof v.min_stock === "number" ? v.min_stock : pmin;
          if (v.stock <= min) out.push({ key: v.id, productId: p.id, name, variant: v.label, where, stock: v.stock, min, suggested: Math.max(1, min * 2 - v.stock), supplier: lastSupplier.get(p.id) ?? null });
        });
      } else if (needsRestock(p, categories)) {
        const min = minStockOf(p, categories);
        const stock = stockOf(p) ?? 0;
        out.push({ key: p.id, productId: p.id, name, variant: null, where, stock, min, suggested: Math.max(1, min * 2 - stock), supplier: lastSupplier.get(p.id) ?? null });
      }
    }
    return out.sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name, "es"));
  }, [products, variants, categories, lastSupplier]);

  const expiring = useMemo(
    () => products.filter(expiringSoon).map((p) => ({ p, days: daysToExpiry(p.expires_at) ?? 0 })).sort((a, b) => a.days - b.days),
    [products]
  );

  const qtyOf = (l: Line) => Math.max(0, parseInt(qty[l.key] ?? String(l.suggested), 10) || 0);
  const grouped = useMemo(() => {
    const g = new Map<string, Line[]>();
    lines.forEach((l) => {
      const k = l.supplier ?? "Sin proveedor";
      g.set(k, [...(g.get(k) ?? []), l]);
    });
    return Array.from(g.entries()).sort(([a], [b]) => (a === "Sin proveedor" ? 1 : b === "Sin proveedor" ? -1 : a.localeCompare(b, "es")));
  }, [lines]);

  function whatsappText(only?: string) {
    const parts: string[] = ["*Pedido de reposición*", new Date().toLocaleDateString("es"), ""];
    grouped
      .filter(([sup]) => !only || sup === only)
      .forEach(([sup, ls]) => {
        if (!only) parts.push(`*${sup}*`);
        ls.forEach((l) => qtyOf(l) > 0 && parts.push(`• ${l.name}${l.variant ? ` (${l.variant})` : ""} × ${qtyOf(l)}`));
        parts.push("");
      });
    return parts.join("\n").trim();
  }
  function share(only?: string) {
    const text = whatsappText(only);
    if (!text) return;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  }
  async function excel() {
    const XLSX = await import("xlsx");
    const rows = lines.map((l) => ({ Proveedor: l.supplier ?? "", Producto: l.name, Variante: l.variant ?? "", Ubicación: l.where, "Stock actual": l.stock, Mínimo: l.min, "Cantidad a pedir": qtyOf(l) }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Reposición");
    XLSX.writeFile(wb, `reposicion-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast("success", "Excel descargado");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="animate-in">
        <Link href="/products" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"><IconArrowLeft size={16} /> Mi inventario</Link>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Por reponer y por vencer</h1>
        <p className="text-sm text-slate-500">Lo que está bajo su stock mínimo, listo para pedir; y lo que vence pronto.</p>
      </header>

      <div className="animate-in grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
        <button onClick={() => setTab("reponer")} className={`rounded-xl px-2 py-2 text-sm font-semibold ${tab === "reponer" ? "bg-white text-ink shadow" : "text-slate-500"}`}>Por reponer {lines.length ? <span className="ml-1 rounded-full bg-orange-100 px-1.5 text-xs text-orange-800">{lines.length}</span> : null}</button>
        <button onClick={() => setTab("vencer")} className={`rounded-xl px-2 py-2 text-sm font-semibold ${tab === "vencer" ? "bg-white text-ink shadow" : "text-slate-500"}`}>Por vencer {expiring.length ? <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-xs text-amber-800">{expiring.length}</span> : null}</button>
      </div>

      {loading ? (
        <ListSkeleton rows={5} />
      ) : tab === "reponer" ? (
        lines.length === 0 ? (
          <div className="animate-in card text-center">
            <p className="text-lg font-bold text-ink">Nada por reponer</p>
            <p className="mt-1 text-sm text-slate-500">Todos los productos están por encima de su stock mínimo. Puedes ajustar los mínimos en la ficha de cada producto o por categoría en Mi tienda.</p>
          </div>
        ) : (
          <>
            <div className="animate-in flex flex-wrap gap-2">
              <button onClick={() => share()} className="btn-success"><IconTag size={16} /> Compartir pedido por WhatsApp</button>
              <button onClick={excel} className="btn-secondary"><IconDownload size={16} /> Excel</button>
            </div>
            {grouped.map(([sup, ls]) => (
              <section key={sup} className="animate-in card space-y-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-bold text-ink">{sup} <span className="font-normal text-slate-500">· {ls.length}</span></h2>
                  {sup !== "Sin proveedor" && <button onClick={() => share(sup)} className="btn-secondary btn-sm">WhatsApp</button>}
                </div>
                <ul className="divide-y divide-slate-100">
                  {ls.map((l) => (
                    <li key={l.key} className="flex items-center gap-3 py-2">
                      <Link href={`/products/${l.productId}`} className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-ink">{l.name}{l.variant ? <span className="text-violet-800"> · {l.variant}</span> : null}</span>
                        <span className="block truncate text-xs text-slate-500">{l.where} · stock <b className={l.stock <= 0 ? "text-rose-600" : "text-orange-700"}>{l.stock}</b> · mín. {l.min}</span>
                      </Link>
                      <label className="flex items-center gap-1 text-xs text-slate-500">
                        pedir
                        <input type="number" min={0} inputMode="numeric" className="input w-20 py-1 text-center text-sm font-bold tabular-nums" value={qty[l.key] ?? String(l.suggested)} onChange={(e) => setQty({ ...qty, [l.key]: e.target.value })} />
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <p className="text-center text-[11px] text-slate-500">La cantidad sugerida repone hasta el doble del mínimo. Cámbiala antes de compartir.</p>
          </>
        )
      ) : expiring.length === 0 ? (
        <div className="animate-in card text-center">
          <p className="text-lg font-bold text-ink">Nada por vencer</p>
          <p className="mt-1 text-sm text-slate-500">Ningún producto vence en los próximos 30 días. La fecha se pone en la ficha del producto («Vence el») o al registrar una compra.</p>
        </div>
      ) : (
        <ul className="stagger space-y-2">
          {expiring.map(({ p, days }) => (
            <li key={p.id}>
              <Link href={`/products/${p.id}`} className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-card ring-1 ring-slate-900/10 hover:ring-brand-400">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink">{String(p.data.nombre || "Sin nombre")}</span>
                  <span className="block truncate text-xs text-slate-500">{p.category_id ? categoryPath(categories, p.category_id) : "Sin categoría"} · {stockOf(p) ?? 0} en stock · Bs {fmtMoney((Number(p.data.precio) || 0) * (stockOf(p) ?? 0))} en juego</span>
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${days < 0 ? "bg-rose-600 text-white" : days <= 7 ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"}`}>
                  {days < 0 ? `vencido ${-days} d` : days === 0 ? "hoy" : `${days} d`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
