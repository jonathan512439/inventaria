"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { enqueue, hydrateQueue, queueSummary, useQueue } from "@/lib/queue";
import { resizeImage } from "@/lib/image";
import { IconBox, IconCamera, IconCheckCircle, IconHome, IconImages, IconSettings } from "./ui/Icons";
import { LogoWordmark } from "./ui/Logo";

const items = [
  { href: "/dashboard", label: "Inicio", Icon: IconHome },
  { href: "/review", label: "Revisar", Icon: IconCheckCircle },
  { href: "/capture", label: "Agregar", Icon: IconCamera, primary: true },
  { href: "/products", label: "Inventario", Icon: IconBox },
  { href: "/settings", label: "Ajustes", Icon: IconSettings },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [quick, setQuick] = useState(false); // menú rápido (mantener pulsado el botón de cámara)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);

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
  const queue = useQueue();
  const q = queueSummary(queue.items);
  const [pendingCount, setPendingCount] = useState(0);

  // Recupera fotos guardadas en el teléfono si la app se cerró a mitad de un lote
  useEffect(() => {
    hydrateQueue();
  }, []);

  // Contador de pendientes de revisar (se refresca al navegar y al terminar análisis)
  useEffect(() => {
    createClient()
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("status", "draft")
      .then(({ count }) => setPendingCount(count ?? 0));
  }, [pathname, q.done]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const reviewBadge = pendingCount;
  const working = q.queued + q.processing;

  return (
    <>
      {/* Escritorio: barra superior */}
      <header className="sticky top-0 z-30 hidden border-b border-slate-200/70 bg-white/80 backdrop-blur-md md:block">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/dashboard">
            <LogoWordmark />
          </Link>
          <nav className="flex items-center gap-1">
            {items.map(({ href, label, Icon, primary }) => (
              <Link
                key={href}
                href={href}
                className={
                  primary
                    ? "btn-primary ml-2 px-4 py-2"
                    : `relative flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition ${
                        isActive(href) ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100"
                      }`
                }
              >
                <Icon size={18} />
                {label}
                {href === "/review" && reviewBadge > 0 && <Badge n={reviewBadge} />}
                {href === "/capture" && working > 0 && <Badge n={working} pulse />}
              </Link>
            ))}
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
            <button type="button" onClick={() => camRef.current?.click()} className="btn-primary flex-1 flex-col gap-1 py-4">
              <IconCamera size={26} /> Cámara
            </button>
            <button type="button" onClick={() => galRef.current?.click()} className="btn flex-1 flex-col gap-1 bg-white py-4 text-ink shadow-float">
              <IconImages size={26} className="text-brand-600" /> Galería
            </button>
          </div>
          <p className="absolute inset-x-0 bottom-[4.5rem] text-center text-xs font-medium text-white/90">Acceso rápido · toca fuera para cerrar</p>
        </div>
      )}

      {/* Móvil: barra inferior con botón central de cámara */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/70 bg-white/95 backdrop-blur-md md:hidden">
        <div className="grid grid-cols-5 items-end">
          {items.map(({ href, label, Icon, primary }) =>
            primary ? (
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
                <span
                  className={`grid h-14 w-14 place-items-center rounded-full text-white shadow-float transition active:scale-95 ${
                    isActive(href) ? "ring-4 ring-brand-200" : ""
                  }`}
                  style={{ backgroundImage: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}
                >
                  <IconCamera size={26} />
                </span>
                <span className="mt-1 text-[11px] font-semibold text-brand-700">{label}</span>
                {working > 0 && <Badge n={working} pulse className="absolute right-1 top-0" />}
              </Link>
            ) : (
              <Link
                key={href}
                href={href}
                className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
                  isActive(href) ? "text-brand-700" : "text-slate-500"
                }`}
              >
                <Icon size={22} strokeWidth={isActive(href) ? 2.4 : 2} />
                {label}
                {href === "/review" && reviewBadge > 0 && <Badge n={reviewBadge} className="absolute right-3 top-1" />}
              </Link>
            )
          )}
        </div>
      </nav>
    </>
  );
}

function Badge({ n, pulse, className = "" }: { n: number; pulse?: boolean; className?: string }) {
  return (
    <span
      className={`grid h-5 min-w-[20px] place-items-center rounded-full px-1 text-[10px] font-bold text-white ${
        pulse ? "animate-pulse bg-amber-500" : "bg-rose-500"
      } ${className || "ml-1"}`}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}
