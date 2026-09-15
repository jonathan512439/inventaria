"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { resizeImage } from "@/lib/image";
import { enqueue } from "@/lib/queue";
import { useToast } from "./ui/Toast";
import { IconCheck, IconGrid, IconX, Spinner } from "./ui/Icons";

interface Detected {
  nombre_visible: string;
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax] 0–1000
}

interface Props {
  categoryId: string | null;
}

/**
 * Foto de estante → varios productos: una petición de IA detecta los productos; el usuario marca cuáles
 * y cada uno se recorta y se encola como foto individual (se analiza como siempre).
 */
export default function ShelfDetect({ categoryId }: Props) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [items, setItems] = useState<Detected[] | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<"detect" | "crop" | null>(null);

  useEffect(() => {
    if (!file) return setUrl(null);
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setBusy("detect");
    setItems(null);
    try {
      // Para detectar se envía una versión más grande (1600 px) que para analizar (800 px)
      const big = await resizeImage(f, 1600);
      setFile(big);
      const form = new FormData();
      form.append("image", big, "estante.jpg");
      const res = await fetch("/api/detect", { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as { items?: Detected[]; error?: string; daily?: boolean };
      if (!res.ok) {
        setFile(null);
        return toast("error", json.daily ? "Se agotó el cupo de IA de hoy. Intenta mañana o usa tu propia clave (Ajustes)." : json.error || "No se pudo analizar la foto");
      }
      const list = json.items ?? [];
      if (!list.length) {
        setFile(null);
        return toast("info", "No se reconocieron productos en esa foto. Prueba más cerca y con buena luz.");
      }
      setItems(list);
      setChecked(new Set(list.map((_, i) => i)));
    } catch (err) {
      setFile(null);
      toast("error", err instanceof Error ? err.message : "No se pudo leer la foto");
    } finally {
      setBusy(null);
    }
  }

  /** Recorta cada producto marcado (con un margen del 6 %) y lo encola como foto individual. */
  async function enqueueChecked() {
    if (!file || !items) return;
    setBusy("crop");
    try {
      const bitmap = await createImageBitmap(file);
      const blobs: Blob[] = [];
      for (const i of Array.from(checked)) {
        const [y0, x0, y1, x1] = items[i].box_2d;
        const pad = 0.06;
        const left = Math.max(0, (x0 / 1000 - pad) * bitmap.width);
        const top = Math.max(0, (y0 / 1000 - pad) * bitmap.height);
        const right = Math.min(bitmap.width, (x1 / 1000 + pad) * bitmap.width);
        const bottom = Math.min(bitmap.height, (y1 / 1000 + pad) * bitmap.height);
        const w = Math.max(24, right - left);
        const h = Math.max(24, bottom - top);
        const scale = Math.min(1, 800 / w);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(bitmap, left, top, w, h, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
        if (blob) blobs.push(blob);
      }
      bitmap.close();
      if (!blobs.length) return toast("error", "No se pudo recortar ningún producto");
      enqueue(blobs, categoryId);
      navigator.vibrate?.(15);
      toast("success", `${blobs.length} producto${blobs.length === 1 ? "" : "s"} en cola: se analizan uno por uno`);
      close();
    } finally {
      setBusy(null);
    }
  }

  const close = () => {
    setFile(null);
    setItems(null);
    setChecked(new Set());
  };
  const toggle = (i: number) =>
    setChecked((s) => {
      const n = new Set(s);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });

  return (
    <>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPick} />
      <button type="button" onClick={() => inputRef.current?.click()} disabled={busy === "detect"} className="press flex w-full items-center gap-3 rounded-3xl border-2 border-violet-300 bg-white p-4 text-left shadow-card transition hover:border-violet-500 hover:bg-violet-50">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-violet-100 text-violet-700">{busy === "detect" ? <Spinner size={22} /> : <IconGrid size={24} />}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold text-ink">Foto de estante · varios productos</span>
          <span className="block text-xs text-slate-500">{busy === "detect" ? "Buscando productos en la foto…" : "Una foto del estante; la IA encuentra cada producto y tú eliges cuáles agregar"}</span>
        </span>
        <span className="btn-secondary btn-sm shrink-0">1 análisis</span>
      </button>

      {items && url && typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[60] flex items-end justify-center md:items-center" onClick={close}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" />
            <div className="animate-in relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl md:rounded-3xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-4 py-3">
                <p className="font-bold text-ink">{items.length} producto{items.length === 1 ? "" : "s"} encontrado{items.length === 1 ? "" : "s"}</p>
                <button onClick={close} className="btn-ghost btn-sm"><IconX size={18} /></button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
                {/* Foto con recuadros: tocar un recuadro lo marca / desmarca */}
                <div className="relative overflow-hidden rounded-2xl bg-slate-900">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="block w-full" />
                  {items.map((it, i) => {
                    const [y0, x0, y1, x1] = it.box_2d;
                    const on = checked.has(i);
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => toggle(i)}
                        className={`absolute rounded-md border-2 text-[10px] font-bold leading-none ${on ? "border-emerald-400 bg-emerald-400/15" : "border-white/50 bg-black/25"}`}
                        style={{ left: `${x0 / 10}%`, top: `${y0 / 10}%`, width: `${(x1 - x0) / 10}%`, height: `${(y1 - y0) / 10}%` }}
                        aria-label={it.nombre_visible}
                      >
                        <span className={`absolute -top-2 left-1 rounded px-1 ${on ? "bg-emerald-500 text-white" : "bg-white/80 text-slate-700"}`}>{i + 1}</span>
                      </button>
                    );
                  })}
                </div>
                <ul className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {items.map((it, i) => {
                    const on = checked.has(i);
                    return (
                      <li key={i}>
                        <button type="button" onClick={() => toggle(i)} className={`flex w-full items-center gap-2 rounded-xl border-2 px-3 py-2 text-left text-sm ${on ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-white text-slate-500"}`}>
                          <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${on ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300"}`}>{on && <IconCheck size={12} />}</span>
                          <span className="w-5 shrink-0 text-xs font-bold text-slate-400">{i + 1}</span>
                          <span className="min-w-0 flex-1 truncate font-medium">{it.nombre_visible || "Producto"}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-2 text-[11px] text-slate-500">Cada producto marcado se recorta y se analiza por separado (1 análisis por producto). Desmarca los que no quieras.</p>
              </div>
              <div className="border-t border-slate-100 p-3">
                <button onClick={enqueueChecked} disabled={!checked.size || busy === "crop"} className="btn-primary btn-lg w-full">
                  {busy === "crop" ? <Spinner /> : <IconCheck size={20} />} Agregar {checked.size} producto{checked.size === 1 ? "" : "s"} a la cola
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
