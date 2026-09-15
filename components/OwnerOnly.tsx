"use client";

import Link from "next/link";
import { useFlow } from "./FlowProvider";
import { IconAlert } from "./ui/Icons";

/** Pantallas del dueño: al vendedor se le explica y se le devuelve al Inicio. */
export default function OwnerOnly({ children }: { children: React.ReactNode }) {
  const { isOwner, business } = useFlow();
  if (!business || isOwner) return <>{children}</>;
  return (
    <div className="mx-auto max-w-md">
      <div className="animate-in card text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-amber-100 text-amber-700"><IconAlert size={26} /></span>
        <h1 className="mt-3 text-xl font-bold text-ink">Esto lo maneja el dueño</h1>
        <p className="mt-1 text-sm text-slate-500">Como vendedor puedes vender, cobrar, contar y reponer. Los precios de compra, la ganancia, los reportes y la configuración son del dueño.</p>
        <Link href="/dashboard" className="btn-primary mt-4 w-full">Volver al Inicio</Link>
      </div>
    </div>
  );
}
