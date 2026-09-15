"use client";

import { useState } from "react";
import type { VariantAxis } from "@/types/database";
import { IconPlus, IconX } from "./ui/Icons";

/** Estado de una celda de la cuadrícula (una combinación). */
export interface CellState {
  /** Existe como variante guardada (o el usuario ya escribió algo) */
  exists: boolean;
  stock: number | string | null;
  /** Marca visual extra (p. ej. código de barras asignado) */
  hint?: string;
}

interface Props {
  axes: VariantAxis[];
  /** Opciones elegidas por eje (definen filas/columnas) */
  chosen: Record<string, string[]>;
  onChosen: (next: Record<string, string[]>) => void;
  /** Cómo se ve cada combinación */
  getCell: (values: Record<string, string>) => CellState;
  /** Modo edición: escribir stock por celda */
  onStockInput?: (values: Record<string, string>, raw: string) => void;
  /** Modo vista: tocar una celda */
  onCell?: (values: Record<string, string>) => void;
  /** Propuestas de la IA (para resaltar chips sugeridos) */
  suggested?: Record<string, string[]>;
  compact?: boolean;
}

/**
 * Cuadrícula de variantes: filas = 1er eje, columnas = 2º eje, pestañas = 3er eje.
 * Con un solo eje es una lista. Las opciones se eligen con chips por eje; se pueden escribir nuevas.
 */
