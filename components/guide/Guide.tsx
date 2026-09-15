"use client";

import { useState } from "react";
import Link from "next/link";
import { IconCheck, IconChevronRight } from "../ui/Icons";
import { IllustrationCapture, IllustrationChoose, IllustrationInventory, IllustrationReview } from "./Illustrations";

export type StepState = "done" | "current" | "todo";

export interface GuideProgress {
  hasTypes: boolean;
  hasPhotos: boolean; // algún producto (pendiente o confirmado)
  hasConfirmed: boolean;
  pending: number;
}

interface Step {
  n: number;
  title: string;
  goal: string;
  href: string;
  cta: string;
  Illustration: () => JSX.Element;
  instructions: string[]; // cada línea: "Toca **X** → Y"
  tip?: string;
}

const STEPS: Step[] = [
  {
    n: 1,
    title: "Elige qué vendes",
    goal: "Tu inventario queda organizado en categorías y subcategorías, sin crear nada a mano.",
    href: "/store",
    cta: "Elegir mis categorías",
    Illustration: IllustrationChoose,
    instructions: [
      "Toca **Más → Mi tienda** (o el botón de abajo).",
      "Marca una o varias categorías: **Librería**, **Ropa**, **Bebidas**… Si no está la tuya, toca **Otro** y escríbelo en una frase.",
      "Toca **Preparar mi inventario**. Listo: ya tienes subcategorías y datos.",
    ],
    tip: "Un negocio puede tener varias categorías a la vez. Todo queda en un solo inventario.",
  },
  {
    n: 2,
    title: "Toma fotos de tus productos",
    goal: "La IA reconoce cada producto, lo describe y lo pone en su subcategoría.",
    href: "/capture",
    cta: "Agregar productos",
    Illustration: IllustrationCapture,
    instructions: [
      "Toca el botón morado **Agregar** (abajo, al centro).",
      "Toca **Cámara** y fotografía un producto. La cámara se vuelve a abrir sola: sigue con el siguiente.",
      "¿Ya tienes fotos en el celular? Toca **Galería** y elige varias a la vez.",
      "Las fotos se procesan solas en segundo plano. Puedes seguir usando la app.",
    ],
    tip: "Enfoca la etiqueta o el empaque: la IA lee marca, modelo, contenido y código.",
  },
  {
    n: 3,
    title: "Revisa y confirma",
    goal: "Corriges lo que haga falta y pones precio y stock. Un toque por producto.",
    href: "/review",
    cta: "Revisar pendientes",
    Illustration: IllustrationReview,
    instructions: [
      "Toca **② Revisar** en la barra de pasos (o **Revisar ahora** en Inicio). Verás una tarjeta por producto con la foto grande.",
      "Arriba está lo que reconoció la IA (nombre, marca, color…). Corrige solo si se equivocó.",
      "Abajo escribe **precio** y **stock** (el stock viene en 1 por defecto).",
      "Toca el botón verde fijo abajo **✓ Confirmar y pasar al siguiente**. Si te equivocas, toca **Deshacer** en el aviso verde.",
    ],
  },
  {
    n: 4,
    title: "Consulta y exporta",
    goal: "Tu inventario listo para buscar, editar y compartir en Excel.",
    href: "/products",
    cta: "Ver mi inventario",
    Illustration: IllustrationInventory,
    instructions: [
      "Toca **Inventario** (abajo). Entra a una categoría (estante) y luego a una subcategoría, o busca por nombre o marca.",
      "Toca un producto para editarlo (precio, stock, subcategoría, foto).",
      "Para el Excel: **Inventario → Excel** o **Ajustes → Exportar**. Elige todo o una categoría y toca **Descargar**.",
    ],
  },
];

