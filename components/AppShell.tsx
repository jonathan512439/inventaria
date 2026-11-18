"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { clearDeviceData } from "@/lib/offline";
import { useFlow } from "./FlowProvider";
import WhoIsServing from "./WhoIsServing";
import WhatsNew from "./WhatsNew";
import ConnectionChip from "./OfflineBar";
import Sheet from "./ui/Sheet";
import { LogoMark, LogoWordmark } from "./ui/Logo";
import {
  IconBell, IconBox, IconCamera, IconCart, IconChart, IconCheckCircle, IconClipboard, IconCloud, IconDownload, IconHelp, IconHome,
  IconList, IconLogout, IconMore, IconPrinter, IconRegister, IconScan, IconSettings, IconSparkles, IconStore, IconTable,
  IconTrash, IconTruck, IconUsers,
} from "./ui/Icons";

type IconT = (p: { size?: number; className?: string; strokeWidth?: number }) => JSX.Element;

/**
 * Armazón de la app (C7.1 · RECONSTRUCCION_VISUAL.md §3.1): cinco lugares, nunca más.
 *   Celular: Inicio · Productos · VENDER (botón central) · Clientes · Más
 *   Escritorio: barra lateral con las mismas áreas y sus secciones
 * Cabecera: nombre del negocio, estado de conexión y «¿quién atiende?».
 * Transitorio hasta C7.3–C7.5: «Más» también lleva a Agregar, Contar, Compras… (luego viven dentro de Productos).
 */

const AREAS: { key: string; href: string; label: string; Icon: IconT; match: string[] }[] = [
  { key: "inicio", href: "/dashboard", label: "Inicio", Icon: IconHome, match: ["/dashboard", "/onboarding"] },
  { key: "productos", href: "/products", label: "Productos", Icon: IconBox, match: ["/products", "/review", "/drafts", "/capture", "/scan", "/count", "/purchases", "/import", "/export"] },
  { key: "vender", href: "/sell", label: "Vender", Icon: IconCart, match: ["/sell"] },
  { key: "clientes", href: "/customers", label: "Clientes", Icon: IconUsers, match: ["/customers", "/consign"] },
];

