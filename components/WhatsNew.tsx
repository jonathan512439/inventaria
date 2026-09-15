"use client";

import { Fragment, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { markTourSeen, tourSeen } from "@/lib/coach";
import { IconArrowRight, IconBox, IconCamera, IconCheck, IconCheckCircle, IconHome, IconList, IconX } from "./ui/Icons";

interface Props {
  /** Abrir aunque ya se haya visto (desde «Más → ¿Qué hay de nuevo?») */
  force?: boolean;
  onClose?: () => void;
}

const SLIDES = [
  {
    title: "Un camino de 3 pasos",
    text: "Agregar → Revisar → Inventario. La barra de pasos está siempre arriba: sabes dónde estás y qué sigue. Cada pantalla tiene una sola acción principal, grande y abajo.",
    Art: ArtSteps,
  },
  {
    title: "Menú más simple",
    text: "Abajo solo hay Inicio, Agregar, Inventario y Más. «Revisar» vive en la barra de pasos y en el Inicio, con su contador. Escáner, ventas, Excel, Mi tienda y la guía están en Más.",
    Art: ArtMenu,
  },
  {
    title: "Variantes con stock propio",
    text: "Talla, color o edad: cada combinación tiene su stock, su código de barras y sus ventas. Toca una casilla para sumar, vender o retirar. El Excel sale una fila por variante.",
    Art: ArtVariants,
  },
];

/** Recorrido de novedades (3 pantallas). Se muestra una sola vez; se puede reabrir desde Más. */
export default function WhatsNew({ force, onClose }: Props) {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (force || !tourSeen()) setOpen(true);
  }, [force]);
  if (!open || typeof document === "undefined") return null;
  const close = () => {
    markTourSeen();
    setOpen(false);
    onClose?.();
  };
  const s = SLIDES[i];
  const last = i === SLIDES.length - 1;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center md:items-center" onClick={close}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
      <div className="animate-in relative w-full max-w-md overflow-hidden rounded-t-3xl bg-white shadow-2xl md:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="bg-gradient-to-br from-brand-600 via-violet-600 to-fuchsia-600 px-5 pb-5 pt-4 text-white">
          <div className="flex items-center justify-between">
            <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide">Nuevo diseño · {i + 1}/{SLIDES.length}</span>
            <button onClick={close} className="rounded-full p-1.5 text-white/80 hover:bg-white/20" aria-label="Cerrar"><IconX size={18} /></button>
          </div>
          <div className="mt-3 h-36"><s.Art /></div>
        </div>
        <div className="p-5">
          <h2 className="text-xl font-bold text-ink">{s.title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">{s.text}</p>
          <div className="mt-4 flex items-center gap-2">
            <div className="flex flex-1 gap-1">
              {SLIDES.map((_, k) => (
                <button key={k} onClick={() => setI(k)} className={`h-1.5 rounded-full transition-all ${k === i ? "w-6 bg-brand-600" : "w-1.5 bg-slate-300"}`} aria-label={`Pantalla ${k + 1}`} />
              ))}
            </div>
            {!last && <button onClick={close} className="btn-ghost btn-sm text-slate-500">Saltar</button>}
            <button onClick={() => (last ? close() : setI(i + 1))} className="btn-primary">
              {last ? <><IconCheck size={18} /> Empezar</> : <>Siguiente <IconArrowRight size={16} /></>}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function ArtSteps() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <div className="flex items-center gap-1 rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold">
        <span className="flex items-center gap-1 rounded-full bg-emerald-400 px-2 py-0.5 text-emerald-950"><IconCheck size={11} /> Agregar</span>
        <span className="h-0.5 w-5 bg-white/50" />
        <span className="flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-brand-700">● Revisar <span className="rounded-full bg-amber-400 px-1 text-[10px] text-amber-950">4</span></span>
        <span className="h-0.5 w-5 bg-white/50" />
        <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-white/70">○ Inventario</span>
      </div>
      <div className="w-56 space-y-1.5 rounded-2xl bg-white/15 p-2.5">
        <div className="h-2 w-3/4 rounded bg-white/50" />
        <div className="h-2 w-1/2 rounded bg-white/30" />
        <div className="mt-2 rounded-xl bg-emerald-400 py-1.5 text-center text-xs font-bold text-emerald-950">✓ Confirmar y pasar al siguiente</div>
      </div>
    </div>
  );
}

function ArtMenu() {
  const items = [
    { Icon: IconHome, t: "Inicio" },
    { Icon: IconCamera, t: "Agregar", primary: true },
    { Icon: IconBox, t: "Inventario" },
    { Icon: IconList, t: "Más" },
  ];
  return (
    <div className="flex h-full flex-col items-center justify-end gap-3">
      <div className="flex flex-wrap justify-center gap-1 text-[10px] font-semibold">
        {["Escanear", "Ventas", "Excel", "Mi tienda", "Guía", "Limpiar", "Ajustes"].map((t) => (
          <span key={t} className="rounded-full bg-white/20 px-2 py-0.5">{t}</span>
        ))}
      </div>
      <div className="flex w-64 items-end justify-around rounded-2xl bg-white px-3 pb-2 pt-1 text-[10px] font-semibold text-slate-600">
        {items.map(({ Icon, t, primary }) => (
          <span key={t} className={`flex flex-col items-center gap-0.5 ${primary ? "-mt-4" : ""}`}>
            <span className={primary ? "grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-violet-500 text-white shadow-lg" : "text-slate-500"}><Icon size={primary ? 20 : 18} /></span>
            <span className={primary ? "text-brand-700" : ""}>{t}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function ArtVariants() {
  const rows = [["S", 3, 2, 0], ["M", 5, 4, 1], ["L", 2, 0, 2]] as const;
  const cell = (n: number) => (n === 0 ? "bg-rose-200 text-rose-900" : n <= 2 ? "bg-amber-200 text-amber-900" : "bg-emerald-200 text-emerald-900");
  return (
    <div className="flex h-full items-center justify-center">
      <div className="rounded-2xl bg-white/15 p-2.5">
        <div className="grid grid-cols-4 gap-1 text-center text-[11px] font-bold">
          <span className="text-white/70">Polera</span>
          {["Rojo", "Azul", "Negro"].map((c) => <span key={c}>{c}</span>)}
          {rows.map(([t, ...ns]) => (
            <Fragment key={t}>
              <span className="self-center">{t}</span>
              {ns.map((n, k) => <span key={k} className={`rounded-lg py-1 ${cell(n)}`}>{n}</span>)}
            </Fragment>
          ))}
        </div>
        <p className="mt-1.5 text-center text-[10px] text-white/80">● agotado: S · Negro, L · Azul</p>
      </div>
      <IconCheckCircle className="ml-3 hidden text-emerald-300 sm:block" size={34} />
    </div>
  );
}
