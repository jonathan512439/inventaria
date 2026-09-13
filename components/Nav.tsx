"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const links = [
  { href: "/dashboard", label: "Inicio", icon: "⌂" },
  { href: "/capture", label: "Foto", icon: "📷" },
  { href: "/drafts", label: "Borradores", icon: "📝" },
  { href: "/products", label: "Productos", icon: "📦" },
  { href: "/categories", label: "Categorías", icon: "🗂" },
  { href: "/templates", label: "Campos", icon: "🧩" },
  { href: "/export", label: "Exportar", icon: "⬇" },
];

const mobileMain = links.slice(0, 4);
const mobileMore = links.slice(4);

export default function Nav({ email }: { email: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);

  // Cierra el menú "Más" al navegar
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const moreActive = mobileMore.some((l) => isActive(l.href));

  return (
    <>
      {/* Barra superior */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/dashboard" className="text-lg font-bold text-brand-700">InventarIA</Link>
          <nav className="hidden items-center gap-1 md:flex">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  isActive(l.href) ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <span className="hidden max-w-[160px] truncate text-xs text-slate-500 sm:inline">{email}</span>
            <button onClick={signOut} className="btn-ghost px-2 py-1 text-xs">Salir</button>
          </div>
        </div>
      </header>

      {/* Menú "Más" (móvil) */}
      {moreOpen && (
        <div className="fixed inset-0 z-30 md:hidden" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300" />
            <div className="grid grid-cols-3 gap-2">
              {mobileMore.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`flex flex-col items-center gap-1 rounded-xl border p-3 text-xs ${
                    isActive(l.href) ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-700"
                  }`}
                >
                  <span className="text-2xl leading-none">{l.icon}</span>
                  {l.label}
                </Link>
              ))}
            </div>
            <p className="mt-4 truncate text-center text-xs text-slate-400">{email}</p>
            <button onClick={signOut} className="btn-secondary mt-2 w-full">Cerrar sesión</button>
          </div>
        </div>
      )}

      {/* Barra inferior móvil */}
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="grid grid-cols-5">
          {mobileMain.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${
                isActive(l.href) ? "text-brand-700" : "text-slate-500"
              }`}
            >
              <span className="text-lg leading-none">{l.icon}</span>
              {l.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${moreActive || moreOpen ? "text-brand-700" : "text-slate-500"}`}
          >
            <span className="text-lg leading-none">☰</span>
            Más
          </button>
        </div>
      </nav>
    </>
  );
}
