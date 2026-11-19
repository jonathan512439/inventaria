"use client";

import type { VariantAxis } from "@/types/database";
import VariantGrid from "@/components/VariantGrid";

export const cellKey = (values: Record<string, string>) => JSON.stringify(Object.keys(values).sort().map((k) => [k, values[k]]));

/** «¿Viene en varias tallas / colores?»: sí/no y la cuadrícula con el stock de cada variante. */
export default function VariantSection({
  axes,
  proposals,
  on,
  onToggle,
  chosen,
  onChosen,
  cellStock,
  onCellStock,
  total,
  rows,
  cells,
}: {
  axes: VariantAxis[];
  proposals: Record<string, string[]>;
  on: boolean | null;
  onToggle: (v: boolean) => void;
  chosen: Record<string, string[]>;
  onChosen: (c: Record<string, string[]>) => void;
  cellStock: Record<string, string>;
  onCellStock: (values: Record<string, string>, raw: string) => void;
  /** Stock total, variantes con stock escrito y casillas posibles */
  total: number;
  rows: number;
  cells: number;
}) {
  const seen = Object.values(proposals).flat();
  return (
    <section className="rounded-2xl border-2 border-violet-200 bg-violet-50/40 p-3">
      <p className="text-sm font-semibold text-violet-900">
        ¿Viene en varias {axes.map((a) => a.label.toLowerCase()).join(" / ")}?
        {seen.length > 0 && <span className="ml-1 text-xs font-normal text-violet-700">✨ la IA vio {seen.slice(0, 6).join(", ")}</span>}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => onToggle(true)} className={`min-h-[44px] rounded-xl border-2 px-3 text-sm font-semibold ${on === true ? "border-violet-600 bg-violet-600 text-white" : "border-slate-300 bg-white text-slate-700"}`}>
          Sí, tiene variantes
        </button>
        <button type="button" onClick={() => onToggle(false)} className={`min-h-[44px] rounded-xl border-2 px-3 text-sm font-semibold ${on === false ? "border-slate-700 bg-slate-700 text-white" : "border-slate-300 bg-white text-slate-700"}`}>
          No, es único
        </button>
      </div>
      {on === true && (
        <div className="mt-3">
          <VariantGrid
            axes={axes}
            chosen={chosen}
            onChosen={onChosen}
            suggested={proposals}
            getCell={(values) => {
              const raw = cellStock[cellKey(values)] ?? "";
              return { exists: raw.trim() !== "", stock: raw === "" ? null : raw };
            }}
            onStockInput={onCellStock}
          />
          <p className="mt-2 text-sm text-violet-900">
            Stock total: <b>{total}</b> en <b>{rows}</b> variante{rows === 1 ? "" : "s"}
            {cells > 0 && rows === 0 && <span className="text-xs text-warn-700"> · escribe el stock en las casillas</span>}
          </p>
        </div>
      )}
    </section>
  );
}
