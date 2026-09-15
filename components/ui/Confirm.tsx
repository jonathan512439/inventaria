"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconAlert, IconCheck, IconTrash, IconX, Spinner } from "./Icons";

export interface ConfirmOptions {
  title: string;
  /** Explicación en una o dos frases, sin tecnicismos */
  body?: React.ReactNode;
  /** Resumen en filas «etiqueta → valor» (p. ej. lo que se va a corregir) */
  details?: { label: string; value: string; tone?: "ok" | "warn" | "danger" }[];
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "primary" | "success" | "danger";
}

type Ask = (o: ConfirmOptions) => Promise<boolean>;
const Ctx = createContext<Ask>(async () => false);

/** Ventana de confirmación con el diseño de la app (sustituye a los avisos del navegador). */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState<ConfirmOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const ask = useCallback<Ask>((o) => {
    setOpen(o);
    setBusy(false);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (value: boolean) => {
    if (value) setBusy(true);
    resolver.current?.(value);
    resolver.current = null;
    setOpen(null);
    setBusy(false);
  };

  const value = useMemo(() => ask, [ask]);
  const tone = open?.tone ?? "primary";
  const Icon = tone === "danger" ? IconTrash : tone === "success" ? IconCheck : IconAlert;
  const head = tone === "danger" ? "bg-rose-100 text-rose-700" : tone === "success" ? "bg-emerald-100 text-emerald-700" : "bg-brand-100 text-brand-700";
  const btn = tone === "danger" ? "btn-destructive" : tone === "success" ? "btn-success" : "btn-primary";
  const value_tone = { ok: "text-emerald-700", warn: "text-amber-700", danger: "text-rose-700" } as const;

  return (
    <Ctx.Provider value={value}>
      {children}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[80] flex items-end justify-center md:items-center" onClick={() => close(false)}>
            <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
            <div className="animate-in relative w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl md:rounded-3xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
              <div className="flex items-start gap-3">
                <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${head}`}><Icon size={22} /></span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-bold leading-tight text-ink">{open.title}</h2>
                  {open.body && <div className="mt-1 text-sm leading-snug text-slate-600">{open.body}</div>}
                </div>
                <button onClick={() => close(false)} className="btn-ghost btn-sm -mr-2 -mt-1" aria-label="Cerrar"><IconX size={18} /></button>
              </div>

              {open.details && open.details.length > 0 && (
                <dl className="mt-4 divide-y divide-slate-100 rounded-2xl bg-slate-50 px-3">
                  {open.details.map((d) => (
                    <div key={d.label} className="flex items-center gap-3 py-2 text-sm">
                      <dt className="min-w-0 flex-1 text-slate-600">{d.label}</dt>
                      <dd className={`shrink-0 font-bold tabular-nums ${d.tone ? value_tone[d.tone] : "text-ink"}`}>{d.value}</dd>
                    </div>
                  ))}
                </dl>
              )}

              <div className="mt-5 grid gap-2">
                <button onClick={() => close(true)} disabled={busy} className={`${btn} btn-lg w-full`}>
                  {busy ? <Spinner /> : <Icon size={20} />} {open.confirmLabel ?? "Confirmar"}
                </button>
                <button onClick={() => close(false)} className="btn-ghost w-full text-slate-500">{open.cancelLabel ?? "Cancelar"}</button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </Ctx.Provider>
  );
}

/** `const confirm = useConfirm(); if (await confirm({ title: "…" })) { … }` */
export const useConfirm = () => useContext(Ctx);
