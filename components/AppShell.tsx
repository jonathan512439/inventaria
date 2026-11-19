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
import BusinessLogo from "./ui/BusinessLogo";
import {
  IconBox, IconCart, IconChart, IconCloud, IconHelp, IconHome, IconList, IconLogout, IconMore, IconRegister, IconSettings,
  IconStore, IconUsers,
} from "./ui/Icons";

type IconT = (p: { size?: number; className?: string; strokeWidth?: number }) => JSX.Element;

/**
 * Armazón de la app (C7 · RECONSTRUCCION_VISUAL.md §3.1): cinco lugares, nunca más.
 *   Celular, dueño:    Inicio · Productos · VENDER (botón central) · Clientes · Más
 *   Celular, vendedor: Inicio · Productos · VENDER · Clientes · Caja  (lo demás, con «Más» en la cabecera)
 *   Escritorio: barra lateral con las mismas áreas y «Más» desplegado
 * Cabecera: nombre del negocio, estado de conexión y «¿quién atiende?».
 * Cada sección vive dentro de su área (Agregar, Entrada de inventario y Contar en Productos; Caja en Vender;
 * Mercadería entregada en Clientes): «Más» solo lleva Números, Ajustes, Ayuda y Cerrar sesión (8 entradas).
 */

type Area = { key: string; href: string; label: string; Icon: IconT; match: string[] };
const AREAS: Area[] = [
  { key: "inicio", href: "/dashboard", label: "Inicio", Icon: IconHome, match: ["/dashboard", "/onboarding"] },
  { key: "productos", href: "/products", label: "Productos", Icon: IconBox, match: ["/products", "/add", "/stock"] },
  { key: "vender", href: "/sell", label: "Vender", Icon: IconCart, match: ["/sell"] },
  { key: "clientes", href: "/customers", label: "Clientes", Icon: IconUsers, match: ["/customers"] },
];
/** 5.º lugar del vendedor (en vez de «Más») */
const CAJA: Area = { key: "caja", href: "/sell/cash", label: "Caja", Icon: IconRegister, match: ["/sell/cash"] };

interface Item {
  href: string;
  label: string;
  hint: string;
  Icon: IconT;
  ownerOnly?: boolean;
}
const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Números",
    items: [
      { href: "/insights", label: "Números", hint: "Hoy, ventas, productos y preguntas", Icon: IconChart },
      { href: "/insights/history", label: "Historial", hint: "Ventas, entradas y retiros con quién los hizo", Icon: IconList },
    ],
  },
  {
    title: "Ajustes",
    items: [
      { href: "/settings", label: "Ajustes", hint: "Negocio, avisos, IA y tu cuenta", Icon: IconSettings },
      { href: "/settings/catalog", label: "Mi catálogo", hint: "Categorías, datos y variantes", Icon: IconStore, ownerOnly: true },
      { href: "/settings/team", label: "Equipo", hint: "Personas, invitaciones y PIN", Icon: IconUsers },
      { href: "/settings/data", label: "Mis datos", hint: "Excel, respaldos, ordenar y papelera", Icon: IconCloud, ownerOnly: true },
    ],
  },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const flow = useFlow();
  const [more, setMore] = useState(false);
  const [tour, setTour] = useState(false);
  useEffect(() => setMore(false), [pathname]);

  // El vendedor tiene «Caja» como 5.º lugar; el dueño, «Más»
  const areas = flow.isOwner ? AREAS : [...AREAS, CAJA];
  // Gana la coincidencia más larga (/sell/cash es Caja para el vendedor, no Vender)
  const hit = (m: string) => pathname === m || pathname.startsWith(m + "/");
  const active =
    areas
      .flatMap((a) => a.match.filter(hit).map((m) => ({ key: a.key, len: m.length })))
      .sort((x, y) => y.len - x.len)[0]?.key ?? "mas";
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
        <Link href={flow.isOwner ? "/settings" : "/dashboard"} className="flex h-20 shrink-0 items-center gap-3 px-4" aria-label="Tu negocio">
          <BusinessLogo name={flow.business?.name} url={flow.business?.logo_url} size={44} />
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-base font-bold text-ink">{flow.business?.name ?? ""}</span>
            <span className="block text-xs font-semibold text-muted">{flow.ready ? (flow.isOwner ? "Dueño" : "Vendedor") : ""} · InventarIA</span>
          </span>
        </Link>
        <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4" aria-label="Principal">
          <ul className="grid gap-1">
            {areas.map(({ key, href, label, Icon }) =>
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
          <Link href={flow.isOwner ? "/settings" : "/dashboard"} className="flex min-w-0 flex-1 items-center gap-2.5 md:pointer-events-none" aria-label="Tu negocio">
            <BusinessLogo name={flow.business?.name} url={flow.business?.logo_url} size={36} className="md:hidden" />
            <span className="min-w-0 flex-1 leading-tight md:hidden">
              <span className="block truncate text-base font-bold text-ink">{flow.business?.name ?? ""}</span>
              {flow.ready && <span className="block text-xs font-semibold text-muted">{flow.isOwner ? "Dueño" : "Vendedor"}</span>}
            </span>
          </Link>
          <ConnectionChip />
          <WhoIsServing />
          {!flow.isOwner && (
            <button type="button" onClick={() => setMore(true)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-600 hover:bg-slate-100 md:hidden" aria-label="Más: Números, Ajustes, Ayuda">
              <IconMore size={22} />
            </button>
          )}
        </div>
      </header>

      {/* Contenido */}
      <div className="min-h-screen overflow-x-hidden pb-28 md:pb-10 md:pl-64">
        <main className="mx-auto w-full px-4 py-4 md:px-6 md:py-6 xl:px-10 2xl:px-14">{children}</main>
      </div>

      {/* Celular: barra inferior de 5 lugares */}
      <nav aria-label="Principal" className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/70 bg-white md:hidden">
        <div className="grid grid-cols-5 items-end">
          {areas.map(({ key, href, label, Icon }) =>
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
          {flow.isOwner && (
            <button type="button" onClick={() => setMore(true)} className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-xs font-semibold ${active === "mas" || more ? "text-brand-700" : "text-muted"}`}>
              <IconMore size={24} />
              Más
            </button>
          )}
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
