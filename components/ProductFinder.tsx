"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Product, ProductVariant } from "@/types/database";
import { fromSummary, money, stockOf, SUMMARY_COLS } from "@/lib/inventory";
import { productTitle } from "@/lib/fields";
import { suggestedPrice } from "@/lib/sales";
import { isNetworkError, localByCode, localFind, localVariants } from "@/lib/offline";
import BarcodeCamera from "./BarcodeCamera";
import VariantPickSheet from "./VariantPickSheet";
import { useToast } from "./ui/Toast";
import { IconSearch, IconX } from "./ui/Icons";

/**
 * Encontrar un producto siempre igual (C7 · §2.3): buscar por nombre/marca/código o escanear.
 * Si el producto tiene variantes (talla, color…) pregunta cuál. Se usa en Vender, Entrada de mercadería y Contar.
 * Sin conexión busca y escanea en la copia del inventario guardada en el celular (lib/offline).
 */
export default function ProductFinder({
  onPick,
  placeholder = "Buscar por nombre, marca o código…",
  showStock = true,
  disableOutOfStockVariants = false,
}: {
  onPick: (product: Product, variant: ProductVariant | null) => void;
  placeholder?: string;
  showStock?: boolean;
  /** En Vender, las variantes en 0 se muestran apagadas (igual se pueden elegir con el escáner) */
  disableOutOfStockVariants?: boolean;
}) {
  const supabase = createClient();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [picking, setPicking] = useState<{ product: Product; variants: ProductVariant[] } | null>(null);

  useEffect(() => {
    const term = q.trim().toLowerCase().replace(/[%_]/g, "");
    if (!term) return setResults([]);
    const t = setTimeout(async () => {
      const { data, error } = await supabase.from("product_summaries").select(SUMMARY_COLS).eq("status", "confirmed").ilike("search", `%${term}%`).order("nombre").limit(12);
      setResults(error && isNetworkError(error) ? await localFind(term) : (data ?? []).map(fromSummary));
    }, 200);
    return () => clearTimeout(t);
  }, [q, supabase]);

  function done(p: Product, v: ProductVariant | null) {
    onPick(p, v);
    setPicking(null);
    setQ("");
    setResults([]);
    navigator.vibrate?.(10);
  }

  async function pick(p: Product) {
    const { data, error } = await supabase.from("product_variants").select("*").eq("product_id", p.id).order("created_at");
    const vs = error && isNetworkError(error) ? await localVariants(p.id) : ((data ?? []) as ProductVariant[]);
    if (vs.length) return setPicking({ product: p, variants: vs });
    done(p, null);
  }

  async function onCode(code: string) {
    let json: { found?: string; product?: Product; variant?: ProductVariant | null; variants?: ProductVariant[] };
    try {
      const res = await fetch(`/api/barcode?code=${encodeURIComponent(code)}`);
      json = await res.json().catch(() => ({}));
    } catch (e) {
      if (!isNetworkError(e)) throw e;
      const local = await localByCode(code);
      json = local ? { found: "own", ...local } : {};
    }
    if (json.found !== "own" || !json.product) return toast("info", `Código ${code}: no está en tu inventario`);
    if (json.variant) return done(json.product, json.variant);
    if (json.variants?.length) return setPicking({ product: json.product, variants: json.variants });
    done(json.product, null);
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <IconSearch size={20} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
        <input className="input min-h-[52px] pl-12 pr-12 text-base" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar producto" />
        {q && (
          <button type="button" onClick={() => setQ("")} className="absolute right-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full text-muted hover:bg-slate-100" aria-label="Borrar búsqueda">
            <IconX size={18} />
          </button>
        )}
        {results.length > 0 && (
          <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto overscroll-contain rounded-2xl bg-white p-1 shadow-2xl ring-1 ring-slate-900/10">
            {results.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => pick(p)} className="flex min-h-[52px] w-full items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-brand-50">
                  <span className="min-w-0 flex-1 truncate text-base font-semibold text-ink">{productTitle(p.data) || "Sin nombre"}</span>
                  <span className="shrink-0 text-right text-xs text-muted">
                    <span className="block font-semibold text-ink">{money(suggestedPrice(p, null))}</span>
                    {showStock && <span className={(stockOf(p) ?? 0) <= 0 ? "text-danger-600" : ""}>{stockOf(p) ?? 0} en stock</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {q.trim() && results.length === 0 && <p className="mt-1 px-1 text-xs text-muted">Sin resultados por ahora…</p>}
      </div>
      <BarcodeCamera onCode={onCode} label="Escanear código" />

      <VariantPickSheet picking={picking} onPick={(p, v) => done(p, v)} onClose={() => setPicking(null)} showStock={showStock} disableOutOfStock={disableOutOfStockVariants} />
    </div>
  );
}
