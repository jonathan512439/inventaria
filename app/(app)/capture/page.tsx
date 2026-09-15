"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import CoachTip from "@/components/CoachTip";
import ShelfDetect from "@/components/ShelfDetect";
import { createClient } from "@/lib/supabase/client";
import type { Category } from "@/types/database";
import { resizeImage } from "@/lib/image";
import { cancelAll, cancelItem, clearDone, enqueue, queueSummary, removeItem, resumeNow, retryItem, useQueue, type QueueItem } from "@/lib/queue";
import { categoryPath } from "@/lib/categories";
import { productTitle } from "@/lib/fields";
import CategoryPicker from "@/components/CategoryPicker";
import { useToast } from "@/components/ui/Toast";
import { IconAlert, IconCamera, IconCheck, IconImages, IconRefresh, IconSparkles, IconTag, IconX, Spinner } from "@/components/ui/Icons";

export default function CapturePage() {
  const supabase = createClient();
  const toast = useToast();
  const queue = useQueue();
  const summary = queueSummary(queue.items);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [showCategory, setShowCategory] = useState(false);
  const [preparing, setPreparing] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [batch, setBatch] = useState<{ total: number; startedAt: number } | null>(null); // lote de esta sesión
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.from("categories").select("*").then(({ data }) => setCategories(data ?? []));
  }, [supabase]);

  const MAX_BATCH = 300;

  /** Prepara (redimensiona) y encola una lista de archivos; ignora los que no son imagen. */
  async function addFiles(all: File[], fromCamera = false) {
    const files = all.filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name)).slice(0, MAX_BATCH);
    if (!files.length) return toast("error", "No hay imágenes en la selección");
    if (all.length > MAX_BATCH) toast("info", `Se tomaron las primeras ${MAX_BATCH} fotos`);
    navigator.vibrate?.(12);
    setBatch((b) => ({ total: (b?.total ?? 0) + files.length, startedAt: b?.startedAt ?? Date.now() }));
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
      if (blobs.length >= 8 || i + 4 >= files.length) {
        enqueue(blobs.splice(0, blobs.length), categoryId); // encola en cuanto hay listas: la IA empieza sin esperar al lote entero
      }
    }
    if (fromCamera) setTimeout(() => cameraRef.current?.click(), 250);
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>, fromCamera: boolean) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length) addFiles(files, fromCamera);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) addFiles(files);
  }

  const items = useMemo(() => [...queue.items].sort((a, b) => b.createdAt - a.createdAt), [queue.items]);
  // Reloj para refrescar la cuenta regresiva de la pausa
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!queue.pausedUntil) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [queue.pausedUntil]);
  const waiting = queue.pausedUntil ? Math.max(0, Math.ceil((queue.pausedUntil - Date.now()) / 1000)) : 0;
  const resumeAt = queue.pausedUntil ? new Date(queue.pausedUntil).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }) : "";

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header className="animate-in">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Agregar productos</h1>
        <p className="text-sm text-slate-500">Paso ① · Toma varias fotos seguidas. La IA las procesa mientras sigues.</p>
      </header>
      <CoachTip screen="capture" title="¿Cómo entran los productos?">
        Toca <b>Cámara</b> y fotografía la etiqueta o el empaque; la cámara se vuelve a abrir sola para el siguiente. Cuando termines, sigue al paso <b>② Revisar</b> en la barra de arriba.
      </CoachTip>

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPick(e, true)} />
      <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => onPick(e, false)} />
      {/* Carpeta completa (escritorio) */}
      <input ref={folderRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => onPick(e, false)} {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} />

      {categories.length === 0 && (
        <Link href="/store" className="animate-in flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <IconSparkles size={20} className="shrink-0 text-amber-600" />
          <span className="flex-1">Primero elige <b>qué vendes</b> para que la IA ordene tus fotos en subcategorías. Toma 30 segundos.</span>
          <span className="font-semibold">Elegir →</span>
        </Link>
      )}

      {/* Botones de captura */}
      <div className="animate-in grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => cameraRef.current?.click()}
          className="btn-primary btn-lg flex-col gap-1 py-6"
        >
          <IconCamera size={32} />
          <span>Cámara</span>
          <span className="text-xs font-normal text-white/80">foto tras foto</span>
        </button>
        <button type="button" onClick={() => galleryRef.current?.click()} className="btn-secondary btn-lg flex-col gap-1 py-6">
          <IconImages size={32} className="text-brand-600" />
          <span>Galería</span>
          <span className="text-xs font-normal text-slate-500">elige varias a la vez</span>
        </button>
      </div>

      {/* Foto de estante: varios productos de una vez */}
      <div className="animate-in"><ShelfDetect categoryId={categoryId} /></div>

      {/* Código de barras: alta sin gastar IA */}
      <Link href="/scan" className="animate-in press flex items-center gap-3 rounded-3xl border-2 border-emerald-300 bg-white p-4 shadow-card transition hover:border-emerald-500 hover:bg-emerald-50">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-100 text-emerald-700">
          <IconTag size={24} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold text-ink">Escanear código de barras</span>
          <span className="block text-xs text-slate-500">Detecta repetidos y da de alta productos conocidos · <b className="text-emerald-700">sin gastar IA</b></span>
        </span>
        <span className="btn-secondary btn-sm shrink-0">Abrir</span>
      </Link>

      {/* Escritorio: zona de arrastre + carpeta completa */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`animate-in hidden items-center gap-4 rounded-3xl border-2 border-dashed p-5 transition md:flex ${
          dragging ? "border-brand-500 bg-brand-50" : "border-slate-300 bg-white/60"
        }`}
      >
        <IconImages size={36} className="shrink-0 text-brand-500" />
        <div className="flex-1 text-sm">
          <p className="font-semibold text-ink">Subir un lote desde la computadora</p>
          <p className="text-slate-500">Arrastra aquí muchas fotos (o una carpeta entera). Hasta {MAX_BATCH} por lote; se van analizando solas.</p>
        </div>
        <button type="button" onClick={() => folderRef.current?.click()} className="btn-secondary">Elegir carpeta</button>
        <button type="button" onClick={() => galleryRef.current?.click()} className="btn-primary">Elegir fotos</button>
      </div>

      {/* Categoría: automática por defecto */}
      <div className="animate-in flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-600">Categoría de las fotos:</span>
        {!showCategory ? (
          <button type="button" onClick={() => setShowCategory(true)} className="chip">
            <IconSparkles size={14} className="text-brand-600" />
            {categoryId ? categoryPath(categories, categoryId) : "Automática (la elige la IA)"}
            <span className="text-xs text-slate-500">· cambiar</span>
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
              emptyLabel="✨ Automática (la elige la IA)"
              className="py-2"
            />
            <button className="btn-ghost btn-sm" onClick={() => setShowCategory(false)}>Listo</button>
          </div>
        )}
      </div>

      {/* Progreso del lote */}
      {batch && batch.total > 1 && (() => {
        const pending = preparing + summary.queued + summary.processing;
        const done = Math.max(0, batch.total - pending);
        const pct = Math.round((done / batch.total) * 100);
        const etaSec = Math.ceil((pending * 5) / 2); // ~5 s por foto, 2 en paralelo
        const eta = etaSec >= 60 ? `${Math.ceil(etaSec / 60)} min` : `${etaSec} s`;
        return (
          <div className="animate-in rounded-3xl bg-ink p-4 text-white shadow-float">
            <div className="flex items-end justify-between text-sm">
              <span className="font-semibold">Lote: {done} de {batch.total} listas</span>
              <span className="text-white/70">{pending > 0 ? `≈ ${eta} restantes` : "completado ✓"}</span>
            </div>
            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/15">
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundImage: "linear-gradient(90deg,#6366f1,#a78bfa)" }} />
            </div>
            {pending === 0 && (
              <button onClick={() => setBatch(null)} className="mt-2 text-xs text-white/60 hover:text-white">Ocultar</button>
            )}
          </div>
        );
      })()}

      {/* Estado de la cola */}
      {(summary.total > 0 || preparing > 0) && (
        <div className="animate-in card space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <Stat n={preparing + summary.queued + summary.processing} label="en proceso" tone="text-amber-600" spinning={preparing + summary.processing > 0} />
            <Stat n={summary.done} label="listos" tone="text-emerald-600" />
            {summary.error > 0 && <Stat n={summary.error} label="con error" tone="text-rose-600" />}
            <span className="ml-auto flex gap-2">
              {summary.queued + summary.processing > 0 && (
                <button onClick={() => confirm("¿Cancelar las fotos que faltan por analizar?") && cancelAll()} className="btn-destructive btn-sm">
                  <IconX size={14} /> Cancelar pendientes
                </button>
              )}
              {summary.done > 0 && (
                <Link href="/review" className="btn-success btn-sm">
                  <IconCheck size={16} /> Revisar {summary.done} listas
                </Link>
              )}
            </span>
          </div>
          {waiting > 0 && queue.pausedReason === "daily" && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
              <p className="font-semibold">Se agotó el cupo gratuito de la IA por hoy.</p>
              <p className="mt-0.5">
                Tus fotos quedan guardadas en el teléfono y se analizarán solas a partir de las <b>{resumeAt}</b>
                {waiting > 3600 ? ` (en ${Math.ceil(waiting / 3600)} h)` : ""}. Puedes seguir tomando fotos.
              </p>
              <button onClick={resumeNow} className="btn-secondary btn-sm mt-2">Reintentar ahora</button>
            </div>
          )}
          {waiting > 0 && queue.pausedReason !== "daily" && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {queue.pausedReason === "offline" ? "Sin conexión." : "La IA está saturada,"} reintentamos en {waiting}s. Puedes seguir tomando fotos.
            </p>
          )}
          {summary.done > 0 && (
            <button onClick={clearDone} className="text-xs font-semibold text-slate-500 underline hover:text-ink">
              Quitar de esta lista las {summary.done} ya analizadas (seguirán en Revisar)
            </button>
          )}
          <div className="stagger grid grid-cols-4 gap-2 sm:grid-cols-6">
            {Array.from({ length: preparing }).map((_, i) => (
              <div key={`p${i}`} className="shimmer aspect-square rounded-2xl" />
            ))}
            {items.map((it) => (
              <Thumb key={it.id} item={it} />
            ))}
          </div>
        </div>
      )}

      {summary.total === 0 && preparing === 0 && (
        <div className="animate-in rounded-3xl border-2 border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
          <IconSparkles size={28} className="mx-auto mb-2 text-brand-400" />
          Consejo: enfoca la etiqueta o el empaque. La IA lee marca, modelo y código.
        </div>
      )}
    </div>
  );
}

