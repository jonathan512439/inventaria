"use client";

import Link from "next/link";
import { useFlow } from "./FlowProvider";
import { IconCheck } from "./ui/Icons";

const STEPS = [
  { n: 1, label: "Agregar", href: "/capture" },
  { n: 2, label: "Revisar", href: "/review" },
  { n: 3, label: "Inventario", href: "/products" },
] as const;

/**
 * Barra de pasos ① Agregar → ② Revisar → ③ Inventario, siempre visible en el flujo.
 * Estado: hecho ✓ · actual ● · siguiente ○, con el contador de pendientes en ②.
 */
export default function StepBar() {
  const flow = useFlow();
  if (flow.step === 0) return null;
  const hasAny = flow.pending + flow.confirmed + flow.working > 0;
  const doneOf = (n: number) => (n === 1 ? hasAny : n === 2 ? flow.confirmed > 0 && flow.pending === 0 : flow.confirmed > 0);

  return (
    <nav aria-label="Pasos" className="animate-in -mx-4 mb-4 flex items-center justify-center gap-1 border-b border-slate-200/70 bg-white/70 px-4 py-2 text-xs backdrop-blur md:mx-0 md:mb-6 md:rounded-2xl md:border md:bg-white md:shadow-card">
      {STEPS.map((s, i) => {
        const current = flow.step === s.n;
        const done = !current && doneOf(s.n);
        return (
          <div key={s.n} className="flex items-center">
            <Link
              href={s.href}
              aria-current={current ? "step" : undefined}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold transition ${current ? "bg-brand-600 text-white shadow-md shadow-brand-500/30" : done ? "text-emerald-700 hover:bg-emerald-50" : "text-slate-500 hover:bg-slate-100"}`}
            >
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${current ? "bg-white/25 text-white" : done ? "bg-emerald-500 text-white" : "border-2 border-slate-300 text-slate-500"}`}>
                {done ? <IconCheck size={11} /> : s.n}
              </span>
              <span>{s.label}</span>
              {s.n === 2 && flow.pending > 0 && (
                <span className={`rounded-full px-1.5 text-[10px] font-bold ${current ? "bg-white text-brand-700" : "bg-amber-400 text-amber-950"}`}>{flow.pending}</span>
              )}
              {s.n === 1 && flow.working > 0 && <span className="animate-pulse rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-amber-950">{flow.working}</span>}
            </Link>
            {i < STEPS.length - 1 && <span className={`mx-0.5 h-0.5 w-4 rounded-full sm:w-8 ${doneOf(s.n) ? "bg-emerald-400" : "bg-slate-200"}`} />}
          </div>
        );
      })}
    </nav>
  );
}
