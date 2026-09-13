"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { hydrateQueue, queueSummary, useQueue } from "@/lib/queue";
import { IconBox, IconCamera, IconCheckCircle, IconHome, IconSettings } from "./ui/Icons";

const items = [
  { href: "/dashboard", label: "Inicio", Icon: IconHome },
  { href: "/review", label: "Revisar", Icon: IconCheckCircle },
  { href: "/capture", label: "Agregar", Icon: IconCamera, primary: true },
  { href: "/products", label: "Inventario", Icon: IconBox },
  { href: "/settings", label: "Ajustes", Icon: IconSettings },
];

export default function Nav() {
  const pathname = usePathname();
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
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-500 text-white shadow-md shadow-brand-500/30">
              <IconCamera size={18} />
            </span>
            <span className="text-lg font-bold tracking-tight text-ink">InventarIA</span>
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

      {/* Móvil: barra inferior con botón central de cámara */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/70 bg-white/95 backdrop-blur-md md:hidden">
        <div className="grid grid-cols-5 items-end">
          {items.map(({ href, label, Icon, primary }) =>
            primary ? (
              <Link key={href} href={href} className="relative -mt-6 flex flex-col items-center pb-1.5">
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