interface Item {
  href: string;
  label: string;
  hint: string;
  Icon: IconT;
  ownerOnly?: boolean;
}
/** Secciones agrupadas por tarea (iconos propios, nombres cortos). */
const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Productos",
    items: [
      { href: "/capture", label: "Agregar productos", hint: "Con foto, código, a mano o Excel", Icon: IconCamera },
      { href: "/review", label: "Revisar pendientes", hint: "Confirma lo que reconoció la IA", Icon: IconCheckCircle },
      { href: "/scan", label: "Escanear un código", hint: "Buscar, sumar stock o dar de alta", Icon: IconScan },
      { href: "/purchases", label: "Llegó mercadería", hint: "Anota una compra y su costo", Icon: IconTruck, ownerOnly: true },
      { href: "/count", label: "Contar", hint: "Revisa un estante y corrige", Icon: IconClipboard },
      { href: "/products?filter=restock", label: "Qué falta", hint: "Lista de pedido para WhatsApp", Icon: IconBell },
      { href: "/products?select=1", label: "Precios y etiquetas", hint: "Elige productos y cámbialos o imprímelos", Icon: IconPrinter },
    ],
  },
  {
    title: "Vender y cobrar",
    items: [
      { href: "/sell/cash", label: "Caja de hoy", hint: "Cuánto entró y cerrar el día", Icon: IconRegister },
      { href: "/consign", label: "Mercadería entregada", hint: "Revendedores y rendir cuentas", Icon: IconTruck },
    ],
  },
  {
    title: "Números",
    items: [
      { href: "/reports", label: "Cómo va el negocio", hint: "Qué se vende y cuánto ganas", Icon: IconChart, ownerOnly: true },
      { href: "/movements", label: "Historial", hint: "Ventas, entradas y retiros", Icon: IconList },
      { href: "/digest", label: "Resumen de hoy", hint: "Listo para WhatsApp", Icon: IconCheckCircle },
      { href: "/ask", label: "Pregúntale", hint: "Preguntas sobre tus datos", Icon: IconSparkles },
    ],
  },
  {
    title: "Ajustes",
    items: [
      { href: "/settings", label: "Ajustes", hint: "Tu negocio y tu cuenta", Icon: IconSettings },
      { href: "/store", label: "Mi catálogo", hint: "Categorías, datos y variantes", Icon: IconStore, ownerOnly: true },
      { href: "/alerts", label: "Avisos", hint: "Cuándo avisar que falta", Icon: IconBell, ownerOnly: true },
      { href: "/team", label: "Equipo", hint: "Personas, invitaciones y PIN", Icon: IconUsers },
      { href: "/export", label: "Descargar Excel", hint: "Tu inventario en planilla", Icon: IconDownload, ownerOnly: true },
      { href: "/import", label: "Traer desde Excel", hint: "Cargar una planilla", Icon: IconTable, ownerOnly: true },
      { href: "/backup", label: "Respaldos", hint: "Copia semanal completa", Icon: IconCloud, ownerOnly: true },
      { href: "/dashboard#limpiar", label: "Ordenar y limpiar", hint: "Quita lo que sobra", Icon: IconTrash, ownerOnly: true },
    ],
  },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const flow = useFlow();
  const [more, setMore] = useState(false);
  const [tour, setTour] = useState(false);
  useEffect(() => setMore(false), [pathname]);

  const inArea = (match: string[]) => match.some((m) => pathname === m || pathname.startsWith(m + "/"));
  const active = AREAS.find((a) => inArea(a.match))?.key ?? "mas";
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => flow.isOwner || !i.ownerOnly) })).filter((g) => g.items.length);
  const badgeOf = (key: string) => (key === "productos" ? flow.pending : 0);

  async function signOut() {
    await clearDeviceData();
    await createClient().auth.signOut();
    window.location.href = "/login";
  }

  const moreList = (
    <div className="space-y-4">
      {groups.map((g) => (
        <section key={g.title}>
          <p className="px-3 pb-1 text-xs font-bold uppercase tracking-wide text-muted">{g.title}</p>
          <ul className="grid gap-0.5">
            {g.items.map(({ href, label, hint, Icon }) => (
              <li key={href}>
                <Link href={href} className={`flex min-h-[52px] items-center gap-3 rounded-2xl px-3 py-2 transition hover:bg-brand-50 active:bg-brand-100 ${pathname === href ? "bg-brand-50" : ""}`}>
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600"><Icon size={20} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-semibold leading-tight text-ink">{label}</span>
                    <span className="block truncate text-xs text-muted">{hint}</span>
                  </span>
                  {href === "/review" && flow.pending > 0 && <Badge n={flow.pending} />}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section>
        <p className="px-3 pb-1 text-xs font-bold uppercase tracking-wide text-muted">Ayuda</p>
        <button type="button" onClick={() => { setMore(false); setTour(true); }} className="flex min-h-[52px] w-full items-center gap-3 rounded-2xl px-3 py-2 text-left hover:bg-brand-50">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700"><IconHelp size={20} /></span>
          <span className="text-base font-semibold text-ink">Cómo usar la app</span>
        </button>
        <button type="button" onClick={signOut} className="flex min-h-[52px] w-full items-center gap-3 rounded-2xl px-3 py-2 text-left text-danger-700 hover:bg-danger-50">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-danger-50"><IconLogout size={20} /></span>
          <span className="text-base font-semibold">Cerrar sesión</span>
        </button>
      </section>
    </div>
  );

  return (
    <>
      {/* Escritorio: barra lateral */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200/70 bg-white md:flex">
        <Link href="/dashboard" className="flex h-16 shrink-0 items-center px-5"><LogoWordmark /></Link>
        <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4" aria-label="Principal">
          <ul className="grid gap-1">
            {AREAS.map(({ key, href, label, Icon }) =>
              key === "vender" ? (
                <li key={key}>
                  <Link href={href} className={`btn-primary my-1 w-full justify-start ${active === key ? "ring-4 ring-brand-200" : ""}`} style={{ backgroundImage: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}>
                    <Icon size={20} /> {label}
                  </Link>
                </li>
              ) : (
                <li key={key}>
                  <Link href={href} className={`flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm font-semibold transition ${active === key ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100"}`}>
                    <Icon size={20} /> {label}
                    {badgeOf(key) > 0 && <Badge n={badgeOf(key)} />}
                  </Link>
                </li>
              )
            )}
          </ul>
          <div className="mt-4 border-t border-slate-100 pt-3">{moreList}</div>
        </nav>
      </aside>

      {/* Cabecera (celular y escritorio) */}
      <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/90 backdrop-blur-md md:pl-64">
        <div className="flex h-14 items-center gap-2 px-4 md:px-6 xl:px-10">
          <Link href="/dashboard" className="flex min-w-0 items-center gap-2 md:hidden" aria-label="Inicio">
            <LogoMark size={30} />
          </Link>
          <span className="min-w-0 flex-1 truncate text-base font-bold text-ink">{flow.business?.name ?? ""}</span>
          <ConnectionChip />
          <WhoIsServing />
        </div>
      </header>

      {/* Contenido */}
      <div className="min-h-screen overflow-x-hidden pb-28 md:pb-10 md:pl-64">
        <main className="mx-auto w-full px-4 py-4 md:px-6 md:py-6 xl:px-10 2xl:px-14">{children}</main>
      </div>

      {/* Celular: barra inferior de 5 lugares */}
      <nav aria-label="Principal" className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/70 bg-white md:hidden">
        <div className="grid grid-cols-5 items-end">
          {AREAS.map(({ key, href, label, Icon }) =>
            key === "vender" ? (
              <Link key={key} href={href} className="relative -mt-6 flex flex-col items-center pb-1.5" aria-label="Vender">
                <span className={`grid h-16 w-16 place-items-center rounded-full text-white shadow-float transition active:scale-95 ${active === key ? "ring-4 ring-brand-200" : ""}`} style={{ backgroundImage: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}>
                  <Icon size={28} />
                </span>
                <span className="mt-0.5 text-xs font-bold text-brand-700">{label}</span>
              </Link>
            ) : (
              <Link key={key} href={href} className={`relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-xs font-semibold ${active === key ? "text-brand-700" : "text-muted"}`}>
                <Icon size={24} strokeWidth={active === key ? 2.4 : 2} />
                {label}
                {badgeOf(key) > 0 && <Badge n={badgeOf(key)} className="absolute right-3 top-1" />}
                {key === "productos" && flow.working > 0 && <Badge n={flow.working} pulse className="absolute left-3 top-1" />}
              </Link>
            )
          )}
          <button type="button" onClick={() => setMore(true)} className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-xs font-semibold ${active === "mas" || more ? "text-brand-700" : "text-muted"}`}>
            <IconMore size={24} />
            Más
          </button>
        </div>
      </nav>

      <Sheet open={more} onClose={() => setMore(false)} title="Más">
        {moreList}
      </Sheet>
      {tour && <WhatsNew force onClose={() => setTour(false)} />}
    </>
  );
}

function Badge({ n, pulse, className = "" }: { n: number; pulse?: boolean; className?: string }) {
  return (
    <span className={`grid h-5 min-w-[20px] place-items-center rounded-full px-1 text-xs font-bold text-white ${pulse ? "animate-pulse bg-warn-500" : "bg-danger-500"} ${className || "ml-auto"}`}>
      {n > 99 ? "99+" : n}
    </span>
  );
}