/** Tareas frecuentes: "¿Qué quieres hacer?" → 3 líneas. */
const TASKS: Array<{ q: string; href: string; steps: string[] }> = [
  { q: "Agregar un producto nuevo", href: "/capture", steps: ["Toca **Agregar** (botón morado del centro).", "Toca **Cámara** y fotografía el producto.", "Toca **② Revisar** en la barra de pasos, pon precio y stock, **Confirmar**."] },
  { q: "Cambiar precio o stock", href: "/products", steps: ["Toca **Inventario**, entra a la categoría y busca el producto.", "Para stock: toca **+/− Stock** en la fila (pregunta si es venta). Para precio: abre el producto y cámbialo.", "Toca **Guardar cambios**."] },
  { q: "Corregir un nombre o subcategoría", href: "/products", steps: ["Toca **Inventario**, busca y abre el producto.", "Edita el nombre o elige otra **Subcategoría**.", "Toca **Guardar**."] },
  { q: "Agregar una subcategoría o categoría", href: "/store", steps: ["Toca **Más → Mi tienda**.", "Para una categoría nueva: **+ Agregar categoría**. Para una subcategoría: **+ Subcategoría** dentro de la categoría.", "Escribe el nombre y confirma."] },
  { q: "Sacar el inventario en Excel", href: "/export", steps: ["Toca **Más → Exportar a Excel** (o **Excel** dentro de una categoría del inventario).", "Elige **todo** o una **categoría**.", "Toca **Descargar .xlsx**. Los productos con variantes salen una fila por variante."] },
  { q: "Registrar una venta o reponer stock", href: "/products", steps: ["Toca **Inventario** y entra a la categoría del producto.", "Toca **+/− Stock** en su fila: **Sumar** si llegó mercadería, **Restar** si salió.", "Al restar, elige **Sí, es una venta** (suma a Ingresos) o **No, solo restar**."] },
  { q: "Manejar tallas o colores (variantes)", href: "/store", steps: ["Toca **Más → Mi tienda** y, en la categoría, agrega **Talla**, **Color**… en el bloque Variantes.", "Al revisar un producto de esa categoría, toca **Sí, tiene variantes** y escribe el stock en cada casilla.", "En la ficha, toca una casilla para vender o reponer esa variante."] },
  { q: "Eliminar un producto", href: "/products", steps: ["Toca **Inventario**, busca y abre el producto.", "Toca **Más opciones → Eliminar este producto**.", "Confirma. La foto también se borra."] },
  { q: "Trabajar en equipo (vendedores y PIN)", href: "/team", steps: ["Toca **Más → Equipo** y crea un **código para vendedor**; mándalo por WhatsApp. La persona se registra y abre el enlace.", "Si comparten un celular: cada uno pone su **PIN** en Equipo y, al atender, toca **«Atiende …»** en el Inicio.", "El vendedor vende, cobra y cuenta; no ve costos, ganancia ni reportes."] },
  { q: "Cargar un inventario desde Excel", href: "/import", steps: ["Toca **Más → Traer desde Excel** y elige la planilla (la primera fila deben ser los títulos).", "Revisa a qué dato va cada columna (Nombre, Precio, Stock, Categoría…).", "Mira cuántos son nuevos y cuántos ya existen, y toca **Importar**."] },
  { q: "Imprimir etiquetas con código", href: "/labels", steps: ["Toca **Más → Etiquetas para imprimir** y marca los productos.", "Si alguno no tiene código, toca **Crear códigos internos**.", "Elige **Hoja A4** o **Rollo** y toca **Imprimir**. La cámara de la app lee esas etiquetas."] },
  { q: "Guardar o descargar un respaldo", href: "/backup", steps: ["Toca **Más → Respaldos**.", "**Guardar respaldo ahora** deja una copia completa (inventario, ventas, clientes, caja) en la nube; **Descargar copia completa** la baja a tu celular.", "Cada sábado se guarda una copia automática; se conservan las últimas 8."] },
];

export function computeStates(p: GuideProgress): StepState[] {
  const done = [p.hasTypes, p.hasPhotos, p.hasConfirmed && p.pending === 0, p.hasConfirmed];
  // paso actual = primer no completado
  let currentSet = false;
  return done.map((d) => {
    if (d) return "done";
    if (!currentSet) {
      currentSet = true;
      return "current";
    }
    return "todo";
  });
}

