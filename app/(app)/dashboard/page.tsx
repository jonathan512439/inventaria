"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { queueSummary, useQueue } from "@/lib/queue";
import { ProgressCard, StepByStep, computeStates, type GuideProgress } from "@/components/guide/Guide";
import { IconBox, IconCamera, IconCheckCircle, IconChevronRight, IconDownload, IconSettings, Spinner } from "@/components/ui/Icons";

interface Stats {
  pending: number;
  confirmed: number;
  types: number;
  business: string | null;
  onboarded: boolean;
}

export default function DashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const queue = useQueue();
  const q = queueSummary(queue.items);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const [d, c, t, p] = await Promise.all([
        supabase.from("products").select("id", { count: "exact", head: true }).eq("status", "draft"),
        supabase.from("products").select("id", { count: "exact", head: true }).eq("status", "confirmed"),
        supabase.from("categories").select("id", { count: "exact", head: true }).is("parent_id", null),
        supabase.from("profiles").select("business_name, onboarded_at").maybeSingle(),
      ]);
      const s: Stats = {
        pending: d.count ?? 0,
        confirmed: c.count ?? 0,
        types: t.count ?? 0,
        business: p.data?.business_name ?? null,
        onboarded: !!p.data?.onboarded_at,
      };
      // Cuenta nueva sin nada configurado → asistente inicial
      if (!s.onboarded && s.types === 0 && s.pending + s.confirmed === 0) {
        router.replace("/onboarding");
        return;
      }
      setStats(s);
    })();
  }, [q.done, router]);

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
  const progress: GuideProgress = {
    hasTypes: stats.types > 0,
    hasPhotos: stats.pending + stats.confirmed + q.total > 0,
    hasConfirmed: stats.confirmed > 0,
    pending: stats.pending,
  };
  const allDone = computeStates(progress).every((s) => s === "done");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="animate-in">
        <p className="text-sm font-medium text-slate-500">{greeting}</p>
        <h1 className="text-2xl font-bold tracking-tight text-ink md:text-3xl">{stats.business || "Tu inventario"}</h1>
      </header>

      {!allDone && <ProgressCard progress={progress} />}

      {/* Acciones principales */}
      <div className="grid gap-3">
        <Link
          href="/capture"
          className="animate-in group relative flex items-center gap-4 overflow-hidden rounded-3xl p-5 text-white shadow-float transition hover:brightness-110 active:scale-[0.99]"
          style={{ backgroundImage: "linear-gradient(135deg,#6366f1 0%,#8b5cf6 60%,#a855f7 100%)" }}
        >
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/20">
            <IconCamera size={30} />
          </span>
          <span className="flex-1">
            <span className="block text-lg font-bold">Agregar productos</span>
            <span className="block text-sm text-white/85">
              {working > 0 ? `Procesando ${working} foto${working > 1 ? "s" : ""}…` : "Con la cámara o desde tu galería"}
            </span>
          </span>
          <IconChevronRight className="text-white/70 transition group-hover:translate-x-0.5" />
        </Link>

        <BigLink href="/review" icon={<IconCheckCircle size={28} />} title="Revisar pendientes" subtitle={stats.pending ? "Confirma precio y stock" : "Todo revisado"} count={stats.pending} tone="amber" />
        <BigLink href="/products" icon={<IconBox size={28} />} title="Mi inventario" subtitle={`${stats.types} rubro${stats.types === 1 ? "" : "s"}`} count={stats.confirmed} tone="emerald" />
      </div>

      <div className="flex justify-center gap-4 text-sm">
        <Link href="/export" className="inline-flex items-center gap-1.5 font-medium text-slate-500 hover:text-brand-700">
          <IconDownload size={16} /> Exportar a Excel
        </Link>
        <Link href="/settings" className="inline-flex items-center gap-1.5 font-medium text-slate-500 hover:text-brand-700">
          <IconSettings size={16} /> Ajustes
        </Link>
      </div>

      <div id="guia" className="animate-in scroll-mt-20 pt-2">
        <StepByStep progress={progress} />
      </div>
    </div>
  );
}

function BigLink({ href, icon, title, subtitle, count, tone }: { href: string; icon: React.ReactNode; title: string; subtitle: string; count?: number; tone: "amber" | "emerald" }) {
  const tones = { amber: "bg-amber-100 text-amber-700", emerald: "bg-emerald-100 text-emerald-700" };
  return (
    <Link href={href} className="animate-in card group flex items-center gap-4 transition hover:ring-brand-300 active:scale-[0.99]">
      <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl ${tones[tone]}`}>{icon}</span>
      <span className="flex-1">
        <span className="block text-lg font-bold text-ink">{title}</span>
        <span className="block text-sm text-slate-500">{subtitle}</span>
      </span>
      <span className="text-2xl font-bold tabular-nums text-ink">{count ?? "–"}</span>
      <IconChevronRight className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-500" />
    </Link>
  );
}
