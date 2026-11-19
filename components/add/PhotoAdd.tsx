"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Category } from "@/types/database";
import { resizeImage } from "@/lib/image";
import { enqueue, queueSummary, useQueue } from "@/lib/queue";
import { categoryPath } from "@/lib/categories";
import CategoryPicker from "@/components/CategoryPicker";
import { useToast } from "@/components/ui/Toast";
import { IconCamera, IconImages, IconSparkles } from "@/components/ui/Icons";
import QueueStatus from "./QueueStatus";

const MAX_BATCH = 300;

/**
 * Agregar › Foto (antes /capture): cámara foto tras foto, galería o (en computadora) un lote o carpeta.
 * Cada foto entra a la cola; la IA llena los datos y el producto queda Pendiente hasta revisarlo.
 */
export default function PhotoAdd() {
  const supabase = createClient();
  const toast = useToast();
  const queue = useQueue();
  const summary = queueSummary(queue.items);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [showCategory, setShowCategory] = useState(false);
  const [preparing, setPreparing] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [batch, setBatch] = useState<{ total: number } | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.from("categories").select("*").then(({ data }) => setCategories(data ?? []));
  }, [supabase]);

  /** Prepara (redimensiona) y encola una lista de archivos; ignora los que no son imagen. */
  async function addFiles(all: File[], fromCamera = false) {
    const files = all.filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name)).slice(0, MAX_BATCH);
    if (!files.length) return toast("error", "No hay imágenes en la selección");
    if (all.length > MAX_BATCH) toast("info", `Se tomaron las primeras ${MAX_BATCH} fotos`);
    navigator.vibrate?.(12);
    setBatch((b) => ({ total: (b?.total ?? 0) + files.length }));
    setPreparing(files.length);
    // Preparación en tandas de 4 para no bloquear la interfaz con lotes grandes
    const blobs: Blob[] = [];
    for (let i = 0; i < files.length; i += 4) {
      const chunk = files.slice(i, i + 4);
      const results = await Promise.allSettled(chunk.map((f) => resizeImage(f)));
      results.forEach((r, j) => {
        if (r.status === "fulfilled") blobs.push(r.value);
        else toast("error", `No se pudo leer ${chunk[j].name}`);
      });
      setPreparing((n) => n - chunk.length);
      // Encola en cuanto hay listas: la IA empieza sin esperar al lote entero
      if (blobs.length >= 8 || i + 4 >= files.length) enqueue(blobs.splice(0, blobs.length), categoryId);
    }
    if (fromCamera) setTimeout(() => cameraRef.current?.click(), 250);
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>, fromCamera: boolean) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length) addFiles(files, fromCamera);
  }

  const pending = preparing + summary.queued + summary.processing;

  return (
    <div className="space-y-4">
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPick(e, true)} />
      <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => onPick(e, false)} />
      <input ref={folderRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => onPick(e, false)} {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} />

      {categories.length === 0 && (
        <Link href="/settings/catalog" className="flex min-h-[56px] items-center gap-3 rounded-2xl bg-warn-50 p-3 text-sm text-warn-900 ring-1 ring-warn-200">
          <IconSparkles size={20} className="shrink-0 text-warn-600" />
          <span className="flex-1">Primero elige <b>qué vendes</b> para que la IA ordene tus fotos en categorías. Toma 30 segundos.</span>
          <span className="font-semibold">Elegir →</span>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={() => cameraRef.current?.click()} className="btn-primary btn-lg flex-col gap-1 py-6">
          <IconCamera size={32} />
          <span>Cámara</span>
          <span className="text-xs font-normal text-white/80">foto tras foto</span>
        </button>
        <button type="button" onClick={() => galleryRef.current?.click()} className="btn-secondary btn-lg flex-col gap-1 py-6">
          <IconImages size={32} className="text-brand-600" />
          <span>Galería</span>
          <span className="text-xs font-normal text-muted">elige varias a la vez</span>
        </button>
      </div>

      {/* Escritorio: zona de arrastre + carpeta completa */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const files = Array.from(e.dataTransfer.files ?? []);
          if (files.length) addFiles(files);
        }}
        className={`hidden items-center gap-4 rounded-3xl border-2 border-dashed p-5 transition md:flex ${dragging ? "border-brand-500 bg-brand-50" : "border-slate-300 bg-white/60"}`}
      >
        <IconImages size={36} className="shrink-0 text-brand-500" />
        <div className="flex-1 text-sm">
          <p className="font-semibold text-ink">Subir un lote desde la computadora</p>
          <p className="text-muted">Arrastra aquí muchas fotos (o una carpeta). Hasta {MAX_BATCH} por lote; se analizan solas.</p>
        </div>
        <button type="button" onClick={() => folderRef.current?.click()} className="btn-secondary">Elegir carpeta</button>
      </div>

      {/* Categoría: automática por defecto */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-600">Categoría de las fotos:</span>
        {!showCategory ? (
          <button type="button" onClick={() => setShowCategory(true)} className="chip min-h-[44px]">
            <IconSparkles size={14} className="text-brand-600" />
            {categoryId ? categoryPath(categories, categoryId) : "La elige la IA"}
            <span className="text-xs text-muted">· cambiar</span>
          </button>
        ) : (
          <div className="flex flex-1 items-center gap-2">
            <CategoryPicker
              categories={categories}
              value={categoryId}
              onChange={(v) => {
                setCategoryId(v);
                setShowCategory(false);
              }}
              onCategoriesChange={setCategories}
              emptyLabel="La elige la IA"
              className="py-2"
            />
            <button className="btn-ghost btn-sm min-h-[44px]" onClick={() => setShowCategory(false)}>Listo</button>
          </div>
        )}
      </div>

      {/* Progreso del lote de esta visita */}
      {batch && batch.total > 1 && (
        <div className="rounded-3xl bg-ink p-4 text-white shadow-float">
          <div className="flex items-end justify-between text-sm">
            <span className="font-semibold">Lote: {Math.max(0, batch.total - pending)} de {batch.total} listas</span>
            <span className="text-white/70">{pending > 0 ? `≈ ${Math.max(1, Math.ceil((pending * 5) / 2 / 60))} min` : "completado ✓"}</span>
          </div>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/15">
            <div className="h-full rounded-full bg-brand-400 transition-all duration-700" style={{ width: `${Math.round((Math.max(0, batch.total - pending) / batch.total) * 100)}%` }} />
          </div>
        </div>
      )}

      <QueueStatus preparing={preparing} />

      {summary.total === 0 && preparing === 0 && (
        <p className="rounded-3xl border-2 border-dashed border-slate-200 p-6 text-center text-sm text-muted">
          Enfoca la etiqueta o el empaque: la IA lee marca, modelo y código. Cada foto usa 1 análisis de tu cupo diario.
        </p>
      )}
    </div>
  );
}
