"use client";

import Link from "next/link";
import type { FlowState } from "./FlowProvider";
import Sheet from "./ui/Sheet";
import { IconArrowRight, IconCamera, IconCart, IconCheckCircle, IconClipboard, IconRegister, IconTruck } from "./ui/Icons";

type IconT = (p: { size?: number; className?: string }) => JSX.Element;
export interface GestionarItem {
  key: string;
  href: string;
  title: string;
  body: string;
  Icon: IconT;
  tone: string;
}

const LAST_KEY = "inventaria.gestionar.last";
/** Rutas que pertenecen a «Gestionar» (para marcarlo activo en la barra) */
export const GESTIONAR_ROUTES = ["/sell", "/stock/in", "/stock/out", "/stock/count", "/add"];

/**
 * Fichas de «Gestionar» (R10 · RECONSTRUCCION_VISUAL.md §8.1) según el modo de uso y el rol:
 *   Inventario y ventas: Vender · Entrada de inventario · Producto nuevo · Contar (+ Revisar, + Caja del vendedor)
 *   Solo inventario:     Entrada de inventario · Producto nuevo · Sacar del stock · Contar (+ Revisar)
 */
export function gestionarItems(flow: Pick<FlowState, "inventoryOnly" | "isOwner" | "pending">): GestionarItem[] {
  const vender: GestionarItem = { key: "vender", href: "/sell", title: "Vender", body: "Cobrar, dar vuelto o fiar", Icon: IconCart, tone: "bg-brand-600 text-white" };
  const entrada: GestionarItem = { key: "entrada", href: "/stock/in", title: "Entrada de inventario", body: "Sumar lo que llegó: escanea o elige de la lista", Icon: IconTruck, tone: "bg-ok-600 text-white" };
  const nuevo: GestionarItem = { key: "nuevo", href: "/add", title: "Producto nuevo", body: "Con foto (la IA lo llena), código, Excel o a mano", Icon: IconCamera, tone: "bg-violet-600 text-white" };
  const salida: GestionarItem = { key: "salida", href: "/stock/out", title: "Sacar del stock", body: "Vendido, uso interno, merma, vencido o devolución", Icon: IconArrowRight, tone: "bg-warn-500 text-white" };
  const contar: GestionarItem = { key: "contar", href: "/stock/count", title: "Contar", body: "Revisar un estante y corregir diferencias", Icon: IconClipboard, tone: "bg-slate-700 text-white" };
  const items = flow.inventoryOnly ? [entrada, nuevo, salida, contar] : [vender, entrada, nuevo, contar];
  if (flow.pending > 0) items.push({ key: "revisar", href: "/add/review", title: `Revisar (${flow.pending})`, body: "Productos pendientes de confirmar", Icon: IconCheckCircle, tone: "bg-info-600 text-white" });
  if (!flow.inventoryOnly && !flow.isOwner) items.push({ key: "caja", href: "/sell/cash", title: "Caja", body: "Lo cobrado hoy y el cierre", Icon: IconRegister, tone: "bg-slate-500 text-white" });
  return items;
}

export function lastGestionar(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}
function remember(key: string) {
  try {
    localStorage.setItem(LAST_KEY, key);
  } catch {
    /* sin almacenamiento */
  }
}

/** Hoja con las fichas grandes. La última usada queda marcada («La última vez»). */
export default function GestionarSheet({ open, onClose, items }: { open: boolean; onClose: () => void; items: GestionarItem[] }) {
  const last = lastGestionar();
  return (
    <Sheet open={open} onClose={onClose} title="Gestionar">
      <ul className="grid gap-2 sm:grid-cols-2">
        {items.map(({ key, href, title, body, Icon, tone }) => (
          <li key={key}>
            <Link
              href={href}
              onClick={() => {
                remember(key);
                onClose();
              }}
              className={`flex min-h-[72px] items-center gap-3 rounded-2xl border-2 p-3 transition active:scale-[0.99] ${last === key ? "border-brand-400 bg-brand-50" : "border-slate-200 bg-white hover:border-brand-300"}`}
            >
              <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${tone}`}><Icon size={24} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-bold text-ink">{title}</span>
                <span className="block text-xs text-muted">{body}</span>
              </span>
              {last === key && <span className="shrink-0 rounded-full bg-brand-600 px-2 py-0.5 text-xs font-bold text-white">La última</span>}
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-center text-xs text-muted">Consejo: mantén apretado el botón Gestionar para ir directo a la última.</p>
    </Sheet>
  );
}
