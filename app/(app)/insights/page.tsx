"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { insightsReport, restockLines, todaySummary, type InsightsReport, type Period, type TodaySummary } from "@/lib/data/insights";
import { friendlyError } from "@/lib/errors";
import { useFlow } from "@/components/FlowProvider";
import TodayTab from "@/components/insights/TodayTab";
import SalesTab from "@/components/insights/SalesTab";
import ProductsTab from "@/components/insights/ProductsTab";
import AskTab from "@/components/insights/AskTab";
import { ChipFilter, EmptyState, ScreenHeader, Tabs } from "@/components/ui/Screen";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { IconList } from "@/components/ui/Icons";

type Tab = "hoy" | "ventas" | "productos" | "ask";
const TABS: Tab[] = ["hoy", "ventas", "productos", "ask"];
const OWNER_TABS: Tab[] = ["ventas", "productos"];
const PERIODS: Period[] = ["7d", "mes", "90d"];

export default function InsightsPage() {
  return (
    <Suspense fallback={<ListSkeleton rows={5} />}>
      <Insights />
    </Suspense>
  );
}

/**
 * Números (C7.7 · RECONSTRUCCION_VISUAL.md §3.2, F34–F36): pestañas Hoy · Ventas · Productos · Pregúntale y
 * enlace a Historial. Reemplaza /reports, /digest y /ask. Los números se calculan en la base (027: today_summary,
 * insights_report, restock_lines). Ventas y Productos son del dueño (la base también lo exige).
 */
function Insights() {
  const params = useSearchParams();
  const router = useRouter();
  // Cloudflare puede unir consultas con «?» al redirigir: se corta ahí (ver nota de C7.3)
  const param = (k: string) => params.get(k)?.split("?")[0] ?? null;
  const { isOwner, ready, business } = useFlow();
  const raw = param("tab") as Tab | null;
  const wanted: Tab = raw && TABS.includes(raw) ? raw : "hoy";
  const tab: Tab = !isOwner && OWNER_TABS.includes(wanted) ? "hoy" : wanted;
  const period: Period = PERIODS.includes(param("period") as Period) ? (param("period") as Period) : "mes";
  const supabase = createClient();
  const [today, setToday] = useState<TodaySummary | null>(null);
  const [report, setReport] = useState<InsightsReport | null>(null);
  const [restockIds, setRestockIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const go = (t: Tab, p: Period = period) => router.replace(`/insights?tab=${t}${OWNER_TABS.includes(t) && p !== "mes" ? `&period=${p}` : ""}`, { scroll: false });

  useEffect(() => {
    todaySummary(supabase).then(setToday, (e) => setError(friendlyError(e)));
  }, [supabase]);

  useEffect(() => {
    if (!ready || !isOwner || !OWNER_TABS.includes(tab)) return;
    setReport(null);
    insightsReport(supabase, period).then(setReport, (e) => setError(friendlyError(e)));
    if (tab === "productos") restockLines(supabase).then((l) => setRestockIds(new Set(l.map((x) => x.product_id))), () => null);
  }, [supabase, ready, isOwner, tab, period]);

  return (
    <div className={`${tab === "ask" ? "has-action" : ""} mx-auto max-w-3xl space-y-4`}>
      <ScreenHeader
        title="Números"
        subtitle={isOwner ? "Cómo va el negocio: hoy, ventas, productos y preguntas." : "Lo importante de hoy y preguntas sobre tus datos."}
        action={
          <Link href="/insights/history" className="btn-secondary btn-sm min-h-[44px] shrink-0"><IconList size={16} /> Historial</Link>
        }
        help={
          <>
            <p><b>Hoy</b>: lo vendido, lo que falta, lo que vence y quién debe. Con <b>Enviar resumen por WhatsApp</b> te lo mandas a ti o a tu socio.</p>
            {isOwner && <p><b>Ventas</b> compara con el periodo anterior; <b>Productos</b> muestra qué se mueve, qué está parado, cuánto ganas por categoría y cuánto vale lo que tienes.</p>}
            <p><b>Pregúntale</b> responde preguntas sobre tus datos (usa 1 análisis de IA). <b>Historial</b> tiene cada venta, entrada y retiro, con quién la hizo.</p>
          </>
        }
      />

      <Tabs<Tab>
        value={tab}
        onChange={(t) => go(t)}
        items={[
          { value: "hoy", label: "Hoy" },
          ...(isOwner ? [{ value: "ventas" as Tab, label: "Ventas" }, { value: "productos" as Tab, label: "Productos" }] : []),
          { value: "ask", label: "Pregúntale" },
        ]}
      />

      {OWNER_TABS.includes(tab) && (
        <ChipFilter<Period>
          value={[period]}
          onToggle={(p) => go(tab, p)}
          items={[
            { value: "7d", label: "7 días" },
            { value: "mes", label: "Este mes" },
            { value: "90d", label: "90 días" },
          ]}
        />
      )}

      {error ? (
        <EmptyState title="No se pudieron cargar los números" body={error} action={<button type="button" onClick={() => window.location.reload()} className="btn-secondary">Reintentar</button>} />
      ) : tab === "hoy" ? (
        today ? <TodayTab s={today} business={business?.name ?? null} /> : <ListSkeleton rows={4} />
      ) : tab === "ventas" ? (
        report ? <SalesTab r={report} /> : <ListSkeleton rows={4} />
      ) : tab === "productos" ? (
        report ? <ProductsTab r={report} restockIds={restockIds} restock={today?.restock.products ?? restockIds.size} expiring={today?.expiring.count ?? 0} /> : <ListSkeleton rows={4} />
      ) : (
        <AskTab />
      )}
    </div>
  );
}
