"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Category, FieldTemplate, Product, ProductVariant, VariantAxis } from "@/types/database";
import { categoryPath, getDescendantIds } from "@/lib/categories";
import { withCosts } from "@/lib/data/costs";
import { friendlyError } from "@/lib/errors";
import CategoryPicker from "@/components/CategoryPicker";
import { useToast } from "@/components/ui/Toast";
import { IconDownload, Spinner } from "@/components/ui/Icons";

type StatusFilter = "confirmed" | "draft" | "all";

/**
 * Descargar Excel (antes /export): todo o una categoría, en inventario / pendientes / todo, una hoja por
 * subcategoría si se quiere. La librería de Excel se carga solo al descargar (`lib/export` la importa dinámicamente).
 * Los productos se piden recién al abrir esta tarjeta (no al entrar a Ajustes).
 */
export default function ExportCard() {
  const supabase = createClient();
  const toast = useToast();
  const [data, setData] = useState<{ categories: Category[]; templates: FieldTemplate[]; products: Product[]; variants: ProductVariant[]; axes: VariantAxis[] } | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [includeSub, setIncludeSub] = useState(true);
  const [status, setStatus] = useState<StatusFilter>("confirmed");
  const [perCategory, setPerCategory] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const [c, t, p, v, a] = await Promise.all([
        supabase.from("categories").select("*"),
        supabase.from("field_templates").select("*").order("sort_order"),
        supabase.from("products").select("*").is("deleted_at", null).order("created_at", { ascending: false }),
        supabase.from("product_variants").select("*"),
        supabase.from("variant_axes").select("*"),
      ]);
      setData({
        categories: c.data ?? [],
        templates: t.data ?? [],
        products: await withCosts(supabase, p.data ?? []), // costo (025): solo el dueño exporta
        variants: (v.data ?? []) as ProductVariant[],
        axes: (a.data ?? []) as VariantAxis[],
      });
    })();
  }, [supabase]);

  const selected = useMemo(() => {
    if (!data) return [];
    const ids = categoryId ? new Set(includeSub ? getDescendantIds(data.categories, categoryId) : [categoryId]) : null;
    return data.products.filter((p) => (status === "all" || p.status === status) && (!ids || (p.category_id && ids.has(p.category_id))));
  }, [data, categoryId, includeSub, status]);

  async function download() {
    if (!data) return;
    setBusy(true);
    try {
      const { exportToExcel } = await import("@/lib/export");
      const base = categoryId ? categoryPath(data.categories, categoryId).replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase() : "inventario";
      await exportToExcel({ products: selected, categories: data.categories, templates: data.templates, fileName: base, sheetPerCategory: perCategory, variants: data.variants, axes: data.axes });
    } catch (e) {
      toast("error", friendlyError(e, "No se pudo generar el Excel"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="label">Categoría</p>
        <CategoryPicker categories={data?.categories ?? []} value={categoryId} onChange={setCategoryId} allowCreate={false} emptyLabel="Todas las categorías" />
        {categoryId && (
          <label className="mt-2 flex min-h-[44px] items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5" checked={includeSub} onChange={(e) => setIncludeSub(e.target.checked)} /> Incluir subcategorías
          </label>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {(["confirmed", "draft", "all"] as StatusFilter[]).map((s) => (
          <button key={s} type="button" onClick={() => setStatus(s)} className={`chip min-h-[40px] ${status === s ? "chip-active" : ""}`}>
            {s === "confirmed" ? "En inventario" : s === "draft" ? "Pendientes" : "Todo"}
          </button>
        ))}
      </div>
      <label className="flex min-h-[44px] items-start gap-3 text-sm">
        <input type="checkbox" className="mt-0.5 h-5 w-5" checked={perCategory} onChange={(e) => setPerCategory(e.target.checked)} />
        <span>
          Una hoja por subcategoría
          <span className="block text-xs text-muted">Cada hoja con las columnas de su categoría. Si no, todo va en una sola hoja.</span>
        </span>
      </label>
      <button type="button" onClick={download} disabled={!data || busy || selected.length === 0} className="btn-primary min-h-[48px] w-full">
        {busy || !data ? <Spinner /> : <IconDownload size={18} />} {data ? `Descargar ${selected.length} producto${selected.length === 1 ? "" : "s"}` : "Cargando…"}
      </button>
    </div>
  );
}
