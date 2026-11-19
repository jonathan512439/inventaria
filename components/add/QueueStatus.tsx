"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { cancelAll, cancelItem, clearDone, queueSummary, removeItem, resumeNow, retryItem, useQueue, type QueueItem } from "@/lib/queue";
import { productTitle } from "@/lib/fields";
import { useConfirm } from "@/components/ui/Confirm";
import { IconAlert, IconCheck, IconRefresh, IconX, Spinner } from "@/components/ui/Icons";

/**
 * Cola de fotos en análisis (C7.4): visible en Agregar sea cual sea la manera elegida,
 * con lo listo para revisar, lo que tuvo error y la pausa por cupo o conexión.
 */
export default function QueueStatus({ preparing = 0 }: { preparing?: number }) {
  const ask = useConfirm();
  const queue = useQueue();
  const summary = queueSummary(queue.items);
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

  if (summary.total === 0 && preparing === 0) return null;
  const inProcess = preparing + summary.queued + summary.processing;
  return (
    <section className="animate-in card space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {inProcess > 0 && <span className="inline-flex items-center gap-1.5 font-semibold text-warn-700"><Spinner size={14} /> {inProcess} <span className="font-normal text-muted">analizando</span></span>}
        {summary.done > 0 && <span className="font-semibold text-ok-700">{summary.done} <span className="font-normal text-muted">listas</span></span>}
        {summary.error > 0 && <span className="font-semibold text-danger-700">{summary.error} <span className="font-normal text-muted">con error</span></span>}
        <span className="ml-auto flex flex-wrap gap-2">
          {summary.queued + summary.processing > 0 && (
            <button
              onClick={async () => {
                if (await ask({ title: "¿Cancelar lo que falta?", body: "Las fotos que todavía no se analizaron se descartan. Las que ya se analizaron quedan en Revisar.", confirmLabel: "Sí, cancelar", cancelLabel: "Seguir analizando", tone: "danger" })) cancelAll();
              }}
              className="btn-ghost btn-sm min-h-[44px] text-danger-700"
            >
              <IconX size={14} /> Cancelar
            </button>
          )}
          {summary.done > 0 && (
            <Link href="/add/review" className="btn-success btn-sm min-h-[44px]"><IconCheck size={16} /> Revisar {summary.done}</Link>
          )}
        </span>
      </div>
      {waiting > 0 && queue.pausedReason === "daily" && (
        <div className="rounded-2xl bg-danger-50 p-3 text-sm text-danger-800">
          <p className="font-semibold">Se agotó el cupo gratuito de la IA por hoy.</p>
          <p className="mt-0.5 text-xs">
            Tus fotos quedan guardadas en el teléfono y se analizan solas a partir de las <b>{resumeAt}</b>
            {waiting > 3600 ? ` (en ${Math.ceil(waiting / 3600)} h)` : ""}. Mientras tanto, el código de barras y «A mano» no gastan IA.
          </p>
          <button onClick={resumeNow} className="btn-secondary btn-sm mt-2 min-h-[44px]">Reintentar ahora</button>
        </div>
      )}
      {waiting > 0 && queue.pausedReason !== "daily" && (
        <p className="rounded-xl bg-warn-50 px-3 py-2 text-xs text-warn-800">
          {queue.pausedReason === "offline" ? "Sin conexión." : "La IA está saturada,"} reintentamos en {waiting} s. Puedes seguir tomando fotos.
        </p>
      )}
      <div className="grid max-h-[50vh] grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
        {Array.from({ length: preparing }).map((_, i) => (
          <div key={`p${i}`} className="shimmer aspect-square rounded-2xl" />
        ))}
        {items.map((it) => (
          <Thumb key={it.id} item={it} />
        ))}
      </div>
      {summary.done > 0 && (
        <button onClick={clearDone} className="min-h-[44px] text-xs font-semibold text-muted underline hover:text-ink">
          Quitar de aquí las {summary.done} ya analizadas (siguen en Revisar)
        </button>
      )}
    </section>
  );
}

function Thumb({ item }: { item: QueueItem }) {
  const title = item.product ? productTitle(item.product.data) : "";
  return (
    <div className={`relative aspect-square overflow-hidden rounded-2xl bg-slate-100 ring-1 ring-slate-900/5 ${item.status === "processing" ? "scanning" : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={item.previewUrl} alt="" className={`h-full w-full object-cover ${item.status === "processing" ? "opacity-80" : ""}`} />
      {item.status === "processing" && <span className="absolute inset-x-0 bottom-0 bg-brand-600/85 py-0.5 text-center text-xs font-semibold text-white">Analizando…</span>}
      {item.status === "queued" && <span className="absolute left-1.5 top-1.5 rounded-full bg-black/50 px-1.5 py-0.5 text-xs font-medium text-white">en cola</span>}
      {(item.status === "queued" || item.status === "processing") && (
        <button type="button" onClick={() => cancelItem(item.id)} className="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white shadow hover:bg-danger-600" aria-label="Cancelar análisis">
          <IconX size={14} />
        </button>
      )}
      {item.status === "done" && (
        <>
          <span className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-ok-500 text-white shadow"><IconCheck size={14} /></span>
          {item.product && (
            <Link href={`/add/review?id=${item.product.id}`} className="absolute inset-0 flex items-end bg-gradient-to-t from-black/70 via-transparent to-transparent px-1.5 pb-1 text-xs font-medium text-white">
              <span className="truncate">{title || "Sin nombre"}</span>
            </Link>
          )}
        </>
      )}
      {item.status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-danger-600/85 p-1 text-center text-white">
          <IconAlert size={18} />
          <span className="line-clamp-2 text-xs leading-tight">{item.error}</span>
          <span className="flex gap-1">
            <button onClick={() => retryItem(item.id)} className="grid h-8 w-8 place-items-center rounded-full bg-white/25 hover:bg-white/40" aria-label="Reintentar"><IconRefresh size={14} /></button>
            <button onClick={() => removeItem(item.id)} className="grid h-8 w-8 place-items-center rounded-full bg-white/25 hover:bg-white/40" aria-label="Quitar"><IconX size={14} /></button>
          </span>
        </div>
      )}
    </div>
  );
}
