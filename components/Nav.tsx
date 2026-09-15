"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { enqueue } from "@/lib/queue";
import { resizeImage } from "@/lib/image";
import { useFlow } from "./FlowProvider";
import WhatsNew from "./WhatsNew";
import { IconBox, IconCamera, IconCheckCircle, IconDownload, IconFolder, IconHome, IconImages, IconList, IconSettings, IconSparkles, IconTag, IconTrash, IconX } from "./ui/Icons";
import { LogoWordmark } from "./ui/Logo";

/** Barra inferior de 3 + Más: Inicio · Agregar · Inventario · Más ▾ */
const MAIN = [
  { href: "/dashboard", label: "Inicio", Icon: IconHome },
  { href: "/capture", label: "Agregar", Icon: IconCamera, primary: true },
  { href: "/products", label: "Inventario", Icon: IconBox },
] as const;

/** Lo secundario vive en «Más» */
const MORE: { href: string; label: string; hint: string; Icon: (p: { size?: number; className?: string }) => JSX.Element }[] = [
  { href: "/review", label: "Revisar pendientes", hint: "confirma lo que la IA reconoció", Icon: IconCheckCircle },
  { href: "/scan", label: "Escanear código de barras", hint: "repetidos y reposición sin IA", Icon: IconTag },
  { href: "/movements", label: "Ventas y movimientos", hint: "ingresos, entradas y retiros", Icon: IconList },
  { href: "/export", label: "Exportar a Excel", hint: "todo o por categoría", Icon: IconDownload },
  { href: "/store", label: "Mi tienda", hint: "categorías, datos y variantes", Icon: IconFolder },
  { href: "/dashboard#guia", label: "Guía paso a paso", hint: "cómo armar tu inventario", Icon: IconSparkles },
  { href: "/dashboard#limpiar", label: "Ordenar y limpiar", hint: "pendientes viejos, vacías, fotos sueltas", Icon: IconTrash },
  { href: "/settings", label: "Ajustes", hint: "nombre del negocio, cuenta, ayuda", Icon: IconSettings },
];

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
                <div className="animate-in absolute right-0 top-12 w-80 rounded-2xl bg-white p-2 shadow-2xl ring-1 ring-slate-900/10">
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

      {/* Móvil: panel «Más» */}
      {more && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setMore(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
          <div className="animate-in absolute inset-x-0 bottom-0 rounded-t-3xl bg-white p-3 pb-24 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between px-2">
              <p className="text-sm font-bold text-ink">Más</p>
              <button onClick={() => setMore(false)} className="btn-ghost btn-sm"><IconX size={18} /></button>
            </div>
            <MoreList onTour={() => { setMore(false); setTour(true); }} />
          </div>
        </div>
      )}

      {/* Móvil: barra inferior de 3 + Más, con botón central de cámara */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/70 bg-white/95 backdrop-blur-md md:hidden">
        <div className="grid grid-cols-4 items-end">
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
              </Link>
            )
          )}
          <button onClick={() => setMore((v) => !v)} className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${more || moreActive ? "text-brand-700" : "text-slate-500"}`}>
            <IconList size={22} strokeWidth={more ? 2.4 : 2} />
            Más
            {flow.pending > 0 && !isActive("/review") && <Badge n={flow.pending} className="absolute right-3 top-1" />}
          </button>
        </div>
      </nav>

      {tour && <WhatsNew force onClose={() => setTour(false)} />}
    </>
  );
}

function MoreList({ onTour }: { onTour: () => void }) {
  const flow = useFlow();
  return (
    <ul className="grid gap-0.5">
      {MORE.map(({ href, label, hint, Icon }) => (
        <li key={href}>
          <Link href={href} className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-brand-50">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600"><Icon size={18} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink">{label}</span>
              <span className="block truncate text-[11px] text-slate-500">{hint}</span>
            </span>
            {href === "/review" && flow.pending > 0 && <Badge n={flow.pending} />}
          </Link>
        </li>
      ))}
      <li>
        <button onClick={onTour} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-brand-50">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700"><IconSparkles size={18} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink">¿Qué hay de nuevo?</span>
            <span className="block text-[11px] text-slate-500">recorrido del nuevo diseño</span>
          </span>
        </button>
      </li>
    </ul>
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
