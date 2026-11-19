"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { markTourSeen, tourSeen } from "@/lib/tour";
import { IconArrowRight, IconBox, IconCheck, IconGrid, IconHelp, IconHome, IconMore, IconScan, IconUsers, IconX } from "./ui/Icons";

interface Props {
  /** Abrir aunque ya se haya visto (desde Ajustes › Ayuda o Más › Cómo usar la app) */
  force?: boolean;
  onClose?: () => void;
}

const SLIDES = [
  {
    title: "Cinco lugares, nada más",
    text: "Abajo están Inicio, Productos, Gestionar (el botón grande del centro), Clientes y Más. Gestionar junta lo que haces cada día: vender, entrada de inventario, producto nuevo y contar. Mantenlo apretado para ir directo a lo último que usaste.",
    Art: ArtBar,
  },
  {
    title: "Inicio te dice qué hacer hoy",
    text: "Arriba, el botón para vender y lo vendido hoy. Debajo, hasta 4 avisos con su botón: pendientes por revisar, lo que falta, lo que vence, quién debe o la caja sin cerrar.",
    Art: ArtTasks,
  },
  {
    title: "Un producto se encuentra siempre igual",
    text: "En Vender, Productos, Entrada de inventario y Contar: escribe parte del nombre o toca el escáner. Si tiene tallas o colores, te pregunta cuál.",
    Art: ArtFinder,
  },
  {
    title: "¿Dudas? Toca «?»",
    text: "Cada pantalla tiene arriba un «?» que explica en pocas líneas cómo se usa. Cuando una lista está vacía, también te dice qué hacer.",
    Art: ArtHelp,
  },
];

/** Recorrido de la app (4 pantallas). Se muestra una sola vez por versión. */
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
    <div className="fixed inset-0 z-[70] flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-label="Cómo usar la app" onClick={close}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
      <div className="animate-in relative w-full max-w-md overflow-hidden rounded-t-3xl bg-white shadow-2xl md:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="bg-gradient-to-br from-brand-600 via-violet-600 to-fuchsia-600 px-5 pb-5 pt-4 text-white">
          <div className="flex items-center justify-between">
            <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide">Cómo usar la app · {i + 1}/{SLIDES.length}</span>
            <button type="button" onClick={close} className="grid h-11 w-11 place-items-center rounded-full text-white/90 hover:bg-white/20" aria-label="Cerrar"><IconX size={20} /></button>
          </div>
          <div className="mt-2 h-36"><s.Art /></div>
        </div>
        <div className="p-5">
          <h2 className="text-xl font-bold text-ink">{s.title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">{s.text}</p>
          <div className="mt-4 flex items-center gap-2">
            <div className="flex flex-1 gap-1">
              {SLIDES.map((_, k) => (
                <button key={k} type="button" onClick={() => setI(k)} className="grid h-11 w-6 place-items-center" aria-label={`Pantalla ${k + 1}`}>
                  <span className={`h-1.5 rounded-full transition-all ${k === i ? "w-6 bg-brand-600" : "w-1.5 bg-slate-300"}`} />
                </button>
              ))}
            </div>
            {!last && <button type="button" onClick={close} className="btn-ghost min-h-[44px] text-muted">Saltar</button>}
            <button type="button" onClick={() => (last ? close() : setI(i + 1))} className="btn-primary min-h-[44px]">
              {last ? <><IconCheck size={18} /> Empezar</> : <>Siguiente <IconArrowRight size={16} /></>}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function ArtBar() {
  const items = [
    { Icon: IconHome, t: "Inicio" },
    { Icon: IconBox, t: "Productos" },
    { Icon: IconGrid, t: "Gestionar", primary: true },
    { Icon: IconUsers, t: "Clientes" },
    { Icon: IconMore, t: "Más" },
  ];
  return (
    <div className="flex h-full items-end justify-center">
      <div className="flex w-72 items-end justify-around rounded-2xl bg-white px-2 pb-2 pt-1 text-xs font-semibold text-slate-600">
        {items.map(({ Icon, t, primary }) => (
          <span key={t} className={`flex flex-col items-center gap-0.5 ${primary ? "-mt-6" : ""}`}>
            <span className={primary ? "grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-violet-500 text-white shadow-lg" : "text-slate-500"}>
              <Icon size={primary ? 24 : 20} />
            </span>
            <span className={primary ? "text-brand-700" : ""}>{t}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function ArtTasks() {
  const rows = [
    { t: "3 por revisar", c: "bg-sky-200 text-sky-900" },
    { t: "5 por reponer", c: "bg-amber-200 text-amber-900" },
    { t: "Juanito debe hace 32 días", c: "bg-rose-200 text-rose-900" },
  ];
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5">
      <div className="w-60 rounded-xl bg-white/90 py-1.5 text-center text-sm font-bold text-brand-700">Vender · hoy 245</div>
      {rows.map((r) => (
        <div key={r.t} className="flex w-60 items-center justify-between rounded-xl bg-white/15 px-2 py-1 text-xs">
          <span className={`rounded-full px-2 py-0.5 font-semibold ${r.c}`}>{r.t}</span>
          <span className="font-semibold">Ver →</span>
        </div>
      ))}
    </div>
  );
}

function ArtFinder() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2">
      <div className="flex w-64 items-center gap-2 rounded-2xl bg-white px-3 py-2 text-sm text-slate-500">
        <span className="min-w-0 flex-1 truncate">gaseosa 2…</span>
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand-600 text-white"><IconScan size={16} /></span>
      </div>
      <div className="flex gap-1.5 text-xs font-bold">
        {["S", "M", "L"].map((t) => <span key={t} className="rounded-xl border-2 border-white/60 px-3 py-1">{t}</span>)}
      </div>
    </div>
  );
}

function ArtHelp() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="w-64 rounded-2xl bg-white/15 p-3">
        <div className="flex items-center justify-between">
          <span className="text-base font-bold">Caja de hoy</span>
          <span className="grid h-9 w-9 place-items-center rounded-full bg-white text-brand-700"><IconHelp size={18} /></span>
        </div>
        <div className="mt-2 h-2 w-3/4 rounded bg-white/50" />
        <div className="mt-1 h-2 w-1/2 rounded bg-white/30" />
      </div>
    </div>
  );
}
