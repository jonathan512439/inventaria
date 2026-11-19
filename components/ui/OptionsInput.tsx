"use client";

/** Separa lo escrito en opciones: por coma o salto de línea, sin repetir ni vacías (máx. 40). */
export function parseOptions(raw: string): string[] {
  return Array.from(new Set(raw.split(/,|\n/).map((s) => s.trim()).filter(Boolean))).slice(0, 40);
}

/**
 * Campo para escribir opciones (R6): dice cómo separarlas, con un ejemplo, y muestra en vivo cómo quedan
 * (cada opción en su chip). Se usa en Mi catálogo (datos con opciones) y en los ejes de variantes.
 */
export default function OptionsInput({
  id,
  value,
  onChange,
  example = "fresa, uva, menta",
  onEnter,
  autoFocus,
  compact,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  /** Ejemplo a la medida del dato (talla: «S, M, L, XL») */
  example?: string;
  onEnter?: () => void;
  autoFocus?: boolean;
  compact?: boolean;
}) {
  const opts = parseOptions(value);
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <input
        id={id}
        className={`input ${compact ? "min-h-[40px] py-1.5 text-sm" : "min-h-[44px]"}`}
        placeholder={`Ej.: ${example}`}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
      />
      <p className="text-xs text-muted">Separa cada opción con una coma. Ej.: <b className="text-slate-700">{example}</b></p>
      {opts.length > 0 && (
        <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto" aria-label={`${opts.length} opciones`}>
          {opts.map((o) => (
            <span key={o} className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-800">{o}</span>
          ))}
          <span className="px-1 text-xs text-muted">{opts.length} opci{opts.length === 1 ? "ón" : "ones"}</span>
        </div>
      )}
    </div>
  );
}
