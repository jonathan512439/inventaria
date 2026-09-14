"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Category, FieldTemplate, Product, ProductData } from "@/types/database";
import { categoryPath } from "@/lib/categories";
import { canonicalizeData, coerceValue, fieldLabel, getEffectiveFields, productTitle } from "@/lib/fields";
import CategoryPicker from "@/components/CategoryPicker";
import FieldInput from "@/components/FieldInput";
import { IconArrowLeft, IconSparkles, IconTag } from "@/components/ui/Icons";

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
    setCategories(c.data ?? []);
    setTemplates(t.data ?? []);
    if (!p.data) setNotFound(true);
    else {
      setProduct(p.data);
      setData(canonicalizeData(p.data.data, getEffectiveFields(t.data ?? [], c.data ?? [], p.data.category_id)));
      setCategoryId(p.data.category_id);
    }
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
    else if (status === "draft") router.push("/review");
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
    router.push(product.status === "draft" ? "/review" : "/products");
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
    <div className="mx-auto w-full max-w-4xl space-y-5 overflow-x-hidden">
      <div className="animate-in flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <Link href={isDraft ? "/review" : "/products"} className="mb-1 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700">
            <IconArrowLeft size={16} /> {isDraft ? "Pendientes" : "Inventario"}
          </Link>
          <h1 className="break-words text-2xl font-bold tracking-tight text-ink">{productTitle(data) || "Producto"}</h1>
          <p className="text-xs text-slate-500">
            {categoryPath(categories, product.category_id)} · {new Date(product.created_at).toLocaleDateString("es")}
          </p>
        </div>
        <span className={`badge ${isDraft ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
          {isDraft ? "Pendiente" : "En inventario"}
        </span>
      </div>

      <div className="mx-auto grid w-full max-w-xl gap-5 md:max-w-none md:grid-cols-[340px_1fr]">
        <div className="animate-in space-y-3">
          <div className="card overflow-hidden p-0">
            {product.image_url ? (
              <img src={product.image_url} alt="" className="w-full object-contain" />
            ) : (
              <div className="flex h-48 items-center justify-center text-sm text-slate-400">Sin foto</div>
            )}
          </div>
          {product.ai_meta?.etiqueta && (
            <div className="flex gap-2 rounded-2xl bg-slate-50 p-3 text-xs text-slate-600">
              <IconTag size={16} className="mt-0.5 shrink-0 text-slate-400" />
              <p><span className="font-semibold text-slate-700">En la etiqueta se lee:</span> {product.ai_meta.etiqueta}</p>
            </div>
          )}
        </div>

        <div className="animate-in card min-w-0 space-y-4">
          <div>
            <label className="label">Categoría</label>
            <CategoryPicker categories={categories} value={categoryId} onChange={setCategoryId} onCategoriesChange={setCategories} emptyLabel="Sin categoría" />
          </div>

          {fields.map((f) => (
            <div key={f.id}>
              <label className="label flex items-center gap-1">
                {fieldLabel(f.name)} {f.is_ai_fillable && <IconSparkles size={12} className="text-brand-500" />}
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

          {/* Acciones: apiladas y centradas en móvil, en fila en escritorio */}
          <div className="grid w-full gap-2 pt-2 sm:grid-cols-[1fr_auto_auto]">
            {isDraft ? (
              <button className="btn-success btn-lg w-full" onClick={() => save("confirmed")} disabled={saving}>✓ Guardar en inventario</button>
            ) : (
              <button className="btn-primary btn-lg w-full" onClick={() => save()} disabled={saving}>Guardar cambios</button>
            )}
            {isDraft ? (
              <button className="btn-secondary w-full" onClick={() => save()} disabled={saving}>Guardar sin confirmar</button>
            ) : (
              <button className="btn-secondary w-full" onClick={() => save("draft")} disabled={saving}>↩ Pasar a pendientes</button>
            )}
            <button className="btn-danger w-full" onClick={remove} disabled={saving}>Eliminar</button>
          </div>
        </div>
      </div>
    </div>
  );
}
