"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Category, FieldTemplate, Product } from "@/types/database";
import { categoryPath, getDescendantIds } from "@/lib/categories";
import { exportToExcel } from "@/lib/export";
import CategorySelect from "@/components/CategorySelect";

type StatusFilter = "confirmed" | "draft" | "all";

export default function ExportPage() {
  const supabase = createClient();
  const [categories, setCategories] = useState<Category[]>([]);
  const [templates, setTemplates] = useState<FieldTemplate[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [includeSub, setIncludeSub] = useState(true);
  const [status, setStatus] = useState<StatusFilter>("confirmed");
  const [sheetPerCategory, setSheetPerCategory] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    (async () => {
      const [c, t, p] = await Promise.all([
        supabase.from("categories").select("*"),
        supabase.from("field_templates").select("*").order("sort_order"),
        supabase.from("products").select("*").order("created_at", { ascending: false }),
      ]);
      setCategories(c.data ?? []);
      setTemplates(t.data ?? []);
      setProducts(p.data ?? []);
      setLoading(false);
    })();
  }, [supabase]);

  const selected = useMemo(() => {
    const ids = categoryId ? new Set(includeSub ? getDescendantIds(categories, categoryId) : [categoryId]) : null;
    return products.filter((p) => {
      if (status !== "all" && p.status !== status) return false;
      if (ids && (!p.category_id || !ids.has(p.category_id))) return false;
      return true;
    });
  }, [products, categories, categoryId, includeSub, status]);

  function doExport() {
    setExporting(true);
    try {
      const base = categoryId ? categoryPath(categories, categoryId).replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase() : "inventario";
      exportToExcel({ products: selected, categories, templates, fileName: base, sheetPerCategory });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Exportar a Excel</h1>
        <p className="text-sm text-slate-500">Genera un .xlsx con las columnas que definiste. Se crea en tu dispositivo.</p>
      </div>

      <div className="card space-y-4">
        <div>
          <label className="label" htmlFor="cat">Categoría</label>
          <CategorySelect id="cat" categories={categories} value={categoryId} onChange={setCategoryId} emptyLabel="Todas las categorías" />
          {categoryId && (
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={includeSub} onChange={(e) => setIncludeSub(e.target.checked)} />
              Incluir subcategorías
            </label>
          )}
        </div>

        <div>
          <label className="label">Estado</label>
          <div className="flex flex-wrap gap-2">
            {(["confirmed", "draft", "all"] as StatusFilter[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`btn px-3 py-1.5 text-xs ${status === s ? "bg-brand-600 text-white" : "border border-slate-300 bg-white text-slate-700"}`}
              >
                {s === "confirmed" ? "Confirmados" : s === "draft" ? "Borradores" : "Todos"}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={sheetPerCategory} onChange={(e) => setSheetPerCategory(e.target.checked)} />
          <span>
            Una hoja por categoría
            <br />
            <span className="text-slate-500">Cada hoja lleva exactamente las columnas de su categoría. Si no, se genera una sola hoja con la unión de columnas.</span>
          </span>
        </label>

        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <span>{loading ? "Cargando..." : `${selected.length} producto(s) a exportar`}</span>
          <button className="btn-primary" onClick={doExport} disabled={loading || exporting || selected.length === 0}>
            ⬇ Descargar .xlsx
          </button>
        </div>
      </div>
    </div>
  );
}
