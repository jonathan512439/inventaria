"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Category } from "@/types/database";
import { resizeImage } from "@/lib/image";
import { clearDone, enqueue, queueSummary, removeItem, retryItem, useQueue, type QueueItem } from "@/lib/queue";
import { categoryPath } from "@/lib/categories";
import { productTitle } from "@/lib/fields";
import CategorySelect from "@/components/CategorySelect";
import { useToast } from "@/components/ui/Toast";
import { IconAlert, IconCamera, IconCheck, IconImages, IconRefresh, IconSparkles, IconX, Spinner } from "@/components/ui/Icons";

export default function CapturePage() {
  const supabase = createClient();
  const toast = useToast();
  const queue = useQueue();
  const summary = queueSummary(queue.items);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [showCategory, setShowCategory] = useState(false);
  const [preparing, setPreparing] = useState(0);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.from("categories").select("*").then(({ data }) => setCategories(data ?? []));
  }, [supabase]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>, fromCamera: boolean) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    setPreparing(files.length);
    const blobs: Blob[] = [];
    for (const f of files) {
      try {
        blobs.push(await resizeImage(f));
      } catch {
        toast("error", `No se pudo leer ${f.name}`);
      }
      setPreparing((n) => n - 1);
    }
    if (blobs.length) enqueue(blobs, categoryId);
    // En modo cámara, volvemos a abrirla para encadenar fotos
    if (fromCamera && blobs.length) setTimeout(() => cameraRef.current?.click(), 250);
  }

  const items = useMemo(() => [...queue.items].sort((a, b) => b.createdAt - a.createdAt), [queue.items]);
  const waiting = queue.pausedUntil ? Math.max(0, Math.ceil((queue.pausedUntil - Date.now()) / 1000)) : 0;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header className="animate-in">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Agregar productos</h1>
        <p className="text-sm text-slate-500">Toma varias fotos seguidas. La IA las procesa mientras sigues.</p>
      </header>

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPick(e, true)} />
      <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => onPick(e, false)} />

      {categories.length === 0 && (
        <Link href="/store" className="animate-in flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <IconSparkles size={20} className="shrink-0 text-amber-600" />
          <span className="flex-1">Primero elige <b>qué vendes</b> para que la IA ordene tus fotos en secciones. Toma 30 segundos.</span>
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
          <span className="text-xs font-normal text-slate-500">elige varias</span>
        </button>
      </div>

      {/* Sección: automática por defecto */}
      <div className="animate-in flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-500">Sección:</span>
        {!showCategory ? (
          <button type="button" onClick={() => setShowCategory(true)} className="chip">
            <IconSparkles size={14} className="text-brand-600" />
            {categoryId ? categoryPath(categories, categoryId) : "Automática (la elige la IA)"}
          </button>
        ) : (
          <div className="flex flex-1 items-center gap-2">
            <CategorySelect
              categories={categories}
              value={categoryId}
              onChange={(v) => {
                setCategoryId(v);
                setShowCategory(false);
              }}
              emptyLabel="✨ Automática (la elige la IA)"
              className="input py-2"
            />
            <button className="btn-ghost btn-sm" onClick={() => setShowCategory(false)}>Listo</button>
          </div>
        )}
      </div>

      {/* Estado de la cola */}
      {(summary.total > 0 || preparing > 0) && (
        <div className="animate-in card space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <Stat n={preparing + summary.queued + summary.processing} label="en proceso" tone="text-amber-600" spinning={preparing + summary.processing > 0} />
            <Stat n={summary.done} label="listos" tone="text-emerald-600" />
            {summary.error > 0 && <Stat n={summary.error} label="con error" tone="text-rose-600" />}
            <span className="ml-auto flex gap-2">
              {summary.done > 0 && (
                <Link href="/review" className="btn-success btn-sm">
                  <IconCheck size={14} /> Revisar {summary.done}
                </Link>
              )}
              {summary.done > 0 && (
                <button onClick={clearDone} className="btn-ghost btn-sm">Limpiar</button>
              )}
            </span>
          </div>
          {waiting > 0 && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
              La IA está ocupada, continúa en {waiting}s. Puedes seguir tomando fotos.
            </p>
          )}
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
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
    <div className="group relative aspect-square overflow-hidden rounded-2xl bg-slate-100 ring-1 ring-slate-900/5">
      <img src={item.previewUrl} alt="" className={`h-full w-full object-cover transition ${item.status === "processing" ? "opacity-60" : ""}`} />
      {item.status === "processing" && (
        <div className="absolute inset-0 grid place-items-center text-white">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-600/90 shadow">
            <Spinner size={18} />
          </span>
        </div>
      )}
      {item.status === "queued" && (
        <span className="absolute left-1.5 top-1.5 rounded-full bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white">en cola</span>
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
