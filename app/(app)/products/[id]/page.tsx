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
import { IconArrowLeft, IconCheck, IconEdit, IconRefresh, IconSparkles, IconTag, IconTrash, Spinner } from "@/components/ui/Icons";
import { useToast } from "@/components/ui/Toast";

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
  const [moreActions, setMoreActions] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const toast = useToast();

  /** Vuelve a analizar la foto con la IA (1 petición). Conserva precio, stock y datos manuales. */
  async function reanalyze(keepCategory: boolean) {
    if (!product) return;
    const msg = keepCategory
      ? "La IA volverá a leer la foto y actualizará nombre, marca, descripción… (se conservan precio, stock y la categoría actual)."
      : "La IA volverá a leer la foto, actualizará los datos y podrá cambiar la categoría y subcategoría. Se conservan precio y stock.";
    if (!confirm(`${msg}\n\nConsume 1 análisis de tu cupo diario. ¿Continuar?`)) return;
    setReanalyzing(true);
    const res = await fetch("/api/reanalyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_id: product.id, keep_category: keepCategory }),
    });
    const json = (await res.json().catch(() => ({}))) as { product?: Product; changed?: string[]; error?: string };
    setReanalyzing(false);
    if (!res.ok) return toast("error", json.error || "No se pudo volver a analizar");
    await load();
    const n = json.changed?.length ?? 0;
    toast("success", n ? `Actualizado: ${json.changed!.map(fieldLabel).join(", ")}` : "La IA no encontró nada nuevo que cambiar");
  }

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
    toast("success", "Cambios guardados");
    // Tras editar, se vuelve a la lista de donde vino el producto
    if (status === "draft") router.push("/review");
    else router.push("/products");
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
          {/* Volver a analizar con IA */}
          <div className="rounded-2xl border-2 border-brand-200 bg-brand-50/60 p-3">
            <p className="flex items-center gap-1.5 text-xs font-bold text-brand-900">
              <IconSparkles size={14} className="text-brand-600" /> ¿La IA se equivocó?
            </p>
            <p className="mt-0.5 text-xs text-slate-600">Vuelve a leer la foto y corrige los datos. Precio y stock no se tocan.</p>
            <div className="mt-2 grid gap-2">
              <button onClick={() => reanalyze(false)} disabled={reanalyzing || !product.image_url} className="btn-primary btn-sm w-full justify-start">
                {reanalyzing ? <Spinner size={14} /> : <IconRefresh size={16} />} Volver a analizar con IA
                <span className="ml-auto text-[11px] font-normal opacity-80">puede recolocarlo</span>
              </button>
              <button onClick={() => reanalyze(true)} disabled={reanalyzing || !product.image_url} className="btn-secondary btn-sm w-full justify-start">
                <IconRefresh size={16} className="text-brand-600" /> Solo actualizar los datos
                <span className="ml-auto text-[11px] font-normal text-slate-500">mantiene la categoría</span>
              </button>
            </div>
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

          {/* Acciones: una principal clara + el resto en "Más opciones" */}
          <div className="grid w-full gap-2 pt-2">
            {isDraft ? (
              <button className="btn-success btn-lg w-full" onClick={() => save("confirmed")} disabled={saving}>
                {saving ? <Spinner /> : <IconCheck size={20} />} Guardar en el inventario
              </button>
            ) : (
              <button className="btn-primary btn-lg w-full" onClick={() => save()} disabled={saving}>
                {saving ? <Spinner /> : <IconEdit size={18} />} Guardar cambios
              </button>
            )}

            <button type="button" onClick={() => setMoreActions((v) => !v)} className="text-sm font-semibold text-slate-500 underline hover:text-ink">
              {moreActions ? "Ocultar más opciones" : "Más opciones"}
            </button>

            {moreActions && (
              <div className="animate-in grid gap-2 rounded-2xl border-2 border-slate-200 p-3">
                {isDraft ? (
                  <button className="btn-secondary w-full justify-start" onClick={() => save()} disabled={saving}>
                    <IconEdit size={16} /> Guardar sin pasarlo al inventario
                    <span className="ml-auto text-xs font-normal text-slate-500">sigue en pendientes</span>
                  </button>
                ) : (
                  <button className="btn-secondary w-full justify-start" onClick={() => save("draft")} disabled={saving}>
                    <IconEdit size={16} /> Marcar para revisar de nuevo
                    <span className="ml-auto text-xs font-normal text-slate-500">vuelve a pendientes</span>
                  </button>
                )}
                <button className="btn-destructive w-full justify-start" onClick={remove} disabled={saving}>
                  <IconTrash size={16} /> Eliminar este producto
                  <span className="ml-auto text-xs font-normal">y su foto</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
