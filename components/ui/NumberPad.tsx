"use client";

/**
 * Teclado numérico grande (C7 · §5): para montos y cantidades en el mostrador, sin abrir el teclado del celular.
 * `value` es texto ("12,5") para no perder la coma mientras se escribe.
 */
export function NumberPad({ value, onChange, decimals = true, max = 9 }: { value: string; onChange: (v: string) => void; decimals?: boolean; max?: number }) {
  const press = (k: string) => {
    navigator.vibrate?.(5);
    if (k === "⌫") return onChange(value.slice(0, -1));
    if (k === ",") {
      if (!decimals || value.includes(",")) return;
      return onChange((value || "0") + ",");
    }
    const [, dec] = value.split(",");
    if (dec !== undefined && dec.length >= 2) return;
    if (value.replace(",", "").length >= max) return;
    onChange(value === "0" ? k : value + k);
  };
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", decimals ? "," : "", "0", "⌫"];
  return (
    <div className="grid grid-cols-3 gap-2">
      {keys.map((k, i) =>
        k ? (
          <button key={i} type="button" onClick={() => press(k)} className="min-h-[52px] rounded-2xl bg-slate-100 text-xl font-bold text-ink transition active:scale-95 active:bg-slate-200" aria-label={k === "⌫" ? "Borrar" : k === "," ? "Coma decimal" : k}>
            {k}
          </button>
        ) : (
          <span key={i} />
        )
      )}
    </div>
  );
}

/** Texto del teclado («12,5») → número. */
export const padNumber = (v: string) => Number((v || "0").replace(",", ".")) || 0;

/** − cantidad + con toques grandes. */
export function QtyStepper({ value, onChange, min = 1 }: { value: number; onChange: (n: number) => void; min?: number }) {
  return (
    <div className="flex items-center rounded-2xl border-2 border-slate-200 bg-white">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} className="h-11 w-11 text-xl font-bold text-slate-600" aria-label="Uno menos">−</button>
      <input
        type="number"
        min={min}
        inputMode="numeric"
        aria-label="Cantidad"
        className="w-12 border-0 bg-transparent text-center text-base font-bold tabular-nums outline-none"
        value={value}
        onChange={(e) => onChange(Math.max(min, parseInt(e.target.value, 10) || min))}
      />
      <button type="button" onClick={() => onChange(value + 1)} className="h-11 w-11 text-xl font-bold text-slate-600" aria-label="Uno más">+</button>
    </div>
  );
}
