"use client";

import type { BusinessMode } from "@/types/database";
import { IconBox, IconCart, IconCheck } from "@/components/ui/Icons";

export const MODES: { value: BusinessMode; title: string; body: string; Icon: (p: { size?: number }) => JSX.Element }[] = [
  { value: "completo", title: "Inventario y ventas", body: "Controlas tus productos y además vendes en la app: cobro, vuelto, caja, fiados y ganancia.", Icon: IconCart },
  { value: "inventario", title: "Solo inventario", body: "Solo controlas tus productos: lo que entra, lo que sale (con su motivo) y lo que falta. Sin ventas ni caja.", Icon: IconBox },
];

/**
 * Elegir para qué se usa la app (R10 · 030). Lo usan el asistente inicial y Ajustes › Modo de uso.
 * Cambiar de modo no borra nada: solo muestra u oculta Vender, Caja y Clientes.
 */
export default function ModePicker({ value, onChange, disabled }: { value: BusinessMode; onChange: (m: BusinessMode) => void; disabled?: boolean }) {
  return (
    <div className="grid gap-2" role="radiogroup" aria-label="Modo de uso">
      {MODES.map(({ value: v, title, body, Icon }) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          disabled={disabled}
          onClick={() => onChange(v)}
          className={`flex min-h-[72px] items-start gap-3 rounded-2xl border-2 p-3 text-left transition disabled:opacity-60 ${value === v ? "border-brand-500 bg-brand-50" : "border-slate-200 bg-white hover:border-brand-300"}`}
        >
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${value === v ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}><Icon size={20} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-bold text-ink">{title}</span>
            <span className="block text-xs text-muted">{body}</span>
          </span>
          {value === v && <IconCheck size={20} className="shrink-0 text-brand-600" />}
        </button>
      ))}
    </div>
  );
}
