"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import OwnerOnly from "@/components/OwnerOnly";
import CleanupCard from "@/components/CleanupCard";
import BackupCard from "@/components/settings/BackupCard";
import { ListRow, ScreenHeader } from "@/components/ui/Screen";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { IconChevronRight, IconCloud, IconDownload, IconTable, IconTrash } from "@/components/ui/Icons";

// Carga los productos (y la librería de Excel al descargar) solo cuando se abre
const ExportCard = dynamic(() => import("@/components/settings/ExportCard"), { loading: () => <ListSkeleton rows={2} /> });

type Open = "export" | "backup" | null;

/**
 * Mis datos (C7.8 · RECONSTRUCCION_VISUAL.md §3.2, F24–F27): Descargar Excel · Traer desde Excel · Respaldos ·
 * Ordenar y limpiar · Papelera. Reemplaza /export, /backup y las herramientas que estaban al final de Inicio.
 */
export default function DataPage() {
  const [open, setOpen] = useState<Open>(null);
  const toggle = (k: Open) => setOpen((o) => (o === k ? null : k));
  return (
    <OwnerOnly>
      <div className="mx-auto max-w-2xl space-y-4">
        <ScreenHeader
          title="Mis datos"
          subtitle="Llévate tu inventario, guarda copias y deja todo ordenado."
          back={{ href: "/settings", label: "Ajustes" }}
          help={<p>Para cargar productos desde una planilla usa <b>Traer desde Excel</b>; para llevarte el inventario, <b>Descargar Excel</b>. Los <b>respaldos</b> guardan todo el negocio (también ventas, clientes y caja).</p>}
        />

        <section className="animate-in card p-0">
          <button type="button" onClick={() => toggle("export")} className="flex min-h-[64px] w-full items-center gap-3 px-3 py-2 text-left" aria-expanded={open === "export"}>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600"><IconDownload size={20} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-base font-semibold text-ink">Descargar Excel</span>
              <span className="block truncate text-xs text-muted">Tu inventario en una planilla (todo o una categoría)</span>
            </span>
            <IconChevronRight className={`shrink-0 text-slate-400 transition ${open === "export" ? "rotate-90" : ""}`} />
          </button>
          {open === "export" && <div className="border-t border-slate-100 p-3"><ExportCard /></div>}
        </section>

        <section className="animate-in card p-1">
          <ListRow href="/add?mode=excel" icon={<IconTable size={20} />} title="Traer desde Excel" subtitle="Cargar productos desde una planilla" end={<IconChevronRight className="shrink-0 text-slate-400" />} />
        </section>

        <section className="animate-in card p-0">
          <button type="button" onClick={() => toggle("backup")} className="flex min-h-[64px] w-full items-center gap-3 px-3 py-2 text-left" aria-expanded={open === "backup"}>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600"><IconCloud size={20} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-base font-semibold text-ink">Respaldos</span>
              <span className="block truncate text-xs text-muted">Copia completa cada sábado; guarda o descarga una ahora</span>
            </span>
            <IconChevronRight className={`shrink-0 text-slate-400 transition ${open === "backup" ? "rotate-90" : ""}`} />
          </button>
          {open === "backup" && <div className="border-t border-slate-100 p-3"><BackupCard /></div>}
        </section>

        <section id="limpiar" className="scroll-mt-24">
          <CleanupCard />
        </section>

        <section className="animate-in card p-1">
          <ListRow href="/products?filter=trash" icon={<IconTrash size={20} />} title="Papelera" subtitle="Recuperar productos borrados" end={<IconChevronRight className="shrink-0 text-slate-400" />} />
        </section>
      </div>
    </OwnerOnly>
  );
}
