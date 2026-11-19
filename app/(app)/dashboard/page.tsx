"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { queueSummary, useQueue } from "@/lib/queue";
import { expiringSoon, fromSummary, money, needsRestock, priceOf, stockOf, SUMMARY_COLS } from "@/lib/inventory";
import { businessDayKey, businessDayStart } from "@/lib/dates";
import { StepByStep, type GuideProgress } from "@/components/guide/Guide";
import AiUsageCard from "@/components/AiUsageCard";
import CleanupCard from "@/components/CleanupCard";
import { useFlow } from "@/components/FlowProvider";
import { Stat, TaskCard } from "@/components/ui/Screen";
import type { Category } from "@/types/database";
import { IconAlert, IconBell, IconCamera, IconCart, IconCheck, IconCheckCircle, IconChevronRight, IconRegister, IconSettings, IconStore, IconTag, IconUsers, Spinner } from "@/components/ui/Icons";

interface Stats {
  types: number;
  onboarded: boolean;
  porReponer: number;
  agotados: number;
  porVencer: number;
  sinPrecio: number;
  salesToday: { total: number; profit: number; count: number };
  salesEver: number;
  closedToday: boolean;
  owed: number;
  oldDebtors: number;
}

/**
 * Inicio «Hoy» (C7.2 · RECONSTRUCCION_VISUAL.md §3.2): botón grande para Vender, lo vendido hoy y hasta 4 tareas
 * que piden atención, cada una con el botón que la resuelve. En el primer uso, los primeros pasos.
 */
