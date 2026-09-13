"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { queueSummary, useQueue } from "@/lib/queue";
import { IconBox, IconCamera, IconCheckCircle, IconChevronRight, IconDownload, IconSettings, IconSparkles } from "@/components/ui/Icons";

interface Stats {
  pending: number;
  confirmed: number;
  categories: number;
  business: string | null;
  fields: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const queue = useQueue();
  const q = queueSummary(queue.items);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const [d, c, cat, f, p] = await Promise.all([
        supabase.from("products").select("id", { count: "exact", head: true }).eq("status", "draft"),
        supabase.from("products").select("id", { count: "exact", head: true }).eq("status", "confirmed"),
        supabase.from("categories").select("id", { count: "exact", head: true }),
        supabase.from("field_templates").select("id", { count: "exact", head: true }),
        supabase.from("profiles").select("business_name").maybeSingle(),
      ]);
      setStats({
        pending: d.count ?? 0,
        confirmed: c.count ?? 0,
        categories: cat.count ?? 0,
        fields: f.count ?? 0,
        business: p.data?.business_name ?? null,
      });
    })();
  }, [q.done]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches";
  const firstTime = stats && stats.confirmed === 0 && stats.pending === 0 && q.total === 0;
  const working = q.queued + q.processing;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="animate-in">
        <p className="text-sm font-medium text-slate-500">{greeting}</p>
        <h1 className="text-2xl font-bold tracking-tight text-ink md:text-3xl">{stats?.business || "Tu inventario"}</h1>
      </header>

      {firstTime && (
        <div className="animate-in card overflow-hidden bg-gradient-to-br from-brand-600 to-violet-600 text-white ring-0">
          <div className="flex items-start gap-3">
            <IconSparkles size={28} className="mt-0.5 shrink-0 text-amber-300" />
            <div>
              <p className="text-lg font-semibold">Toma una foto y listo</p>
              <p className="mt-1 text-sm text-white/85">
                La IA reconoce el producto, lo describe y elige su sección. Tú solo confirmas el precio.
              </p>
            </div>
          </div>
          {stats.fields === 0 && (
            <Link href="/settings" className="mt-4 inline-flex items-center gap-1 rounded-xl bg-white/15 px-3 py-2 text-sm font-semibold hover:bg-white/25">
              Preparar mi tienda en 1 minuto <IconChevronRight size={16} />
            </Link>
          )}
        </div>
      )}

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

        <BigLink
          href="/review"
          icon={<IconCheckCircle size={28} />}
          title="Revisar pendientes"
          subtitle={stats ? (stats.pending ? "Confirma precio y stock" : "Todo revisado") : " "}
          count={stats?.pending}
          tone="amber"
        />
        <BigLink
          href="/products"
          icon={<IconBox size={28} />}
          title="Mi inventario"
          subtitle={stats ? `${stats.categories} secci${stats.categories === 1 ? "ón" : "ones"}` : " "}
          count={stats?.confirmed}
          tone="emerald"
        />
      </div>

      <div className="flex justify-center gap-4 pt-2 text-sm">
        <Link href="/export" className="inline-flex items-center gap-1.5 font-medium text-slate-500 hover:text-brand-700">
          <IconDownload size={16} /> Exportar a Excel
        </Link>
        <Link href="/settings" className="inline-flex items-center gap-1.5 font-medium text-slate-500 hover:text-brand-700">
          <IconSettings size={16} /> Ajustes
        </Link>
      </div>
    </div>
  );
}

function BigLink({
  href,
  icon,
  title,
  subtitle,
  count,
  tone,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  count?: number;
  tone: "amber" | "emerald";
}) {
  const tones = {
    amber: "bg-amber-100 text-amber-700",
    emerald: "bg-emerald-100 text-emerald-700",
  };
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
