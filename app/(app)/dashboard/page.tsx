"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { queueSummary, useQueue } from "@/lib/queue";
import { money } from "@/lib/inventory";
import { todaySummary } from "@/lib/data/insights";
import { useFlow } from "@/components/FlowProvider";
import BusinessLogo from "@/components/ui/BusinessLogo";
import { Stat, TaskCard } from "@/components/ui/Screen";
import { IconAlert, IconBell, IconCamera, IconCart, IconCheck, IconCheckCircle, IconChevronRight, IconRegister, IconStore, IconTag, IconUsers, Spinner } from "@/components/ui/Icons";

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
  const queue = useQueue();
  const q = queueSummary(queue.items);
  const { alerts } = flow;
  const { minStock, expiryDays } = alerts;

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      // Los números se calculan en la base (027 · today_summary): ya no se cargan todos los productos aquí.
      // «Por reponer» usa la misma regla que la lista de pedido (por variante, mínimos, avisos silenciados).
      const [cats, prof, sum] = await Promise.all([
        supabase.from("categories").select("id", { count: "exact", head: true }).is("parent_id", null),
        supabase.from("profiles").select("onboarded_at").maybeSingle(),
        todaySummary(supabase).catch(() => null),
      ]);
      const s: Stats = {
        types: cats.count ?? 0,
        onboarded: !!prof.data?.onboarded_at,
        porReponer: sum?.restock.products ?? 0,
        agotados: sum?.restock.out ?? 0,
        porVencer: sum?.expiring.count ?? 0,
        sinPrecio: sum?.no_price ?? 0,
        salesToday: { total: Number(sum?.today.total ?? 0), profit: Number(sum?.today.profit ?? 0), count: Number(sum?.today.count ?? 0) },
        salesEver: sum?.sales_ever ? 1 : 0,
        closedToday: !!sum?.closed_today,
        owed: Number(sum?.debts.total ?? 0),
        oldDebtors: Number(sum?.debts.old ?? 0),
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

  // Enlaces antiguos a las herramientas de Inicio (C7.8: viven en Ajustes)
  useEffect(() => {
    const hash = window.location.hash;
    if (hash === "#limpiar") router.replace("/settings/data#limpiar");
    else if (hash === "#guia") router.replace("/settings");
  }, [router]);

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
  const plural = (n: number, s: string, p = s + "s") => `${n} ${n === 1 ? s : p}`;

  // Primeros pasos (desaparecen al completarlos)
  const steps = [
    { done: stats.types > 0, title: "Crea tu tienda", body: "Elige qué vendes: la IA ordena tus productos con eso.", href: "/settings/catalog", cta: "Elegir", Icon: IconStore },
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
  if (stats.porVencer > 0) tasks.push({ key: "vencer", tone: "warn", Icon: IconAlert, title: `${plural(stats.porVencer, "producto")} por vencer`, body: `Vencen en ${alerts.expiryDays} días o ya vencieron: oferta, retirar o devolver.`, href: "/products?filter=expiring", cta: "Qué hacer" });
  if (stats.porReponer > 0) tasks.push({ key: "reponer", tone: stats.agotados ? "danger" : "warn", Icon: IconBell, title: `${plural(stats.porReponer, "producto")} por reponer`, body: stats.agotados ? `${plural(stats.agotados, "agotado")}; la lista para pedir ya está armada.` : "Están bajo su mínimo; la lista ya está armada.", href: "/products?filter=restock", cta: "Ver lista" });
  if (stats.sinPrecio > 0 && confirmed > 0) tasks.push({ key: "precio", tone: "info", Icon: IconTag, title: `${plural(stats.sinPrecio, "producto")} sin precio`, body: "No se pueden vender bien sin precio.", href: "/products?filter=noprice", cta: "Completar" });
  const shown = tasks.slice(0, 4);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <header className="animate-in flex items-center gap-3">
        <BusinessLogo name={flow.business?.name} url={flow.business?.logo_url} size={56} />
        <span className="min-w-0">
          <p className="text-sm font-medium text-muted">{greeting} · {new Date().toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" })}</p>
          <h1 className="truncate text-2xl font-bold tracking-tight text-ink md:text-3xl">{flow.business?.name || "Tu negocio"}</h1>
        </span>
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
    </div>
  );
}