export default function DashboardPage() {
  const router = useRouter();
  const flow = useFlow();
  const [stats, setStats] = useState<Stats | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const queue = useQueue();
  const q = queueSummary(queue.items);
  const { alerts } = flow;
  const { minStock, expiryDays } = alerts;

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const dayStart = businessDayStart();
      const month = new Date(Date.now() - 30 * 86400000).toISOString();
      const [cats, prof, prods, sales, open, ever, closing] = await Promise.all([
        supabase.from("categories").select("*"),
        supabase.from("profiles").select("onboarded_at").maybeSingle(),
        supabase.from("product_summaries").select(SUMMARY_COLS).eq("status", "confirmed"),
        supabase.from("sales_v").select("total,cost_total").gte("created_at", dayStart.toISOString()),
        supabase.from("sales").select("total,paid,customer_id,created_at").neq("status", "pagado"),
        supabase.from("sales").select("id", { count: "exact", head: true }),
        supabase.from("cash_closings").select("id").eq("day", businessDayKey()).limit(1),
      ]);
      const categories = (cats.data ?? []) as Category[];
      const list = (prods.data ?? []).map(fromSummary);
      const todays = sales.data ?? [];
      const openSales = open.data ?? [];
      const s: Stats = {
        types: categories.filter((c) => !c.parent_id).length,
        onboarded: !!prof.data?.onboarded_at,
        // Misma regla que la lista de reposición: mínimos del negocio/categoría/producto y avisos silenciados
        porReponer: list.filter((p) => needsRestock(p, categories, alerts)).length,
        agotados: list.filter((p) => (stockOf(p) ?? 0) <= 0 && needsRestock(p, categories, alerts)).length,
        porVencer: list.filter((p) => expiringSoon(p, alerts, categories)).length,
        sinPrecio: list.filter((p) => priceOf(p) === null).length,
        salesToday: {
          total: todays.reduce((a, r) => a + Number(r.total ?? 0), 0),
          profit: todays.reduce((a, r) => a + Number(r.total ?? 0) - Number(r.cost_total ?? 0), 0),
          count: todays.length,
        },
        salesEver: ever.count ?? 0,
        closedToday: (closing.data ?? []).length > 0,
        owed: openSales.reduce((a, r) => a + Number(r.total) - Number(r.paid), 0),
        oldDebtors: new Set(openSales.filter((r) => r.customer_id && r.created_at < month).map((r) => r.customer_id)).size,
      };
      // Cuenta nueva sin nada configurado → asistente inicial
      if (!s.onboarded && s.types === 0 && flow.loaded && flow.pending + flow.confirmed === 0) {
        router.replace("/onboarding");
        return;
      }
      setStats(s);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.done, router, minStock, expiryDays, flow.loaded, flow.pending, flow.confirmed]);

  // «Más → Ordenar y limpiar» abre las herramientas (transitorio hasta C7.8: pasan a Ajustes → Mis datos)
  useEffect(() => {
    const openFromHash = () => {
      const hash = window.location.hash;
      if (hash === "#guia" || hash === "#limpiar") {
        setToolsOpen(true);
        setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" }), 200);
      }
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, [stats]);

  if (!stats) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner size={28} className="text-brand-500" />
      </div>
    );
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches";
  const working = q.queued + q.processing;
  const pending = flow.pending;
  const confirmed = flow.confirmed;
  const progress: GuideProgress = { hasTypes: stats.types > 0, hasPhotos: pending + confirmed + q.total > 0, hasConfirmed: confirmed > 0, pending };
  const plural = (n: number, s: string, p = s + "s") => `${n} ${n === 1 ? s : p}`;

  // Primeros pasos (desaparecen al completarlos)
  const steps = [
    { done: stats.types > 0, title: "Crea tu tienda", body: "Elige qué vendes: la IA ordena tus productos con eso.", href: "/store", cta: "Elegir", Icon: IconStore },
    { done: confirmed > 0, title: "Agrega productos", body: "Con una foto, el código de barras o a mano.", href: "/add", cta: "Agregar", Icon: IconCamera },
    { done: stats.salesEver > 0, title: "Haz tu primera venta", body: "El stock baja solo y queda el ticket.", href: "/sell", cta: "Vender", Icon: IconCart },
  ];
  const firstUse = steps.some((s) => !s.done);

  // Tareas: lo que pide atención hoy (máximo 4), cada una con su botón
  type Task = { key: string; tone: "info" | "warn" | "danger" | "ok"; Icon: (p: { size?: number }) => JSX.Element; title: string; body?: string; href: string; cta: string };
  const tasks: Task[] = [];
  if (working > 0) tasks.push({ key: "fotos", tone: "info", Icon: IconCamera, title: `Analizando ${plural(working, "foto")}…`, body: "Te aviso cuando estén listas para revisar.", href: "/add", cta: "Ver" });
  if (pending > 0) tasks.push({ key: "revisar", tone: "info", Icon: IconCheckCircle, title: `${plural(pending, "producto")} por revisar`, body: "Confirma nombre, precio y stock.", href: "/add/review", cta: "Revisar" });
  if (stats.salesToday.count > 0 && !stats.closedToday && hour >= 18) tasks.push({ key: "caja", tone: "warn", Icon: IconRegister, title: "Falta cerrar la caja de hoy", body: "Cuenta el efectivo y mira si cuadra.", href: "/sell/cash", cta: "Cerrar" });
  if (stats.oldDebtors > 0) tasks.push({ key: "fiados", tone: "danger", Icon: IconUsers, title: `${plural(stats.oldDebtors, "cliente")} debe${stats.oldDebtors === 1 ? "" : "n"} hace más de 30 días`, body: `En total te deben ${money(stats.owed)}.`, href: "/customers?filter=debt", cta: "Cobrar" });
  if (stats.porVencer > 0) tasks.push({ key: "vencer", tone: "warn", Icon: IconAlert, title: `${plural(stats.porVencer, "producto")} por vencer`, body: `Vencen en ${alerts.expiryDays} días o ya vencieron.`, href: "/products?filter=expiring", cta: "Ver" });
  if (stats.porReponer > 0) tasks.push({ key: "reponer", tone: stats.agotados ? "danger" : "warn", Icon: IconBell, title: `${plural(stats.porReponer, "producto")} por reponer`, body: stats.agotados ? `${plural(stats.agotados, "agotado")}; la lista para pedir ya está armada.` : "Están bajo su mínimo; la lista ya está armada.", href: "/products?filter=restock", cta: "Ver lista" });
  if (stats.sinPrecio > 0 && confirmed > 0) tasks.push({ key: "precio", tone: "info", Icon: IconTag, title: `${plural(stats.sinPrecio, "producto")} sin precio`, body: "No se pueden vender bien sin precio.", href: "/products", cta: "Completar" });
  const shown = tasks.slice(0, 4);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <header className="animate-in">
        <p className="text-sm font-medium text-muted">{greeting} · {new Date().toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" })}</p>
        <h1 className="text-2xl font-bold tracking-tight text-ink md:text-3xl">{flow.business?.name || "Tu negocio"}</h1>
      </header>

      {/* La acción del día: vender */}
      <Link href="/sell" className="animate-in flex items-center gap-4 rounded-3xl p-5 text-white shadow-float transition active:scale-[0.99]" style={{ backgroundImage: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}>
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/20"><IconCart size={30} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-2xl font-bold leading-tight">Vender</span>
          <span className="block text-sm text-white/85">
            Hoy: {money(stats.salesToday.total)} · {plural(stats.salesToday.count, "venta")}
            {flow.isOwner && stats.salesToday.count > 0 ? ` · ganas ${money(stats.salesToday.profit)}` : ""}
          </span>
        </span>
        <IconChevronRight size={22} />
      </Link>

      {/* Primeros pasos */}
      {firstUse && (
        <section className="animate-in card space-y-2 p-4">
          <p className="text-sm font-bold text-ink">Primeros pasos</p>
          <ol className="space-y-2">
            {steps.map((s, i) => {
              const current = !s.done && steps.slice(0, i).every((x) => x.done);
              return (
                <li key={s.title} className={`flex items-center gap-3 rounded-2xl p-2 ${current ? "bg-brand-50" : ""}`}>
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${s.done ? "bg-ok-100 text-ok-700" : current ? "bg-brand-600 text-white" : "bg-slate-100 text-muted"}`}>
                    {s.done ? <IconCheck size={20} /> : <s.Icon size={20} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-base font-semibold ${s.done ? "text-muted line-through" : "text-ink"}`}>{i + 1}. {s.title}</span>
                    {!s.done && <span className="block text-xs text-muted">{s.body}</span>}
                  </span>
                  {current && <Link href={s.href} className="btn-primary btn-sm min-h-[44px]">{s.cta}</Link>}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {/* Tareas */}
      {shown.length > 0 ? (
        <section className="space-y-2" aria-label="Para hacer hoy">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">Para hacer hoy</p>
          {shown.map((t) => (
            <TaskCard key={t.key} tone={t.tone} icon={<t.Icon size={22} />} title={t.title} body={t.body} href={t.href} cta={t.cta} />
          ))}
          {tasks.length > shown.length && <p className="text-center text-xs text-muted">y {plural(tasks.length - shown.length, "aviso")} más en Productos</p>}
        </section>
      ) : (
        !firstUse && (
          <div className="animate-in flex items-center gap-3 rounded-3xl bg-ok-50 p-4 text-ok-800">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-ok-100"><IconCheck size={22} /></span>
            <span className="text-base font-semibold">Todo al día. Nada pendiente por ahora.</span>
          </div>
        )
      )}

      {/* Números rápidos */}
      <div className="animate-in grid grid-cols-2 gap-2">
        <Link href="/products"><Stat label="En inventario" value={String(confirmed)} hint={plural(stats.types, "categoría")} /></Link>
        <Link href={stats.owed > 0 ? "/customers?filter=debt" : "/customers"}><Stat label="Te deben" value={money(stats.owed)} tone={stats.owed > 0 ? "warn" : undefined} hint={stats.owed > 0 ? "fiados por cobrar" : "nadie te debe"} /></Link>
      </div>

      {/* Herramientas del dueño (transitorio: en C7.8 pasan a Ajustes → Mis datos e Inteligencia artificial) */}
      {flow.isOwner && (
        <section className="animate-in">
          <button type="button" onClick={() => setToolsOpen((v) => !v)} className="btn-disclosure min-h-[56px]" aria-expanded={toolsOpen}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700"><IconSettings size={18} /></span>
            <span className="min-w-0 flex-1">
              <span className="block">Herramientas</span>
              <span className="block truncate text-xs font-normal text-muted">Consumo de IA · ordenar y limpiar · guía paso a paso</span>
            </span>
            <IconChevronRight className={`shrink-0 text-brand-600 transition ${toolsOpen ? "rotate-90" : ""}`} />
          </button>
          {toolsOpen && (
            <div className="mt-3 space-y-4">
              <AiUsageCard />
              <div id="limpiar" className="scroll-mt-24"><CleanupCard /></div>
              <div id="guia" className="scroll-mt-24 pt-2"><StepByStep progress={progress} /></div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
