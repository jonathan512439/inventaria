"use client";

import { useState } from "react";
import Link from "next/link";
import Sheet from "./Sheet";
import { IconArrowLeft, IconHelp } from "./Icons";

/**
 * Piezas comunes de pantalla (C7 · RECONSTRUCCION_VISUAL.md §5). Todas las pantallas tienen la misma forma:
 * ScreenHeader (atrás · título · «?») → filtros → contenido → acción fija (.sticky-action).
 */

export function ScreenHeader({
  title,
  subtitle,
  back,
  help,
  action,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Enlace «atrás»: { href, label } */
  back?: { href: string; label: string };
  /** Ayuda de esta pantalla (se abre con «?»): un párrafo, sin manual */
  help?: React.ReactNode;
  /** Acción secundaria a la derecha del título */
  action?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <header className="animate-in">
      {back && (
        <Link href={back.href} className="mb-2 inline-flex min-h-[44px] items-center gap-1 text-sm text-muted hover:text-brand-700">
          <IconArrowLeft size={16} /> {back.label}
        </Link>
      )}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
        {action}
        {help && (
          <button type="button" onClick={() => setOpen(true)} className="btn-ghost btn-sm h-11 w-11 shrink-0 p-0" aria-label="¿Cómo se usa esta pantalla?">
            <IconHelp size={20} />
          </button>
        )}
      </div>
      {help && (
        <Sheet open={open} onClose={() => setOpen(false)} title="¿Cómo se usa?">
          <div className="space-y-2 text-sm leading-relaxed text-slate-700">{help}</div>
        </Sheet>
      )}
    </header>
  );
}

/** Pestañas (una sola elegida). */
export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: React.ReactNode; count?: number }[] }) {
  return (
    <div role="tablist" className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 md:mx-0 md:px-0">
      {items.map((it) => {
        const on = it.value === value;
        return (
          <button
            key={it.value}
            role="tab"
            aria-selected={on}
            type="button"
            onClick={() => onChange(it.value)}
            className={`min-h-[44px] shrink-0 rounded-2xl px-4 text-sm font-semibold transition ${on ? "bg-ink text-white" : "bg-white text-slate-600 ring-1 ring-slate-900/10 hover:bg-slate-50"}`}
          >
            {it.label}
            {typeof it.count === "number" && it.count > 0 && <span className={`ml-1.5 rounded-full px-1.5 text-xs ${on ? "bg-white/20" : "bg-slate-100"}`}>{it.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Filtros en chips (varios a la vez); se desplazan de lado en el celular. */
export function ChipFilter<T extends string>({ value, onToggle, items }: { value: Set<T> | T[]; onToggle: (v: T) => void; items: { value: T; label: React.ReactNode; count?: number; tone?: "warn" | "danger" | "info" }[] }) {
  const on = (v: T) => (value instanceof Set ? value.has(v) : value.includes(v));
  return (
    <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
      {items.map((it) => (
        <button key={it.value} type="button" onClick={() => onToggle(it.value)} className={`chip min-h-[40px] shrink-0 ${on(it.value) ? "chip-active" : ""}`} aria-pressed={on(it.value)}>
          {it.label}
          {typeof it.count === "number" && (
            <span className={`rounded-full px-1.5 text-xs font-bold ${on(it.value) ? "bg-white/25" : it.tone === "danger" ? "bg-danger-100 text-danger-700" : it.tone === "warn" ? "bg-warn-100 text-warn-800" : "bg-slate-100 text-slate-600"}`}>{it.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Estado vacío que explica y ofrece la acción (en vez de un consejo aparte). */
export function EmptyState({ icon, title, body, action }: { icon?: React.ReactNode; title: React.ReactNode; body?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="animate-in card flex flex-col items-center gap-2 py-8 text-center">
      {icon && <span className="grid h-14 w-14 place-items-center rounded-full bg-brand-50 text-brand-600">{icon}</span>}
      <p className="text-base font-bold text-ink">{title}</p>
      {body && <p className="max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Un número con su etiqueta (cifras tabulares). */
export function Stat({ label, value, hint, tone }: { label: React.ReactNode; value: React.ReactNode; hint?: React.ReactNode; tone?: "ok" | "warn" | "danger" }) {
  const color = tone === "ok" ? "text-ok-700" : tone === "warn" ? "text-warn-700" : tone === "danger" ? "text-danger-700" : "text-ink";
  return (
    <div className="rounded-3xl bg-white p-4 shadow-card ring-1 ring-slate-900/10">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-0.5 text-2xl font-bold tabular-nums ${color}`}>{value}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** Fila de lista tocable (mínimo 56 px de alto). */
export function ListRow({ href, onClick, icon, title, subtitle, end }: { href?: string; onClick?: () => void; icon?: React.ReactNode; title: React.ReactNode; subtitle?: React.ReactNode; end?: React.ReactNode }) {
  const body = (
    <>
      {icon && <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-semibold leading-tight text-ink">{title}</span>
        {subtitle && <span className="block truncate text-xs text-muted">{subtitle}</span>}
      </span>
      {end}
    </>
  );
  const cls = "flex min-h-[56px] w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition hover:bg-brand-50 active:bg-brand-100";
  if (href) return <Link href={href} className={cls}>{body}</Link>;
  return <button type="button" onClick={onClick} className={cls}>{body}</button>;
}

/** Tarea de Inicio: algo que pide atención con el botón que lo resuelve. */
export function TaskCard({ icon, title, body, href, cta, tone = "info" }: { icon: React.ReactNode; title: React.ReactNode; body?: React.ReactNode; href: string; cta: string; tone?: "info" | "warn" | "danger" | "ok" }) {
  const ring = tone === "danger" ? "bg-danger-100 text-danger-700" : tone === "warn" ? "bg-warn-100 text-warn-800" : tone === "ok" ? "bg-ok-100 text-ok-700" : "bg-info-100 text-info-700";
  return (
    <Link href={href} className="animate-in flex min-h-[64px] items-center gap-3 rounded-3xl bg-white p-3 shadow-card ring-1 ring-slate-900/10 transition hover:ring-brand-300">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${ring}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold leading-tight text-ink">{title}</span>
        {body && <span className="block text-xs text-muted">{body}</span>}
      </span>
      <span className="shrink-0 text-sm font-semibold text-brand-700">{cta} →</span>
    </Link>
  );
}
