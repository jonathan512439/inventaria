"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Category, FieldTemplate, Product } from "@/types/database";
import ProductTable from "@/components/ProductTable";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { IconArrowLeft, IconDownload } from "@/components/ui/Icons";

/** Vista de tabla completa (escritorio): agrupada por categoría › subcategoría, con edición en línea. */
export default function InventoryTablePage() {
  const supabase = createClient();
  const [categories, setCategories] = useState<Category[]>([]);
  const [templates, setTemplates] = useState<FieldTemplate[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [c, t, p] = await Promise.all([
      supabase.from("categories").select("*"),
      supabase.from("field_templates").select("*").order("sort_order"),
      supabase.from("products").select("*").eq("status", "confirmed").is("deleted_at", null).order("updated_at", { ascending: false }),
    ]);
    setCategories(c.data ?? []);
    setTemplates(t.data ?? []);
    setProducts((p.data ?? []) as Product[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <header className="animate-in flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/products" className="mb-1 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"><IconArrowLeft size={16} /> Mi inventario</Link>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Tabla completa</h1>
          <p className="text-sm text-slate-500">Edita precio y stock en línea. Agrupado por categoría y subcategoría.</p>
        </div>
        <Link href="/export" className="btn-secondary btn-sm"><IconDownload size={16} /> Excel</Link>
      </header>
      {loading ? <ListSkeleton rows={5} /> : <ProductTable products={products} categories={categories} templates={templates} mode="confirmed" onChanged={load} />}
    </div>
  );
}
