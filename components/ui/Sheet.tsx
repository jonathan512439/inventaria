"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { IconX } from "./Icons";

/**
 * Hoja inferior en el celular / ventana centrada en escritorio (C7 · sistema visual).
 * Alto máximo con desplazamiento propio (regla de CLAUDE.md); el pie (acción principal) queda fijo con fondo sólido.
 */
export default function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center md:items-center md:p-6" role="dialog" aria-modal="true">
      <button type="button" aria-label="Cerrar" className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={onClose} />
      <div className={`animate-in relative flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl md:rounded-3xl ${wide ? "md:max-w-2xl" : "md:max-w-md"}`}>
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 px-4 py-3">
          <span className="absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-slate-300 md:hidden" aria-hidden />
          <div className="min-w-0 flex-1 text-base font-bold text-ink">{title}</div>
          <button type="button" onClick={onClose} className="btn-ghost btn-sm" aria-label="Cerrar"><IconX size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{children}</div>
        {footer && <div className="shrink-0 border-t border-slate-100 bg-white p-3" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
