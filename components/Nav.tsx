"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { enqueue } from "@/lib/queue";
import { resizeImage } from "@/lib/image";
import { useFlow } from "./FlowProvider";
import WhatsNew from "./WhatsNew";
import { IconAlert, IconBox, IconCamera, IconCheckCircle, IconDownload, IconFolder, IconHome, IconImages, IconList, IconSettings, IconSparkles, IconTag, IconTrash, IconX } from "./ui/Icons";
import { LogoWordmark } from "./ui/Logo";

/** Barra inferior: Inicio · Revisar · Agregar (centro) · Inventario · Más ▾ */
const MAIN = [
  { href: "/dashboard", label: "Inicio", Icon: IconHome },
  { href: "/review", label: "Revisar", Icon: IconCheckCircle },
  { href: "/capture", label: "Agregar", Icon: IconCamera, primary: true },
  { href: "/products", label: "Inventario", Icon: IconBox },
] as const;

interface MoreItem {
  href: string;
  label: string;
  hint: string;
  Icon: (p: { size?: number; className?: string }) => JSX.Element;
}

/** Lo secundario vive en «Más», agrupado y explicado sin tecnicismos. */
const MORE_GROUPS: { title: string; items: MoreItem[] }[] = [
  {
    title: "Del día a día",
    items: [
      { href: "/sell", label: "Vender", hint: "Cobra varios productos a la vez y envía el ticket", Icon: IconTag },
      { href: "/cash", label: "Caja de hoy", hint: "Cuánto entró, cuánto salió y cerrar el día", Icon: IconList },
      { href: "/customers", label: "Clientes", hint: "Quién te compra, quién te debe y cobrar fiados", Icon: IconHome },
      { href: "/consign", label: "Mercadería entregada", hint: "Lo que dejaste con revendedores y rendir cuentas", Icon: IconBox },
      { href: "/scan", label: "Escanear un código", hint: "Apunta al código de barras para sumar stock o dar de alta", Icon: IconTag },
      { href: "/movements", label: "Ventas y movimientos", hint: "Cuánto vendiste, tu ganancia y qué entró o salió", Icon: IconList },
      { href: "/restock", label: "Qué falta y qué caduca", hint: "Lo que se está acabando y lo que vence pronto", Icon: IconAlert },
    ],
  },
  {
    title: "Cómo va el negocio",
    items: [
      { href: "/reports", label: "Cómo va el negocio", hint: "Qué se vende, qué no, cuánto ganas y cuánto vale lo que tienes", Icon: IconList },
      { href: "/digest", label: "Resumen de hoy", hint: "Lo importante del día, listo para mandar por WhatsApp", Icon: IconCheckCircle },
      { href: "/ask", label: "Pregúntale a tu inventario", hint: "«¿Cuánto vendí esta semana?» y te responde con tus datos", Icon: IconSparkles },
    ],
  },
  {
    title: "Ordenar el inventario",
    items: [
      { href: "/purchases", label: "Anotar una compra", hint: "Llegó mercadería: cuánta y a qué precio la compraste", Icon: IconBox },
      { href: "/count", label: "Contar lo que tengo", hint: "Revisa el estante y corrige lo que no coincide", Icon: IconCheckCircle },
      { href: "/prices", label: "Cambiar precios", hint: "Sube o baja el precio de muchos productos a la vez", Icon: IconTag },
      { href: "/export", label: "Descargar en Excel", hint: "Tu inventario en una planilla para ver o compartir", Icon: IconDownload },
    ],
  },
  {
    title: "Configurar",
    items: [
      { href: "/store", label: "Mi tienda", hint: "Qué vendes y cómo se ordena tu inventario", Icon: IconFolder },
      { href: "/alerts", label: "Cuándo avisarme", hint: "Desde cuántas unidades quieres que te avise", Icon: IconAlert },
      { href: "/settings", label: "Ajustes", hint: "Nombre del negocio, tu cuenta y ayuda", Icon: IconSettings },
    ],
  },
  {
    title: "Ayuda",
    items: [
      { href: "/dashboard#guia", label: "Guía paso a paso", hint: "Cómo armar tu inventario desde cero", Icon: IconSparkles },
      { href: "/dashboard#limpiar", label: "Ordenar y limpiar", hint: "Quita lo que sobra y libera espacio", Icon: IconTrash },
    ],
  },
];
const MORE: MoreItem[] = MORE_GROUPS.flatMap((g) => g.items);

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const flow = useFlow();
  const [quick, setQuick] = useState(false); // menú rápido (mantener pulsado el botón de cámara)
  const [more, setMore] = useState(false);
  const [tour, setTour] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);

  // El panel «Más» se cierra al navegar
  useEffect(() => {
    setMore(false);
  }, [pathname]);

  async function quickPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    setQuick(false);
    if (!files.length) return;
    navigator.vibrate?.(12);
    const blobs: Blob[] = [];
    for (const f of files) {
      try {
        blobs.push(await resizeImage(f));
      } catch {
        /* archivo ilegible: se omite */
      }
    }
    if (blobs.length) enqueue(blobs, null);
    router.push("/capture");
  }
  const startPress = () => {
    longPressed.current = false;
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      navigator.vibrate?.(15);
      setQuick(true);
    }, 450);
  };
  const endPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
  };

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const moreActive = MORE.some((m) => !m.href.startsWith("/dashboard") && isActive(m.href));

  return (
    <>
      {/* Escritorio: barra superior */}
      <header className="sticky top-0 z-30 hidden border-b border-slate-200/70 bg-white/80 backdrop-blur-md md:block">
        <div className="mx-auto flex h-16 items-center justify-between px-6 xl:px-10 2xl:px-14">
          <Link href="/dashboard"><LogoWordmark /></Link>
          <nav className="flex items-center gap-1">
            <TopLink href="/dashboard" active={isActive("/dashboard")} Icon={IconHome} label="Inicio" />
            <Link href="/capture" className={`btn-primary mx-1 px-4 py-2 ${isActive("/capture") ? "ring-4 ring-brand-200" : ""}`}>
              <IconCamera size={18} /> Agregar {flow.working > 0 && <Badge n={flow.working} pulse />}
            </Link>
            <TopLink href="/review" active={isActive("/review")} Icon={IconCheckCircle} label="Revisar" badge={flow.pending} />
            <TopLink href="/products" active={isActive("/products") || isActive("/movements")} Icon={IconBox} label="Inventario" />
            <div className="relative">
              <button onClick={() => setMore((v) => !v)} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition ${more || moreActive ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100"}`}>
                <IconList size={18} /> Más ▾
              </button>
              {more && (
                <div className="animate-in absolute right-0 top-12 max-h-[75vh] w-[22rem] overflow-y-auto overscroll-contain rounded-2xl bg-white p-2 shadow-2xl ring-1 ring-slate-900/10">
                  <MoreList onTour={() => { setMore(false); setTour(true); }} />
                </div>
              )}
            </div>
          </nav>
        </div>
      </header>

      {/* Entradas ocultas del menú rápido */}
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={quickPick} />
      <input ref={galRef} type="file" accept="image/*" multiple className="hidden" onChange={quickPick} />

      {/* Menú rápido (mantener pulsado el botón de cámara) */}
      {quick && (
        <div className="fixed inset-0 z-40" onClick={() => setQuick(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="animate-in absolute inset-x-0 bottom-24 flex justify-center gap-3 px-6" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => camRef.current?.click()} className="btn-primary flex-1 flex-col gap-1 py-4"><IconCamera size={26} /> Cámara</button>
            <button type="button" onClick={() => galRef.current?.click()} className="btn flex-1 flex-col gap-1 bg-white py-4 text-ink shadow-float"><IconImages size={26} className="text-brand-600" /> Galería</button>
          </div>
          <p className="absolute inset-x-0 bottom-[4.5rem] text-center text-xs font-medium text-white/90">Acceso rápido · toca fuera para cerrar</p>
        </div>
      )}

      {/* Móvil: panel «Más» (hoja inferior con su propio desplazamiento) */}
      {more && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end md:hidden" onClick={() => setMore(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
          <div className="animate-in relative flex max-h-[82vh] flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="h-1 w-8 rounded-full bg-slate-300" aria-hidden />
                <p className="text-base font-bold text-ink">Más opciones</p>
              </div>
              <button onClick={() => setMore(false)} className="btn-ghost btn-sm" aria-label="Cerrar"><IconX size={18} /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2" style={{ paddingBottom: "calc(5.5rem + env(safe-area-inset-bottom))" }}>
              <MoreList onTour={() => { setMore(false); setTour(true); }} />
            </div>
          </div>
        </div>
      )}

      {/* Móvil: barra inferior Inicio · Revisar · Agregar (centro) · Inventario · Más */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/70 bg-white/95 backdrop-blur-md md:hidden">
        <div className="grid grid-cols-5 items-end">
          {MAIN.map(({ href, label, Icon, ...rest }) =>
            "primary" in rest ? (
              <Link
                key={href}
                href={href}
                className="relative -mt-6 flex flex-col items-center pb-1.5"
                onPointerDown={startPress}
                onPointerUp={endPress}
                onPointerLeave={endPress}
                onPointerCancel={endPress}
                onContextMenu={(e) => e.preventDefault()}
                onClick={(e) => {
                  if (longPressed.current) e.preventDefault();
                }}
                title="Toca: agregar · Mantén pulsado: cámara o galería"
              >
                <span className={`grid h-14 w-14 place-items-center rounded-full text-white shadow-float transition active:scale-95 ${isActive(href) ? "ring-4 ring-brand-200" : ""}`} style={{ backgroundImage: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}>
                  <IconCamera size={26} />
                </span>
                <span className="mt-1 text-[11px] font-semibold text-brand-700">{label}</span>
                {flow.working > 0 && <Badge n={flow.working} pulse className="absolute right-1 top-0" />}
              </Link>
            ) : (
              <Link key={href} href={href} className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${isActive(href) || (href === "/products" && isActive("/movements")) ? "text-brand-700" : "text-slate-500"}`}>
                <Icon size={22} strokeWidth={isActive(href) ? 2.4 : 2} />
                {label}
                {href === "/review" && flow.pending > 0 && <Badge n={flow.pending} className="absolute right-2 top-1" />}
              </Link>
            )
          )}
          <button onClick={() => setMore((v) => !v)} className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${more || moreActive ? "text-brand-700" : "text-slate-500"}`}>
            <IconList size={22} strokeWidth={more ? 2.4 : 2} />
            Más
          </button>
        </div>
      </nav>

      {tour && <WhatsNew force onClose={() => setTour(false)} />}
    </>
  );
}

function MoreList({ onTour }: { onTour: () => void }) {
  return (
    <div className="space-y-3">
      {MORE_GROUPS.map((g) => (
        <section key={g.title}>
          <p className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">{g.title}</p>
          <ul className="grid gap-0.5">
            {g.items.map(({ href, label, hint, Icon }) => (
              <li key={href}>
                <Link href={href} className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-brand-50 active:bg-brand-100">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600"><Icon size={20} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold leading-tight text-ink">{label}</span>
                    <span className="block text-xs leading-snug text-slate-500">{hint}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section>
        <p className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Primera vez</p>
        <button onClick={onTour} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-brand-50 active:bg-brand-100">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700"><IconSparkles size={20} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold leading-tight text-ink">Cómo usar la herramienta</span>
            <span className="block text-xs leading-snug text-slate-500">Un recorrido corto por lo principal</span>
          </span>
        </button>
      </section>
    </div>
  );
}

function TopLink({ href, active, Icon, label, badge }: { href: string; active: boolean; Icon: (p: { size?: number }) => JSX.Element; label: string; badge?: number }) {
  return (
    <Link href={href} className={`relative flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition ${active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100"}`}>
      <Icon size={18} />
      {label}
      {badge ? <Badge n={badge} /> : null}
    </Link>
  );
}

function Badge({ n, pulse, className = "" }: { n: number; pulse?: boolean; className?: string }) {
  return (
    <span className={`grid h-5 min-w-[20px] place-items-center rounded-full px-1 text-[10px] font-bold text-white ${pulse ? "animate-pulse bg-amber-500" : "bg-rose-500"} ${className || "ml-1"}`}>
      {n > 99 ? "99+" : n}
    </span>
  );
}