export default function VariantGrid({ axes, chosen, onChosen, getCell, onStockInput, onCell, suggested, compact }: Props) {
  const [adding, setAdding] = useState<{ key: string; text: string } | null>(null);
  const [third, setThird] = useState(0);

  const active = axes.filter((a) => (chosen[a.key] ?? []).length > 0);
  const rowsAxis = active[0];
  const colsAxis = active[1];
  const tabAxis = active[2];
  const tabValue = tabAxis ? (chosen[tabAxis.key] ?? [])[Math.min(third, (chosen[tabAxis.key] ?? []).length - 1)] : undefined;

  const toggle = (axis: VariantAxis, opt: string) => {
    const cur = chosen[axis.key] ?? [];
    const next = cur.includes(opt) ? cur.filter((o) => o !== opt) : [...cur, opt];
    onChosen({ ...chosen, [axis.key]: next });
  };
  const addCustom = () => {
    if (!adding) return;
    const text = adding.text.trim().slice(0, 30);
    if (text) {
      const cur = chosen[adding.key] ?? [];
      if (!cur.some((o) => o.toLowerCase() === text.toLowerCase())) onChosen({ ...chosen, [adding.key]: [...cur, text] });
    }
    setAdding(null);
  };

  const cell = (values: Record<string, string>) => {
    const st = getCell(values);
    const n = st.stock === null || st.stock === "" ? null : Number(st.stock);
    const cls = !st.exists
      ? "border-dashed border-slate-300 bg-white text-slate-300"
      : n === 0
        ? "border-rose-300 bg-rose-50 text-rose-700"
        : n !== null && n <= 3
          ? "border-amber-300 bg-amber-50 text-amber-800"
          : "border-emerald-300 bg-emerald-50 text-emerald-800";
    if (onStockInput) {
      return (
        <input
          type="number"
          min={0}
          inputMode="numeric"
          placeholder="–"
          value={st.stock === null ? "" : String(st.stock)}
          onChange={(e) => onStockInput(values, e.target.value)}
          className={`h-11 w-full rounded-xl border-2 text-center text-base font-bold tabular-nums outline-none focus:border-brand-500 ${cls}`}
          aria-label={Object.values(values).join(" ")}
        />
      );
    }
    return (
      <button type="button" onClick={() => onCell?.(values)} className={`h-11 w-full rounded-xl border-2 text-center text-base font-bold tabular-nums transition active:scale-95 ${cls}`} title={st.hint}>
        {st.exists ? (n ?? "–") : "+"}
        {st.hint && <span className="block text-[9px] font-normal leading-none opacity-70">{st.hint}</span>}
      </button>
    );
  };

  return (
    <div className="space-y-3">
      {/* Chips por eje */}
      {axes.map((axis) => {
        const cur = chosen[axis.key] ?? [];
        const opts = Array.from(new Set([...axis.options, ...cur]));
        const sug = suggested?.[axis.key] ?? [];
        return (
          <div key={axis.key}>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {axis.label} <span className="font-normal normal-case text-slate-400">· toca las que tienes</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {opts.map((o) => {
                const on = cur.includes(o);
                const isSug = sug.includes(o);
                return (
                  <button
                    key={o}
                    type="button"
                    onClick={() => toggle(axis, o)}
                    className={`rounded-full border-2 px-3 py-1 text-sm font-semibold transition ${on ? "border-brand-500 bg-brand-500 text-white" : isSug ? "border-violet-400 bg-violet-50 text-violet-800" : "border-slate-300 bg-white text-slate-700"}`}
                    title={isSug ? "La IA la vio en la foto" : undefined}
                  >
                    {isSug && !on ? "✨ " : ""}{o}
                  </button>
                );
              })}
              {adding?.key === axis.key ? (
                <span className="inline-flex items-center gap-1 rounded-full border-2 border-brand-400 bg-white pl-3 pr-1">
                  <input
                    autoFocus
                    className="w-24 bg-transparent text-sm outline-none"
                    placeholder={`Otra ${axis.label.toLowerCase()}`}
                    value={adding.text}
                    onChange={(e) => setAdding({ ...adding, text: e.target.value })}
                    onKeyDown={(e) => (e.key === "Enter" ? addCustom() : e.key === "Escape" ? setAdding(null) : null)}
                    onBlur={addCustom}
                  />
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={addCustom} className="rounded-full bg-brand-600 p-1 text-white"><IconPlus size={12} /></button>
                </span>
              ) : (
                <button type="button" onClick={() => setAdding({ key: axis.key, text: "" })} className="rounded-full border-2 border-dashed border-slate-300 px-3 py-1 text-sm font-semibold text-brand-700">
                  <IconPlus size={12} className="mr-0.5 inline" /> Otra
                </button>
              )}
            </div>
          </div>
        );
      })}

      {/* Cuadrícula */}
      {rowsAxis && (
        <div className="rounded-2xl border-2 border-slate-200 p-2">
          {tabAxis && (
            <div className="mb-2 flex flex-wrap gap-1">
              {(chosen[tabAxis.key] ?? []).map((v, i) => (
                <button key={v} type="button" onClick={() => setThird(i)} className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${tabValue === v ? "bg-ink text-white" : "bg-slate-100 text-slate-600"}`}>
                  {tabAxis.label}: {v}
                </button>
              ))}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-1">
              {colsAxis && (
                <thead>
                  <tr>
                    <th className="w-16 text-left text-[10px] font-semibold uppercase text-slate-400">{rowsAxis.label} \ {colsAxis.label}</th>
                    {(chosen[colsAxis.key] ?? []).map((c) => (
                      <th key={c} className="min-w-[56px] truncate px-1 text-center text-xs font-bold text-slate-700">
                        <span className="inline-flex items-center gap-0.5">
                          {c}
                          <button type="button" onClick={() => toggle(colsAxis, c)} className="text-slate-300 hover:text-rose-500" title="Quitar"><IconX size={10} /></button>
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {(chosen[rowsAxis.key] ?? []).map((r) => (
                  <tr key={r}>
                    <th className="w-16 pr-1 text-left text-xs font-bold text-slate-700">
                      <span className="inline-flex items-center gap-0.5">
                        {r}
                        <button type="button" onClick={() => toggle(rowsAxis, r)} className="text-slate-300 hover:text-rose-500" title="Quitar"><IconX size={10} /></button>
                      </span>
                    </th>
                    {colsAxis ? (
                      (chosen[colsAxis.key] ?? []).map((c) => (
                        <td key={c} className="min-w-[56px]">{cell({ [rowsAxis.key]: r, [colsAxis.key]: c, ...(tabAxis && tabValue ? { [tabAxis.key]: tabValue } : {}) })}</td>
                      ))
                    ) : (
                      <td className="w-28">{cell({ [rowsAxis.key]: r })}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!compact && (
            <p className="mt-1 text-[11px] text-slate-500">
              {onStockInput ? "Escribe cuántas tienes en cada casilla; las vacías no se crean." : "Toca una casilla para sumar, vender o retirar. «+» crea esa variante."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
