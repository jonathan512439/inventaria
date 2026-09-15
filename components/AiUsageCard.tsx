"use client";

import { useEffect, useState } from "react";
import type { ModelUsage } from "@/lib/aiUsage";
import { IconRefresh, IconSparkles } from "./ui/Icons";
import { Skeleton } from "./ui/Skeleton";

interface UsageData {
  models: ModelUsage[];
  resetAt: string;
  totalToday: number;
  ownKey?: boolean;
}

/** Medidor de consumo de IA de hoy, por modelo, con barras y cupo restante. */
export default function AiUsageCard() {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  async function adjust(model: string, name: string, used: number) {
    const raw = prompt(`Consumo real de hoy para ${name} (peticiones usadas). Útil si usaste la clave fuera de la app.`, String(used));
    if (raw === null) return;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0) return;
    setLoading(true);
    const res = await fetch("/api/usage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, used: n }) });
    if (res.ok) setData((await res.json()) as UsageData);
    setLoading(false);
  }

  async function load() {
    setLoading(true);
    const res = await fetch("/api/usage", { cache: "no-store" });
    if (res.ok) setData((await res.json()) as UsageData);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  const totalLimit = data?.models.reduce((s, m) => s + m.limit, 0) ?? 0;
  const totalUsed = data?.models.reduce((s, m) => s + Math.min(m.used, m.limit), 0) ?? 0;
  const totalRemaining = Math.max(0, totalLimit - totalUsed);
  const pct = totalLimit ? Math.round((totalUsed / totalLimit) * 100) : 0;
  const resetLabel = data ? new Date(data.resetAt).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }) : "";
  const tone = pct >= 90 ? "rose" : pct >= 60 ? "amber" : "emerald";
  const tones = {
    emerald: { bar: "linear-gradient(90deg,#10b981,#34d399)", text: "text-emerald-700", chip: "bg-emerald-100 text-emerald-800" },
    amber: { bar: "linear-gradient(90deg,#f59e0b,#fbbf24)", text: "text-amber-700", chip: "bg-amber-100 text-amber-800" },
    rose: { bar: "linear-gradient(90deg,#f43f5e,#fb7185)", text: "text-rose-700", chip: "bg-rose-100 text-rose-800" },
  }[tone];

  return (
    <section className="animate-in overflow-hidden rounded-3xl bg-ink text-white shadow-float ring-1 ring-white/10">
      {/* Resumen */}
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-white/60">
              <IconSparkles size={14} className="text-amber-300" /> Consumo de IA hoy
              {data?.ownKey && <span className="rounded-full bg-emerald-500/25 px-2 py-0.5 text-[10px] normal-case tracking-normal text-emerald-200">con tu clave propia</span>}
            </p>
            {loading || !data ? (
              <Skeleton className="mt-2 h-8 w-40 bg-white/10" />
            ) : (
              <p className="mt-1 text-3xl font-bold tabular-nums">
                {totalRemaining} <span className="text-base font-medium text-white/60">análisis disponibles</span>
              </p>
            )}
          </div>
          <button onClick={load} className="rounded-full bg-white/10 p-2 text-white/80 hover:bg-white/20" title="Actualizar" aria-label="Actualizar">
            <IconRefresh size={16} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        {/* Barra total */}
        <div className="mt-3">
          <div className="h-3 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundImage: tones.bar }} />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-xs text-white/60">
            <span>
              Usados <b className="text-white">{totalUsed}</b> de <b className="text-white">{totalLimit}</b> ({pct}%)
            </span>
            <span>Se renueva a las <b className="text-white">{resetLabel}</b></span>
          </div>
          {!data?.ownKey && (
            <p className="mt-2 text-[11px] text-white/60">
              Este cupo lo comparten todos los usuarios de la app. <a href="/settings#ia" className="font-semibold text-brand-200 hover:text-white">Usa tu propia clave</a> para tener el tuyo.
            </p>
          )}
        </div>

        <button onClick={() => setOpen((v) => !v)} className="mt-3 text-xs font-semibold text-brand-200 hover:text-white">
          {open ? "Ocultar detalle por modelo ▴" : "Ver detalle por modelo ▾"}
        </button>
      </div>

      {/* Detalle por modelo */}
      {open && data && (
        <ul className="stagger space-y-2 border-t border-white/10 bg-white/5 p-4">
          {data.models.map((m) => {
            const p = m.limit ? Math.min(100, Math.round((m.used / m.limit) * 100)) : 0;
            const state = m.exhausted ? "agotado" : m.used > 0 ? "en uso" : "disponible";
            const bar = m.exhausted ? "linear-gradient(90deg,#f43f5e,#fb7185)" : p >= 60 ? "linear-gradient(90deg,#f59e0b,#fbbf24)" : "linear-gradient(90deg,#6366f1,#a78bfa)";
            const chip = m.exhausted ? "bg-rose-500/20 text-rose-200" : m.used > 0 ? "bg-brand-500/30 text-brand-100" : "bg-emerald-500/20 text-emerald-200";
            return (
              <li key={m.model} className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
                <div className="flex items-center gap-2">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-bold">{m.order}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{m.name}</span>
                    <span className="block truncate text-[11px] text-white/50">{m.hint}</span>
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${chip}`}>{state}</span>
                  <button onClick={() => adjust(m.model, m.name, m.used)} className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/70 hover:bg-white/20" title="Ajustar consumo manualmente">
                    ajustar
                  </button>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full transition-all duration-700" style={{ width: `${m.exhausted ? 100 : p}%`, backgroundImage: bar }} />
                </div>
                <div className="mt-1 flex justify-between text-[11px] text-white/60">
                  <span>
                    Usados <b className="text-white">{m.used}</b> / {m.limit}
                  </span>
                  <span>
                    Restan <b className={m.exhausted ? "text-rose-200" : "text-emerald-200"}>{m.exhausted ? 0 : m.remaining}</b>
                  </span>
                </div>
              </li>
            );
          })}
          <li className="pt-1">
            <a href="/scan" className="flex items-center gap-2 rounded-2xl bg-emerald-500/15 px-3 py-2 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-500/25">
              💡 ¿Productos con código de barras? Escanéalos: no consumen cupo.
            </a>
          </li>
          <li className="pt-1 text-[11px] leading-snug text-white/50">
            El cupo gratuito es por modelo y por día; la app usa el siguiente modelo cuando uno se agota. El conteo es de toda la app; si usas la misma clave
            fuera de la app, corrígelo con “ajustar”.
          </li>
        </ul>
      )}
    </section>
  );
}
