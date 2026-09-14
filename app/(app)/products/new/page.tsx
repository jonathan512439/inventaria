"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Category, FieldTemplate, ProductData } from "@/types/database";
import { applyDefaults, coerceValue, fieldLabel, getEffectiveFields } from "@/lib/fields";
import { resizeImage } from "@/lib/image";
import CategoryPicker from "@/components/CategoryPicker";
import FieldInput from "@/components/FieldInput";
import { useToast } from "@/components/ui/Toast";
import { IconArrowLeft, IconCamera, IconCheck, IconImages, IconSparkles, IconX, Spinner } from "@/components/ui/Icons";

/**
 * Alta manual de producto (sin IA): categoría, foto opcional y datos.
 * Útil para productos sin foto, artículos conocidos o correcciones rápidas.
 */
export default function NewProductPage() {
  const supabase = createClient();
  const toast = useToast();
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [templates, setTemplates] = useState<FieldTemplate[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [data, setData] = useState<ProductData>({});
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const [c, t] = await Promise.all([supabase.from("categories").select("*"), supabase.from("field_templates").select("*").order("sort_order")]);
      setCategories(c.data ?? []);
      setTemplates(t.data ?? []);
      setLoading(false);
    })();
  }, [supabase]);

  const fields = useMemo(() => getEffectiveFields(templates, categories, categoryId), [templates, categories, categoryId]);
  const nameField = fields.find((f) => /^(nombre|name|producto|titulo)$/i.test(f.name)) ?? null;
  const keyFields = fields.filter((f) => f.field_type === "number" && /^(precio|price|stock|cantidad|existencias)$/i.test(f.name));
  const otherFields = fields.filter((f) => f !== nameField && !keyFields.includes(f));

  // Valores por defecto al elegir categoría (solo rellena lo vacío)
  useEffect(() => {
    if (!categoryId) return;
    setData((d) => applyDefaults(fields, { ...d }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  useEffect(() => {
    if (!photo) return setPreview(null);
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      setPhoto(await resizeImage(f));
    } catch {
      toast("error", "No se pudo leer la foto");
    }
  }

  const setValue = (f: FieldTemplate, v: string) => setData((d) => ({ ...d, [f.name]: v }));
  const title = nameField ? String(data[nameField.name] ?? "") : "";
  const canSave = !!categoryId && (!nameField || title.trim().length > 0);

  async function save(status: "confirmed" | "draft") {
    if (!canSave) return toast("error", nameField ? "Escribe el nombre y elige la categoría" : "Elige la categoría");
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const id = crypto.randomUUID();
    let image_url: string | null = null;
    if (photo && user) {
      const path = `${user.id}/${id}.jpg`;
      const { error } = await supabase.storage.from("product-images").upload(path, photo, { contentType: "image/jpeg", upsert: true });
      if (error) {
        setSaving(false);
        return toast("error", `No se pudo subir la foto: ${error.message}`);
      }
      image_url = supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl;
    }
    const clean: ProductData = {};
    fields.forEach((f) => (clean[f.name] = coerceValue(f, data[f.name])));
    const { error } = await supabase.from("products").insert({ id, user_id: user!.id, category_id: categoryId, status, data: clean, image_url, ai_meta: { modelo: null } });
    setSaving(false);
    if (error) return toast("error", error.message);
    navigator.vibrate?.(15);
    toast("success", status === "confirmed" ? "Producto guardado en el inventario" : "Producto guardado como pendiente");
    router.replace(status === "confirmed" ? `/products/${id}` : "/review");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header className="animate-in">
        <Link href="/products" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"><IconArrowLeft size={16} /> Inventario</Link>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Nuevo producto</h1>
        <p className="text-sm text-slate-500">
          Lo escribes tú. Si prefieres que la IA lo reconozca, usa <Link href="/capture" className="font-semibold text-brand-700 underline">Agregar con foto</Link>.
        </p>
      </header>

      {loading ? (
        <div className="flex justify-center py-10"><Spinner size={28} className="text-brand-500" /></div>
      ) : (
        <div className="animate-in card space-y-5">
          {/* Foto opcional */}
          <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPick} />
          <input ref={galRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
          <div>
            <label className="label">Foto (opcional)</label>
            {preview ? (
              <div className="relative overflow-hidden rounded-2xl bg-slate-100">
                <img src={preview} alt="" className="mx-auto max-h-56 object-contain" />
                <button type="button" onClick={() => setPhoto(null)} className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white"><IconX size={16} /></button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => camRef.current?.click()} className="btn-secondary py-4"><IconCamera size={20} className="text-brand-600" /> Cámara</button>
                <button type="button" onClick={() => galRef.current?.click()} className="btn-secondary py-4"><IconImages size={20} className="text-brand-600" /> Galería</button>
              </div>
            )}
          </div>

          {/* Categoría */}
          <div>
            <label className="label">Categoría</label>
            <CategoryPicker categories={categories} value={categoryId} onChange={setCategoryId} onCategoriesChange={setCategories} emptyLabel="Elegir categoría" />
            {!categoryId && <p className="hint mt-1">Elige la categoría para ver los datos a completar (nombre, precio, stock…).</p>}
          </div>

          {categoryId && (
            <>
              {nameField && (
                <div>
                  <label className="label">{fieldLabel(nameField.name)} *</label>
                  <FieldInput field={nameField} value={data[nameField.name]} onChange={(v) => setValue(nameField, v)} className="input font-semibold" />
                </div>
              )}
              {keyFields.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  {keyFields.map((f) => (
                    <div key={f.id} className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
                      <label className="label mb-1">{fieldLabel(f.name)}</label>
                      <FieldInput field={f} value={data[f.name]} onChange={(v) => setValue(f, v)} className="input-lg text-2xl tabular-nums" />
                    </div>
                  ))}
                </div>
              )}
              {otherFields.length > 0 && (
                <div className="space-y-3">
                  {otherFields.map((f) => (
                    <div key={f.id}>
                      <label className="label flex items-center gap-1">{fieldLabel(f.name)} {f.is_ai_fillable && <IconSparkles size={12} className="text-slate-400" />}</label>
                      <FieldInput field={f} value={data[f.name]} onChange={(v) => setValue(f, v)} />
                    </div>
                  ))}
                </div>
              )}
              {fields.length === 0 && (
                <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">
                  Esta categoría no tiene datos definidos. <Link href={`/templates?scope=${categoryId}`} className="font-semibold underline">Definir datos</Link>
                </p>
              )}
            </>
          )}

          <div className="grid gap-2 pt-1">
            <button onClick={() => save("confirmed")} className="btn-success btn-lg" disabled={saving || !canSave}>
              {saving ? <Spinner /> : <IconCheck size={20} />} Guardar en inventario
            </button>
            <button onClick={() => save("draft")} className="btn-ghost text-slate-500" disabled={saving || !canSave}>
              Guardar como pendiente
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
