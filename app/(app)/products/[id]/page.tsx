"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Category, FieldTemplate, Product, ProductData } from "@/types/database";
import { categoryPath } from "@/lib/categories";
import { coerceValue, getEffectiveFields } from "@/lib/fields";
import CategorySelect from "@/components/CategorySelect";
import FieldInput from "@/components/FieldInput";

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();
  const [product, setProduct] = useState<Product | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [templates, setTemplates] = useState<FieldTemplate[]>([]);
  const [data, setData] = useState<ProductData>({});
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    const [p, c, t] = await Promise.all([
      supabase.from("products").select("*").eq("id", id).maybeSingle(),
      supabase.from("categories").select("*"),
      supabase.from("field_templates").select("*").order("sort_order"),
    ]);
    if (!p.data) setNotFound(true);
    else {
      setProduct(p.data);
      setData(p.data.data);
      setCategoryId(p.data.category_id);
    }
    setCategories(c.data ?? []);
    setTemplates(t.data ?? []);
    setLoading(false);
  }, [supabase, id]);

  useEffect(() => {
    load();
  }, [load]);

  const fields = getEffectiveFields(templates, categories, categoryId);
  // Valores guardados que no pertenecen a ningún campo actual (p. ej. campo eliminado)
  const orphanKeys = Object.keys(data).filter((k) => !fields.some((f) => f.name === k));

  async function save(status?: Product["status"]) {
    if (!product) return;
    setSaving(true);
    setError(null);
    const clean: ProductData = { ...data };
    fields.forEach((f) => (clean[f.name] = coerceValue(f, data[f.name])));
    const { error } = await supabase
      .from("products")
      .update({ data: clean, category_id: categoryId, ...(status ? { status } : {}) })
      .eq("id", product.id);
    setSaving(false);
    if (error) return setError(error.message);
    if (status === "confirmed") router.push("/products");
    else if (status === "draft") router.push("/drafts");
    else load();
  }

  async function remove() {
    if (!product || !confirm("¿Eliminar este producto y su foto?")) return;
    if (product.image_url) {
      const idx = product.image_url.indexOf("/product-images/");
      if (idx >= 0) await supabase.storage.from("product-images").remove([product.image_url.slice(idx + "/product-images/".length)]);
    }
    const { error } = await supabase.from("products").delete().eq("id", product.id);
    if (error) return setError(error.message);
    router.push(product.status === "draft" ? "/drafts" : "/products");
  }

  if (loading) return <p className="text-sm text-slate-500">Cargando...</p>;
  if (notFound || !product)
    return (
      <div className="card text-sm">
        Producto no encontrado. <Link href="/products" className="text-brand-600 underline">Volver</Link>
      </div>
    );

  const isDraft = product.status === "draft";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href={isDraft ? "/drafts" : "/products"} className="text-sm text-slate-500 hover:underline">← Volver</Link>
          <h1 className="text-xl font-semibold">{String(data.nombre || data.name || "Producto")}</h1>
          <p className="text-xs text-slate-500">
            {categoryPath(categories, product.category_id)} · {new Date(product.created_at).toLocaleString("es")}
          </p>
        </div>
        <span className={`badge ${isDraft ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800"}`}>
          {isDraft ? "Borrador" : "Confirmado"}
        </span>
      </div>

      <div className="grid gap-5 md:grid-cols-[320px_1fr]">
        <div className="card p-2">
          {product.image_url ? (
            <img src={product.image_url} alt="" className="w-full rounded-lg object-contain" />
          ) : (
            <div className="flex h-48 items-center justify-center text-sm text-slate-400">Sin foto</div>
          )}
        </div>

        <div className="card space-y-4">
          <div>
            <label className="label">Categoría</label>
            <CategorySelect categories={categories} value={categoryId} onChange={setCategoryId} />
          </div>

          {fields.map((f) => (
            <div key={f.id}>
              <label className="label">
                {f.name} {f.is_ai_fillable && <span className="text-xs text-brand-600">✨ IA</span>}
              </label>
              <FieldInput field={f} value={data[f.name]} onChange={(v) => setData({ ...data, [f.name]: v })} />
            </div>
          ))}

          {orphanKeys.length > 0 && (
            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer">Otros datos guardados ({orphanKeys.length})</summary>
              <ul className="mt-1 space-y-1">
                {orphanKeys.map((k) => (
                  <li key={k}><span className="font-medium">{k}:</span> {String(data[k] ?? "")}</li>
                ))}
              </ul>
            </details>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex flex-wrap gap-2 pt-2">
            <button className="btn-secondary" onClick={() => save()} disabled={saving}>Guardar</button>
            {isDraft ? (
              <button className="btn-primary" onClick={() => save("confirmed")} disabled={saving}>✓ Guardar y confirmar</button>
            ) : (
              <button className="btn-ghost" onClick={() => save("draft")} disabled={saving}>↩ Volver a borrador</button>
            )}
            <button className="btn-ghost text-red-600" onClick={remove} disabled={saving}>Eliminar</button>
          </div>
        </div>
      </div>
    </div>
  );
}