function Stat({ n, label, tone, spinning }: { n: number; label: string; tone: string; spinning?: boolean }) {
  if (n === 0) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 font-semibold ${tone}`}>
      {spinning && <Spinner size={14} />}
      {n} <span className="font-normal text-slate-500">{label}</span>
    </span>
  );
}

function Thumb({ item }: { item: QueueItem }) {
  const title = item.product ? productTitle(item.product.data) : "";
  return (
    <div className={`group relative aspect-square overflow-hidden rounded-2xl bg-slate-100 ring-1 ring-slate-900/5 ${item.status === "processing" ? "scanning" : ""}`}>
      <img src={item.previewUrl} alt="" className={`h-full w-full object-cover transition ${item.status === "processing" ? "opacity-80" : ""}`} />
      {item.status === "processing" && (
        <span className="absolute inset-x-0 bottom-0 bg-brand-600/85 py-0.5 text-center text-[10px] font-semibold text-white">✨ Analizando…</span>
      )}
      {item.status === "queued" && (
        <span className="absolute left-1.5 top-1.5 rounded-full bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white">en cola</span>
      )}
      {(item.status === "queued" || item.status === "processing") && (
        <button
          type="button"
          onClick={() => cancelItem(item.id)}
          className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white shadow hover:bg-rose-600"
          title="Cancelar"
          aria-label="Cancelar análisis"
        >
          <IconX size={14} />
        </button>
      )}
      {item.status === "done" && (
        <>
          <span className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-emerald-500 text-white shadow">
            <IconCheck size={14} />
          </span>
          {item.product && (
            <Link
              href={`/review?id=${item.product.id}`}
              className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-4 text-[10px] font-medium text-white"
            >
              {title || "Sin nombre"}
            </Link>
          )}
        </>
      )}
      {item.status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-rose-600/80 p-1 text-center text-white">
          <IconAlert size={18} />
          <span className="line-clamp-2 text-[10px] leading-tight">{item.error}</span>
          <span className="flex gap-1">
            <button onClick={() => retryItem(item.id)} className="rounded-full bg-white/25 p-1 hover:bg-white/40" title="Reintentar">
              <IconRefresh size={14} />
            </button>
            <button onClick={() => removeItem(item.id)} className="rounded-full bg-white/25 p-1 hover:bg-white/40" title="Quitar">
              <IconX size={14} />
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
