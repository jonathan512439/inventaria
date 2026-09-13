"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Category, FieldTemplate, Product } from "@/types/database";
import { getEffectiveFields } from "@/lib/fields";
import { resizeImage } from "@/lib/image";
import CategorySelect from "@/components/CategorySelect";

type Status = "idle" | "resizing" | "uploading" | "done" | "error";

interface Result {
  product: Product;
  ai_fields: string[];
  warning: string | null;
}

export default function CapturePage() {
  const supabase = createClient();
  const [categories, setCategories] = useState<Category[]>([]);
  const [templates, setTemplates] = useState<FieldTemplate[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const [c, t] = await Promise.all([
        supabase.from("categories").select("*"),
        supabase.from("field_templates").select("*").order("sort_order"),
      ]);
      setCategories(c.data ?? []);
      setTemplates(t.data ?? []);
      // Recuerda la última categoría usada
      const last = localStorage.getItem("inventaria:lastCategory");
      if (last && c.data?.some((x) => x.id === last)) setCategoryId(last);
      else if (c.data?.length === 1) setCategoryId(c.data[0].id);
    })();
  }, [supabase]);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const effective = getEffectiveFields(templates, categories, categoryId);
  const aiFields = effective.filter((f) => f.is_ai_fillable);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setError(null);
      setStatus("idle");
    }
    e.target.value = ""; // permite volver a elegir el mismo archivo
  }

  async function analyze() {
    if (!file || !categoryId) return;
    setError(null);
    try {
      setStatus("resizing");
      const resized = await resizeImage(file);
      setStatus("uploading");
      const form = new FormData();
      form.append("image", resized);
      form.append("category_id", categoryId);
      const res = await fetch("/api/analyze", { method: "POST", body: form });
      const json = (await res.json()) as Result & { error?: string };
      if (!res.ok) throw new Error(json.error || `Error ${res.status}`);
      localStorage.setItem("inventaria:lastCategory", categoryId);
      setResults((prev) => [json, ...prev]);
      setFile(null);
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
      setStatus("error");
    }
  }

  const busy = status === "resizing" || status === "uploading";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Capturar producto</h1>
        <p className="text-sm text-slate-500">Toma una foto y la IA rellenará los campos que pueda inferir.</p>
      </div>

      {categories.length === 0 ? (
        <div className="card border-amber-200 bg-amber-50 text-sm text-amber-800">
          Primero <Link href="/categories" className="underline">crea una categoría</Link>.
        </div>
      ) : (
        <>
          <div className="card space-y-2">
            <label className="label" htmlFor="cat">Categoría del producto</label>
            <CategorySelect id="cat" categories={categories} value={categoryId} onChange={setCategoryId} allowEmpty emptyLabel="— Elige una categoría —" />
            {categoryId && (
              <p className="text-xs text-slate-500">
                {aiFields.length > 0 ? (
                  <>La IA intentará llenar: <span className="font-medium">{aiFields.map((f) => f.name).join(", ")}</span></>
                ) : (
                  <>
                    Esta categoría no tiene campos marcados para IA.{" "}
                    <Link href="/templates" className="underline">Configurar campos</Link>
                  </>
                )}
              </p>
            )}
          </div>

          {/* Inputs ocultos: cámara y galería */}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPick} />
          <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={onPick} />

          <div className="grid grid-cols-2 gap-3">
            <button type="button" className="btn-primary py-4 text-base" onClick={() => cameraRef.current?.click()} disabled={busy}>
              📷 Cámara
            </button>
            <button type="button" className="btn-secondary py-4 text-base" onClick={() => galleryRef.current?.click()} disabled={busy}>
              🖼 Galería
            </button>
          </div>

          {preview && (
            <div className="card space-y-3">
              <img src={preview} alt="Vista previa" className="mx-auto max-h-80 rounded-lg object-contain" />
              <div className="flex gap-2">
                <button className="btn-primary flex-1" onClick={analyze} disabled={busy || !categoryId}>
                  {status === "resizing" ? "Optimizando foto..." : status === "uploading" ? "Analizando con IA..." : "✨ Analizar y crear borrador"}
                </button>
                <button className="btn-secondary" onClick={() => setFile(null)} disabled={busy}>
                  Quitar
                </button>
              </div>
              {!categoryId && <p className="text-xs text-amber-700">Elige una categoría para continuar.</p>}
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
              {preview && (
                <button className="ml-2 underline" onClick={analyze} disabled={busy}>Reintentar</button>
              )}
            </div>
          )}
        </>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Borradores creados en esta sesión ({results.length})</h2>
            <Link href="/drafts" className="text-sm font-medium text-brand-600 hover:underline">Ir a borradores →</Link>
          </div>
          {results.map((r) => (
            <div key={r.product.id} className="card flex gap-3">
              {r.product.image_url && (
                <img src={r.product.image_url} alt="" className="h-20 w-20 flex-shrink-0 rounded-lg object-cover" />
              )}
              <div className="min-w-0 flex-1 text-sm">
                {r.warning && <p className="mb-1 text-xs text-amber-700">⚠ {r.warning}</p>}
                {Object.entries(r.product.data)
                  .filter(([k]) => r.ai_fields.includes(k))
                  .map(([k, v]) => (
                    <p key={k} className="truncate">
                      <span className="text-slate-500">{k}:</span> {v === null || v === "" ? <em className="text-slate-400">—</em> : String(v)}
                    </p>
                  ))}
                <Link href={`/products/${r.product.id}`} className="mt-1 inline-block text-xs font-medium text-brand-600 hover:underline">
                  Editar
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
