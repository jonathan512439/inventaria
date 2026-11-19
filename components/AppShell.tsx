"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { clearDeviceData } from "@/lib/offline";
import { useFlow } from "./FlowProvider";
import WhoIsServing from "./WhoIsServing";
import WhatsNew from "./WhatsNew";
import ConnectionChip from "./OfflineBar";
import GestionarSheet, { GESTIONAR_ROUTES, gestionarItems, lastGestionar } from "./Gestionar";
import Sheet from "./ui/Sheet";
import BusinessLogo from "./ui/BusinessLogo";
import { useToast } from "./ui/Toast";
import { IconBox, IconChart, IconCloud, IconGrid, IconHelp, IconHome, IconList, IconLogout, IconMore, IconSettings, IconStore, IconUsers } from "./ui/Icons";

type IconT = (p: { size?: number; className?: string; strokeWidth?: number }) => JSX.Element;

/**
 * Armazón de la app (C7 · R10, RECONSTRUCCION_VISUAL.md §8): cinco lugares, iguales para dueño y vendedor.
 *   Celular:    Inicio · Productos · GESTIONAR (botón central) · Clientes · Más
 *               (modo «Solo inventario»: Inicio · Productos · GESTIONAR · Historial · Más)
 *   Escritorio: barra lateral con «Gestionar» destacado arriba, las áreas y «Más» desplegado.
 * «Gestionar» abre la hoja con Vender, Entrada de inventario, Producto nuevo, Contar… (components/Gestionar.tsx);
 * mantenerlo apretado va directo a la última usada.
 * Cabecera: logo, nombre del negocio y rol, estado de conexión y «¿quién atiende?».
 * En modo «Solo inventario», Vender, Caja y Clientes no se muestran (la dirección lleva a Inicio con un aviso).
 */

type Area = { key: string; href: string; label: string; Icon: IconT; match: string[] };
const INICIO: Area = { key: "inicio", href: "/dashboard", label: "Inicio", Icon: IconHome, match: ["/dashboard", "/onboarding"] };
const PRODUCTOS: Area = { key: "productos", href: "/products", label: "Productos", Icon: IconBox, match: ["/products"] };
const CLIENTES: Area = { key: "clientes", href: "/customers", label: "Clientes", Icon: IconUsers, match: ["/customers"] };
const HISTORIAL: Area = { key: "historial", href: "/insights/history", label: "Historial", Icon: IconList, match: ["/insights/history"] };
/** Rutas de ventas que no existen en el modo «Solo inventario» */
const SALES_ROUTES = ["/sell", "/customers"];

