"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useFlow } from "@/components/FlowProvider";
import QueueStatus from "@/components/add/QueueStatus";
import { ScreenHeader, TaskCard } from "@/components/ui/Screen";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { IconCamera, IconCheckCircle, IconEdit, IconImages, IconScan, IconTable } from "@/components/ui/Icons";

// Cada manera se carga solo cuando se elige (las de código y Excel traen librerías pesadas)
const loading = () => <ListSkeleton rows={3} />;
const PhotoAdd = dynamic(() => import("@/components/add/PhotoAdd"), { loading });
const ShelfDetect = dynamic(() => import("@/components/ShelfDetect"), { loading });
const CodeAdd = dynamic(() => import("@/components/add/CodeAdd"), { loading });
const ManualAdd = dynamic(() => import("@/components/add/ManualAdd"), { loading });
const ExcelAdd = dynamic(() => import("@/components/add/ExcelAdd"), { loading });

const MODES = [
  { value: "photo", label: "Foto", hint: "La IA llena los datos", Icon: IconCamera },
  { value: "shelf", label: "Estante", hint: "Varios en una foto", Icon: IconImages },
  { value: "code", label: "Código", hint: "Sin gastar IA", Icon: IconScan },
  { value: "manual", label: "A mano", hint: "Lo escribes tú", Icon: IconEdit },
  { value: "excel", label: "Excel", hint: "Desde una planilla", Icon: IconTable, ownerOnly: true },
] as const;
type Mode = (typeof MODES)[number]["value"];

export default function AddPage() {
  return (
    <Suspense fallback={<ListSkeleton rows={3} />}>
      <Add />
    </Suspense>
  );
}

/**
 * Agregar (C7.4 · RECONSTRUCCION_VISUAL.md §3.2): las cinco maneras de cargar productos en un mismo lugar
 * (antes /capture, /scan, /products/new e /import), con la cola de fotos y el acceso a Revisar siempre a la vista.
 */
function Add() {
  const params = useSearchParams();
  const router = useRouter();
  const { pending, isOwner } = useFlow();
  // Las redirecciones de Cloudflare pegan la consulta antigua con «?»: se corta ahí
  const raw = params.get("mode")?.split("?")[0] ?? "";
  const modes = MODES.filter((m) => !("ownerOnly" in m) || isOwner);
  const mode: Mode = modes.some((m) => m.value === raw) ? (raw as Mode) : "photo";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <ScreenHeader
        title="Agregar productos"
        back={{ href: "/products", label: "Productos" }}
        help={
          <>
            <p><b>Foto:</b> fotografía la etiqueta o el empaque; la IA llena nombre, marca y más. Puedes tomar muchas seguidas.</p>
            <p><b>Estante:</b> una foto con varios productos; marcas cuáles agregar.</p>
            <p><b>Código:</b> escanea el código de barras. Si el producto es conocido, se llena solo, sin gastar IA. Si ya lo tienes, suma stock.</p>
            <p><b>A mano</b> y <b>Excel</b> no usan IA.</p>
            <p>Lo que agregas con foto queda <b>Pendiente</b> hasta que lo revisas: nada entra al inventario sin que lo confirmes.</p>
          </>
        }
      />

      {/* Las cinco maneras */}
      <div role="tablist" className={`grid gap-2 ${modes.length === 5 ? "grid-cols-5" : "grid-cols-4"}`}>
        {modes.map((m) => {
          const on = m.value === mode;
          return (
            <button
              key={m.value}
              role="tab"
              aria-selected={on}
              type="button"
              onClick={() => router.replace(`/add?mode=${m.value}`, { scroll: false })}
              className={`flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 text-center transition ${on ? "bg-ink text-white shadow-card" : "bg-white text-slate-700 ring-1 ring-slate-900/10 hover:bg-slate-50"}`}
            >
              <m.Icon size={22} />
              <span className="text-sm font-semibold leading-tight">{m.label}</span>
              <span className={`hidden text-xs leading-tight sm:block ${on ? "text-white/70" : "text-muted"}`}>{m.hint}</span>
            </button>
          );
        })}
      </div>

      {pending > 0 && (
        <TaskCard icon={<IconCheckCircle size={20} />} tone="info" title={`${pending} pendiente${pending === 1 ? "" : "s"} por revisar`} body="Confirma nombre, precio y stock para que entren al inventario." href="/add/review" cta="Revisar" />
      )}

      <div className="animate-in">
        {mode === "photo" && <PhotoAdd />}
        {mode === "shelf" && (
          <div className="space-y-4">
            <ShelfDetect categoryId={null} />
            <QueueStatus />
          </div>
        )}
        {mode === "code" && (
          <div className="space-y-4">
            <CodeAdd />
            <QueueStatus />
          </div>
        )}
        {mode === "manual" && <ManualAdd />}
        {mode === "excel" && <ExcelAdd />}
      </div>
    </div>
  );
}