/** Texto con **negritas** → <b> */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("**") ? (
          <b key={i} className="font-semibold text-ink">{part.slice(2, -2)}</b>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

/** Tarjeta compacta de progreso: 4 pasos con ✓ ● ○ y botón Continuar. */
export function ProgressCard({ progress }: { progress: GuideProgress }) {
  const states = computeStates(progress);
  const currentIdx = states.indexOf("current");
  const current = currentIdx >= 0 ? STEPS[currentIdx] : null;
  const doneCount = states.filter((s) => s === "done").length;

  return (
    <div className="animate-in card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-ink">Tu inventario en 4 pasos</h2>
        <span className="badge bg-brand-50 text-brand-700">{doneCount}/4</span>
      </div>
      <ol className="space-y-1.5">
        {STEPS.map((s, i) => {
          const st = states[i];
          return (
            <li key={s.n} className="flex items-center gap-3 text-sm">
              <span
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${
                  st === "done" ? "bg-emerald-500 text-white" : st === "current" ? "bg-brand-600 text-white ring-4 ring-brand-100" : "bg-slate-100 text-slate-400"
                }`}
              >
                {st === "done" ? <IconCheck size={13} /> : s.n}
              </span>
              <span className={st === "todo" ? "text-slate-400" : st === "current" ? "font-semibold text-ink" : "text-slate-600"}>{s.title}</span>
              {st === "current" && i === 2 && progress.pending > 0 && (
                <span className="badge ml-auto bg-amber-100 text-amber-800">{progress.pending} pendientes</span>
              )}
            </li>
          );
        })}
      </ol>
      {current && (
        <Link href={current.href} className="btn-primary w-full">
          {current.cta} <IconChevronRight size={16} />
        </Link>
      )}
    </div>
  );
}

/** Guía completa ilustrada: pasos expandibles + "¿Qué quieres hacer?". */
export function StepByStep({ progress, defaultOpen }: { progress: GuideProgress; defaultOpen?: number }) {
  const states = computeStates(progress);
  const [open, setOpen] = useState<number | null>(defaultOpen ?? Math.max(0, states.indexOf("current")));
  const [task, setTask] = useState<number | null>(null);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-ink">Paso a paso</h2>
        <p className="text-sm text-slate-500">Cómo armar tu inventario completo, en orden.</p>
      </div>

      <ol className="space-y-2">
        {STEPS.map((s, i) => {
          const st = states[i];
          const isOpen = open === i;
          return (
            <li key={s.n} className={`card overflow-hidden p-0 transition ${isOpen ? "ring-brand-300" : ""}`}>
              <button type="button" onClick={() => setOpen(isOpen ? null : i)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                <span
                  className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold ${
                    st === "done" ? "bg-emerald-500 text-white" : st === "current" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {st === "done" ? <IconCheck size={16} /> : s.n}
                </span>
                <span className="flex-1">
                  <span className="block font-semibold text-ink">{s.title}</span>
                  <span className="block text-xs text-slate-500">{s.goal}</span>
                </span>
                <IconChevronRight className={`shrink-0 text-slate-300 transition ${isOpen ? "rotate-90 text-brand-500" : ""}`} />
              </button>

              {isOpen && (
                <div className="animate-in grid gap-4 border-t border-slate-100 px-4 py-4 sm:grid-cols-[150px_1fr]">
                  <div className="mx-auto h-[190px] w-[150px] sm:mx-0">
                    <s.Illustration />
                  </div>
                  <div className="space-y-3">
                    <ol className="space-y-2">
                      {s.instructions.map((line, j) => (
                        <li key={j} className="flex gap-2 text-sm text-slate-600">
                          <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-500">{j + 1}</span>
                          <span><Rich text={line} /></span>
                        </li>
                      ))}
                    </ol>
                    {s.tip && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">💡 {s.tip}</p>}
                    <Link href={s.href} className={st === "current" ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>
                      {s.cta} <IconChevronRight size={14} />
                    </Link>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="card space-y-3">
        <h3 className="font-bold text-ink">¿Qué quieres hacer?</h3>
        <div className="flex flex-wrap gap-2">
          {TASKS.map((t, i) => (
            <button key={t.q} type="button" onClick={() => setTask(task === i ? null : i)} className={`chip ${task === i ? "chip-active" : ""}`}>
              {t.q}
            </button>
          ))}
        </div>
        {task !== null && (
          <div className="animate-in rounded-2xl bg-slate-50 p-3">
            <ol className="space-y-1.5">
              {TASKS[task].steps.map((line, j) => (
                <li key={j} className="flex gap-2 text-sm text-slate-600">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white text-[11px] font-bold text-slate-500 ring-1 ring-slate-200">{j + 1}</span>
                  <span><Rich text={line} /></span>
                </li>
              ))}
            </ol>
            <Link href={TASKS[task].href} className="btn-primary btn-sm mt-3">
              Ir ahora <IconChevronRight size={14} />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