interface Item {
  href: string;
  label: string;
  hint: string;
  Icon: IconT;
  ownerOnly?: boolean;
  /** No se muestra en el modo «Solo inventario» (ya está en la barra o es de ventas) */
  salesOnly?: boolean;
}
const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Números",
    items: [
      { href: "/insights", label: "Números", hint: "Hoy, ventas, productos y preguntas", Icon: IconChart },
      { href: "/insights/history", label: "Historial", hint: "Ventas, entradas y salidas con quién las hizo", Icon: IconList, salesOnly: true },
    ],
  },
  {
    title: "Ajustes",
    items: [
      { href: "/settings", label: "Ajustes", hint: "Negocio, modo de uso, avisos, IA y tu cuenta", Icon: IconSettings },
      { href: "/settings/catalog", label: "Mi catálogo", hint: "Categorías, datos y variantes", Icon: IconStore, ownerOnly: true },
      { href: "/settings/team", label: "Equipo", hint: "Personas, invitaciones y PIN", Icon: IconUsers },
      { href: "/settings/data", label: "Mis datos", hint: "Excel, respaldos, ordenar y papelera", Icon: IconCloud, ownerOnly: true },
    ],
  },
];
const LONG_PRESS_MS = 550;

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const flow = useFlow();
  const [more, setMore] = useState(false);
  const [manage, setManage] = useState(false);
  const [tour, setTour] = useState(false);
  const press = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean }>({ timer: null, fired: false });
  useEffect(() => {
    setMore(false);
    setManage(false);
  }, [pathname]);

  const hit = (m: string) => pathname === m || pathname.startsWith(m + "/");
  // Modo «Solo inventario»: las pantallas de ventas no existen (la base no cambia permisos: es solo la vista)
  useEffect(() => {
    if (flow.ready && flow.inventoryOnly && SALES_ROUTES.some(hit)) {
      toast("info", "Tu negocio usa el modo «Solo inventario». Para vender, actívalo en Ajustes › Modo de uso.");
      router.replace("/dashboard");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.ready, flow.inventoryOnly, pathname]);

  const fourth = flow.inventoryOnly ? HISTORIAL : CLIENTES;
  const sideAreas = [INICIO, PRODUCTOS, fourth];
  const manageItems = gestionarItems(flow);
  const active =
    [...sideAreas, { key: "gestionar", match: [...GESTIONAR_ROUTES] }]
      .flatMap((a) => a.match.filter(hit).map((m) => ({ key: a.key, len: m.length })))
      .sort((x, y) => y.len - x.len)[0]?.key ?? "mas";
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => (flow.isOwner || !i.ownerOnly) && !(flow.inventoryOnly && i.salesOnly)) })).filter((g) => g.items.length);
  const badgeOf = (key: string) => (key === "productos" ? flow.pending : 0);

  // «Gestionar»: tocar abre la hoja; mantener apretado va a la última usada
  function pressStart() {
    press.current.fired = false;
    press.current.timer = setTimeout(() => {
      const last = manageItems.find((i) => i.key === lastGestionar());
      if (!last) return;
      press.current.fired = true;
      navigator.vibrate?.(20);
      router.push(last.href);
    }, LONG_PRESS_MS);
  }
  function pressEnd() {
    if (press.current.timer) clearTimeout(press.current.timer);
    press.current.timer = null;
  }
  function pressClick() {
    if (press.current.fired) return;
    setManage(true);
  }

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

  const gradient = { backgroundImage: "linear-gradient(135deg,#6366f1,#8b5cf6)" };

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
          <button type="button" onClick={() => setManage(true)} className={`btn-primary mb-2 w-full justify-start ${active === "gestionar" ? "ring-4 ring-brand-200" : ""}`} style={gradient}>
            <IconGrid size={20} /> Gestionar
          </button>
          <ul className="grid gap-1">
            {sideAreas.map(({ key, href, label, Icon }) => (
              <li key={key}>
                <Link href={href} className={`flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm font-semibold transition ${active === key ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100"}`}>
                  <Icon size={20} /> {label}
                  {badgeOf(key) > 0 && <Badge n={badgeOf(key)} />}
                </Link>
              </li>
            ))}
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
        </div>
      </header>

      {/* Contenido */}
      <div className="min-h-screen overflow-x-hidden pb-28 md:pb-10 md:pl-64">
        <main className="mx-auto w-full px-4 py-4 md:px-6 md:py-6 xl:px-10 2xl:px-14">{children}</main>
      </div>

      {/* Celular: barra inferior de 5 lugares */}
      <nav aria-label="Principal" className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/70 bg-white md:hidden">
        <div className="grid grid-cols-5 items-end">
          {[INICIO, PRODUCTOS].map((a) => <BarLink key={a.key} a={a} active={active === a.key} badge={badgeOf(a.key)} working={a.key === "productos" ? flow.working : 0} />)}
          <button
            type="button"
            onClick={pressClick}
            onPointerDown={pressStart}
            onPointerUp={pressEnd}
            onPointerLeave={pressEnd}
            onContextMenu={(e) => e.preventDefault()}
            className="relative -mt-6 flex select-none flex-col items-center pb-1.5"
            aria-label="Gestionar: vender, entrada de inventario, producto nuevo, contar"
          >
            <span className={`grid h-16 w-16 place-items-center rounded-full text-white shadow-float transition active:scale-95 ${active === "gestionar" || manage ? "ring-4 ring-brand-200" : ""}`} style={gradient}>
              <IconGrid size={28} />
            </span>
            <span className="mt-0.5 text-xs font-bold text-brand-700">Gestionar</span>
          </button>
          <BarLink a={fourth} active={active === fourth.key} badge={0} working={0} />
          <button type="button" onClick={() => setMore(true)} className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-xs font-semibold ${active === "mas" || more ? "text-brand-700" : "text-muted"}`}>
            <IconMore size={24} />
            Más
          </button>
        </div>
      </nav>

      <GestionarSheet open={manage} onClose={() => setManage(false)} items={manageItems} />
      <Sheet open={more} onClose={() => setMore(false)} title="Más">
        {moreList}
      </Sheet>
      {tour && <WhatsNew force onClose={() => setTour(false)} />}
    </>
  );
}

function BarLink({ a, active, badge, working }: { a: Area; active: boolean; badge: number; working: number }) {
  const { href, label, Icon } = a;
  return (
    <Link href={href} className={`relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-xs font-semibold ${active ? "text-brand-700" : "text-muted"}`}>
      <Icon size={24} strokeWidth={active ? 2.4 : 2} />
      {label}
      {badge > 0 && <Badge n={badge} className="absolute right-3 top-1" />}
      {working > 0 && <Badge n={working} pulse className="absolute left-3 top-1" />}
    </Link>
  );
}

function Badge({ n, pulse, className = "" }: { n: number; pulse?: boolean; className?: string }) {
  return (
    <span className={`grid h-5 min-w-[20px] place-items-center rounded-full px-1 text-xs font-bold text-white ${pulse ? "animate-pulse bg-warn-500" : "bg-danger-500"} ${className || "ml-auto"}`}>
      {n > 99 ? "99+" : n}
    </span>
  );
}
