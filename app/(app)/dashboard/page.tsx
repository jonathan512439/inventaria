"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { queueSummary, useQueue } from "@/lib/queue";
import { DEFAULT_MIN_STOCK, EXPIRY_SOON_DAYS, daysToExpiry, fmtMoney } from "@/lib/inventory";
import { StepByStep, computeStates, type GuideProgress } from "@/components/guide/Guide";
import AiUsageCard from "@/components/AiUsageCard";
import CleanupCard from "@/components/CleanupCard";
import { useFlow } from "@/components/FlowProvider";
import { IconAlert, IconBox, IconCamera, IconCheck, IconCheckCircle, IconChevronRight, IconDownload, IconList, IconSettings, IconSparkles, IconTag, Spinner } from "@/components/ui/Icons";

interface Stats {
  pending: number;
  confirmed: number;
  types: number;
  business: string | null;
  onboarded: boolean;
  agotados: number;
  sinPrecio: number;
  porReponer: number;
  porVencer: number;
  salesToday: { total: number; count: number };
  addedToday: number;
}

/** Inicio «Hoy»: una sola pregunta (¿qué hay que hacer hoy?), una acción principal y lo demás plegado en «Más». */
export default function DashboardPage() {
  const router = useRouter();
  const flow = useFlow();
  const [stats, setStats] = useState<Stats | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const queue = useQueue();
  const q = queueSummary(queue.items);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const [d, c, t, p, prods, sales, added] = await Promise.all([
        supabase.from("products").select("id", { count: "exact", head: true }).eq("status", "draft").is("deleted_at", null),
        supabase.from("products").select("id", { count: "exact", head: true }).eq("status", "confirmed").is("deleted_at", null),
        supabase.from("categories").select("id,parent_id,min_stock_default"),
        supabase.from("profiles").select("business_name, onboarded_at").maybeSingle(),
        supabase.from("product_summaries").select("stock,precio,min_stock,expires_at,category_id").eq("status", "confirmed"),
        supabase.from("stock_movements").select("total").eq("tipo", "venta").gte("created_at", dayStart.toISOString()),
        supabase.from("products").select("id", { count: "exact", head: true }).gte("created_at", dayStart.toISOString()).is("deleted_at", null),
      ]);
      const list = prods.data ?? [];
      const cats = t.data ?? [];
      const minOf = (r: { min_stock?: number | null; category_id: string | null }) => {
        if (typeof r.min_stock === "number") return r.min_stock;
        const cat = cats.find((c) => c.id === r.category_id);
        const top = cat?.parent_id ? cats.find((c) => c.id === cat.parent_id) : cat;
        return typeof top?.min_stock_default === "number" ? top.min_stock_default : DEFAULT_MIN_STOCK;
      };
      const s: Stats = {
        pending: d.count ?? 0,
        confirmed: c.count ?? 0,
        types: cats.filter((c) => !c.parent_id).length,
        business: p.data?.business_name ?? null,
        onboarded: !!p.data?.onboarded_at,
        agotados: list.filter((x) => (x.stock ?? 0) <= 0).length,
        sinPrecio: list.filter((x) => x.precio === null).length,
        porReponer: list.filter((x) => (x.stock ?? 0) <= minOf(x)).length,
        porVencer: list.filter((x) => {
          const d = daysToExpiry(x.expires_at);
          return d !== null && d <= EXPIRY_SOON_DAYS;
        }).length,
        salesToday: { total: (sales.data ?? []).reduce((a, r) => a + (r.total ?? 0), 0), count: (sales.data ?? []).length },
        addedToday: added.count ?? 0,
      };
      // Cuenta nueva sin nada configurado → asistente inicial
      if (!s.onboarded && s.types === 0 && s.pending + s.confirmed === 0) {
        router.replace("/onboarding");
        return;
      }
      setStats(s);
    })();
  }, [q.done, router]);

  // Enlaces «Más → Guía / Ordenar y limpiar» abren la sección plegada
  useEffect(() => {
    const openFromHash = () => {
      const hash = window.location.hash;
      if (hash === "#guia" || hash === "#limpiar") {
        setMoreOpen(true);
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
  const pending = flow.loaded ? flow.pending : stats.pending;
  const progress: GuideProgress = {
    hasTypes: stats.types > 0,
    hasPhotos: stats.pending + stats.confirmed + q.total > 0,
    hasConfirmed: stats.confirmed > 0,
    pending,
  };
  const states = computeStates(progress);
  const allDone = states.every((s) => s === "done");

  // ¿Qué hay que hacer hoy? → una sola acción principal
  const today =
    working > 0
      ? { title: `Analizando ${working} foto${working === 1 ? "" : "s"}…`, text: "Puedes seguir tomando fotos; te aviso cuando estén listas para revisar.", href: "/capture", cta: "Ver el avance", Icon: IconCamera, tone: "amber" as const }
      : pending > 0
        ? { title: `${pending} producto${pending === 1 ? "" : "s"} por revisar`, text: "Confirma nombre, precio y stock. Un toque por producto.", href: "/review", cta: "Revisar ahora", Icon: IconCheckCircle, tone: "brand" as const }
        : stats.types === 0
          ? { title: "Elige qué vendes", text: "Con eso la IA sabe cómo ordenar tus fotos.", href: "/store", cta: "Elegir mis categorías", Icon: IconSparkles, tone: "brand" as const }
          : stats.confirmed === 0
            ? { title: "Agrega tu primer producto", text: "Una foto basta: la IA lee la etiqueta y lo ordena.", href: "/capture", cta: "Tomar la primera foto", Icon: IconCamera, tone: "brand" as const }
            : stats.porVencer > 0
              ? { title: `${stats.porVencer} producto${stats.porVencer === 1 ? "" : "s"} por vencer`, text: "Vencen en 30 días o ya vencieron. Revisa qué hacer con ellos.", href: "/restock?tab=vencer", cta: "Ver por vencer", Icon: IconAlert, tone: "amber" as const }
            : stats.porReponer > 0
              ? { title: `${stats.porReponer} producto${stats.porReponer === 1 ? "" : "s"} por reponer`, text: stats.agotados ? `${stats.agotados} agotado${stats.agotados === 1 ? "" : "s"}; el resto está bajo el mínimo. La lista de reposición ya está armada.` : "Están bajo su stock mínimo. La lista de reposición ya está armada.", href: "/restock", cta: "Ver lista de reposición", Icon: IconAlert, tone: "rose" as const }
              : { title: "Todo al día", text: "Sigue agregando productos o registra ventas desde el inventario.", href: "/capture", cta: "Agregar productos", Icon: IconCamera, tone: "emerald" as const };

  const tones = {
    brand: "from-brand-600 via-violet-600 to-fuchsia-600",
    amber: "from-amber-500 via-orange-500 to-rose-500",
    rose: "from-rose-500 via-pink-600 to-fuchsia-600",
    emerald: "from-emerald-500 via-teal-500 to-cyan-600",
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header className="animate-in flex items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{greeting}</p>
          <h1 className="text-2xl font-bold tracking-tight text-ink md:text-3xl">{stats.business || "Tu inventario"}</h1>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-card ring-1 ring-slate-900/10">
          {new Date().toLocaleDateString("es", { weekday: "short", day: "numeric", month: "short" })}
        </span>
      </header>

      {/* HOY: una pregunta, una acción */}
      <section className={`animate-in relative overflow-hidden rounded-3xl bg-gradient-to-br ${tones[today.tone]} p-5 text-white shadow-float`}>
        <p className="text-xs font-bold uppercase tracking-wider text-white/75">¿Qué hay que hacer hoy?</p>
        <div className="mt-2 flex items-start gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/20"><today.Icon size={30} /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold leading-tight">{today.title}</h2>
            <p className="mt-1 text-sm text-white/85">{today.text}</p>
          </div>
        </div>
        <Link href={today.href} className="btn mt-4 w-full bg-white py-3.5 text-base text-ink shadow-lg hover:bg-white/90">
          {today.cta} <IconChevronRight size={18} />
        </Link>
        {/* Pasos del camino */}
        <ol className="mt-4 flex items-center justify-center gap-1 text-[11px] font-semibold">
          {[
            { n: 1, t: "Agregar", href: "/capture" },
            { n: 2, t: "Revisar", href: "/review" },
            { n: 3, t: "Inventario", href: "/products" },
          ].map((s, i) => {
            const st = i === 0 ? (progress.hasPhotos ? "done" : states[1]) : i === 1 ? (pending === 0 && progress.hasConfirmed ? "done" : pending > 0 ? "current" : "todo") : progress.hasConfirmed ? "done" : "todo";
            return (
              <li key={s.n} className="flex items-center">
                <Link href={s.href} className={`flex items-center gap-1 rounded-full px-2 py-0.5 ${st === "current" ? "bg-white text-brand-700" : st === "done" ? "bg-white/25" : "text-white/60"}`}>
                  <span className="grid h-4 w-4 place-items-center rounded-full bg-white/30 text-[9px]">{st === "done" ? <IconCheck size={10} /> : s.n}</span>
                  {s.t}
                  {s.n === 2 && pending > 0 && <span className="rounded-full bg-amber-400 px-1 text-[9px] text-amber-950">{pending}</span>}
                </Link>
                {i < 2 && <span className="mx-0.5 h-0.5 w-4 bg-white/40" />}
              </li>
            );
          })}
        </ol>
      </section>

      {/* Números de hoy */}
      <div className="animate-in grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile href="/products" label="En inventario" value={String(stats.confirmed)} hint={`${stats.types} categoría${stats.types === 1 ? "" : "s"}`} />
        <Tile href="/review" label="Por revisar" value={String(pending)} hint={pending ? "toca para confirmar" : "nada pendiente"} tone={pending ? "amber" : undefined} />
        <Tile href="/movements" label="Ventas de hoy" value={`Bs ${fmtMoney(stats.salesToday.total)}`} hint={`${stats.salesToday.count} venta${stats.salesToday.count === 1 ? "" : "s"}`} tone="emerald" />
        <Tile href="/restock" label="Por reponer" value={String(stats.porReponer)} hint={stats.porVencer ? `${stats.porVencer} por vencer · ${stats.sinPrecio} sin precio` : stats.sinPrecio ? `${stats.sinPrecio} sin precio` : "todo en orden"} tone={stats.porReponer + stats.porVencer ? "rose" : undefined} />
      </div>

      {/* Accesos directos */}
      <div className="animate-in grid grid-cols-3 gap-2">
        <Shortcut href="/capture" Icon={IconCamera} label="Agregar" hint="foto o galería" primary />
        <Shortcut href="/scan" Icon={IconTag} label="Escanear" hint="sin gastar IA" />
        <Shortcut href="/products" Icon={IconBox} label="Inventario" hint={stats.addedToday ? `${stats.addedToday} hoy` : "estantes"} />
      </div>

      {/* Más: guía, IA, limpieza, exportar, ajustes (plegado) */}
      <section className="animate-in">
        <button type="button" onClick={() => setMoreOpen((v) => !v)} className="btn-disclosure">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700"><IconList size={18} /></span>
          <span className="min-w-0 flex-1">
            <span className="block">{moreOpen ? "Ocultar herramientas" : "Más herramientas"}</span>
            <span className="block truncate text-xs font-normal text-slate-500">Guía paso a paso · consumo de IA · ordenar y limpiar · Excel · ajustes</span>
          </span>
          <IconChevronRight className={`shrink-0 text-brand-600 transition ${moreOpen ? "rotate-90" : ""}`} />
        </button>
        {moreOpen && (
          <div className="stagger mt-3 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Link href="/export" className="press flex items-center gap-3 rounded-3xl border-2 border-emerald-300 bg-white p-4 shadow-card transition hover:border-emerald-500 hover:bg-emerald-50">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-100 text-emerald-700"><IconDownload size={22} /></span>
                <span className="min-w-0"><span className="block font-bold text-ink">Exportar</span><span className="block text-xs text-slate-500">a Excel</span></span>
              </Link>
              <Link href="/settings" className="press flex items-center gap-3 rounded-3xl border-2 border-slate-300 bg-white p-4 shadow-card transition hover:border-brand-400 hover:bg-brand-50">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-slate-100 text-slate-700"><IconSettings size={22} /></span>
                <span className="min-w-0"><span className="block font-bold text-ink">Ajustes</span><span className="block text-xs text-slate-500">mi tienda y datos</span></span>
              </Link>
            </div>
            <AiUsageCard />
            <CleanupCard />
            <div id="guia" className="scroll-mt-24 pt-2">
              <StepByStep progress={progress} />
            </div>
          </div>
        )}
      </section>
      {!allDone && !moreOpen && (
        <p className="text-center text-xs text-slate-500">
          ¿Primera vez? La <button onClick={() => setMoreOpen(true)} className="font-semibold text-brand-700 underline">guía paso a paso</button> te lleva de la mano.
        </p>
      )}
    </div>
  );
}

function Tile({ href, label, value, hint, tone }: { href: string; label: string; value: string; hint: string; tone?: "amber" | "emerald" | "rose" }) {
  const t = { amber: "text-amber-700", emerald: "text-emerald-700", rose: "text-rose-700" };
  return (
    <Link href={href} className="press rounded-2xl bg-white p-3 shadow-card ring-1 ring-slate-900/10 transition hover:ring-brand-300">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${tone ? t[tone] : "text-ink"}`}>{value}</p>
      <p className="truncate text-[11px] text-slate-400">{hint}</p>
    </Link>
  );
}

function Shortcut({ href, Icon, label, hint, primary }: { href: string; Icon: (p: { size?: number }) => JSX.Element; label: string; hint: string; primary?: boolean }) {
  return (
    <Link href={href} className={`press flex flex-col items-center gap-1 rounded-2xl p-3 text-center shadow-card ring-1 transition ${primary ? "bg-brand-600 text-white ring-brand-600 hover:bg-brand-700" : "bg-white text-ink ring-slate-900/10 hover:ring-brand-300"}`}>
      <span className={`grid h-10 w-10 place-items-center rounded-xl ${primary ? "bg-white/20" : "bg-brand-50 text-brand-700"}`}><Icon size={22} /></span>
      <span className="text-sm font-bold">{label}</span>
      <span className={`text-[11px] ${primary ? "text-white/80" : "text-slate-500"}`}>{hint}</span>
    </Link>
  );
}
