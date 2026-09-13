"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Category, FieldTemplate, Product, ProductStatus } from "@/types/database";
import { getDescendantIds } from "@/lib/categories";
import CategorySelect from "./CategorySelect";
import ProductTable from "./ProductTable";

interface Props {
  mode: ProductStatus;
  title: string;
  subtitle: string;
}

/** Página compartida para /drafts y /products: filtro por categoría + tabla editable. */
export default function ProductListPage({ mode, title, subtitle }: Props) {
  const supabase = createClient();
  const [categories, setCategories] = useState<Category[]>([]);
  const [templates, setTemplates] = useState<FieldTemplate[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [filter, setFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [c, t, p] = await Promise.all([
      supabase.from("categories").select("*"),
      supabase.from("field_templates").select("*").order("sort_order"),
      supabase.from("products").select("*").eq("status", mode).order("created_at", { ascending: false }),
    ]);
    setCategories(c.data ?? []);
    setTemplates(t.data ?? []);
    setProducts(p.data ?? []);
    setLoading(false);
  }, [supabase, mode]);

  useEffect(() => {
    load();
  }, [load]);

  const allowedIds = filter ? new Set(getDescendantIds(categories, filter)) : null;
  const q = search.trim().toLowerCase();
  const visible = products.filter((p) => {
    if (allowedIds && (!p.category_id || !allowedIds.has(p.category_id))) return false;
    if (q && !JSON.stringify(p.data).toLowerCase().includes(q)) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="text-sm text-slate-500">{subtitle}</p>
        </div>
        {mode === "draft" && (
          <Link href="/capture" className="btn-primary">📷 Nueva foto</Link>
        )}
        {mode === "confirmed" && (
          <Link href="/export" className="btn-secondary">⬇ Exportar Excel</Link>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <CategorySelect categories={categories} value={filter} onChange={setFilter} emptyLabel="Todas las categorías" />
        <input className="input" placeholder="Buscar en los datos..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Cargando...</p>
      ) : (
        <>
          <p className="text-xs text-slate-500">
            {visible.length} de {products.length} · Desliza horizontalmente para ver todas las columnas.
          </p>
          <ProductTable products={visible} categories={categories} templates={templates} mode={mode} onChanged={load} />
        </>
      )}
    </div>
  );
}
