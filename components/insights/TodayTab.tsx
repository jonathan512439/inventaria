"use client";

import Link from "next/link";
import { money } from "@/lib/inventory";
import type { TodaySummary } from "@/lib/data/insights";
import { Stat } from "@/components/ui/Screen";

/** Texto del resumen para WhatsApp (sin ganancia si lo manda un vendedor). */
export function digestText(s: TodaySummary, business: string | null): string {
  const tz = { weekday: "long", day: "numeric", month: "long" } as const;
  const lines = [
    `*${business || "Mi negocio"} · resumen de hoy* (${new Date(s.day + "T12:00:00").toLocaleDateString("es", tz)})`,
    "",
    `💰 Vendido: ${money(s.today.total)} en ${s.today.count} venta${s.today.count === 1 ? "" : "s"} (ayer ${money(s.yesterday.total)})`,
    s.today.profit !== null ? `📈 Ganancia: ${money(s.today.profit)}` : "",
    s.out.count ? `🔴 Agotados: ${s.out.names.join(", ")}${s.out.count > s.out.names.length ? ` y ${s.out.count - s.out.names.length} más` : ""}` : "✅ Sin agotados",
    s.restock.products ? `🟠 Por reponer: ${s.restock.products} producto${s.restock.products === 1 ? "" : "s"}` : "",
    s.expiring.count ? `⏳ Por vencer: ${s.expiring.list.slice(0, 3).map((e) => `${e.name} (${e.days < 0 ? "vencido" : `${e.days} d`})`).join(", ")}${s.expiring.count > 3 ? ` y ${s.expiring.count - 3} más` : ""}` : "",
    s.debts.customers ? `💳 Te deben: ${money(s.debts.total)} (${s.debts.customers} cliente${s.debts.customers === 1 ? "" : "s"}${s.debts.old ? `, ${s.debts.old} desde hace +30 días` : ""})` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

/**
 * Números › Hoy (antes /digest): lo importante del día y **Enviar por WhatsApp** (2 toques desde «Más»).
 * Para todo el equipo; la ganancia solo la ve el dueño.
 */
export default function TodayTab({ s, business }: { s: TodaySummary; business: string | null }) {
  const text = digestText(s, business);
  return (
    <div className="space-y-3">
      <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" className="btn-success btn-lg animate-in w-full">
        Enviar resumen por WhatsApp
      </a>

      <div className="animate-in grid grid-cols-2 gap-2">
        <Stat label="Vendido hoy" value={money(s.today.total)} hint={`ayer ${money(s.yesterday.total)}`} tone="ok" />
        {s.today.profit !== null ? (
          <Stat label="Ganancia de hoy" value={money(s.today.profit)} hint={`ayer ${money(s.yesterday.profit ?? 0)}`} />
        ) : (
          <Stat label="Ventas de hoy" value={s.today.count} hint={`ayer ${s.yesterday.count}`} />
        )}
        <Link href="/products?filter=restock">
          <Stat label="Por reponer" value={s.restock.products} hint={s.out.count ? `${s.out.count} agotado${s.out.count === 1 ? "" : "s"}` : "nada agotado"} tone={s.restock.out ? "danger" : s.restock.products ? "warn" : undefined} />
        </Link>
        <Link href="/customers?filter=debt">
          <Stat label="Te deben" value={money(s.debts.total)} hint={s.debts.old ? `${s.debts.old} con más de 30 días` : `${s.debts.customers} cliente${s.debts.customers === 1 ? "" : "s"}`} tone={s.debts.old ? "warn" : undefined} />
        </Link>
      </div>

      {s.expiring.count > 0 && (
        <section className="animate-in card p-3">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-sm font-bold text-ink">Por vencer</h2>
            <Link href="/products?filter=expiring" className="text-sm font-semibold text-brand-700">Ver todos →</Link>
          </div>
          <ul className="divide-y divide-slate-100 text-sm">
            {s.expiring.list.map((e) => (
              <li key={e.id}>
                <Link href={`/products/${e.id}`} className="flex min-h-[44px] items-center gap-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{e.name}</span>
                  <span className={`text-xs font-bold ${e.days < 0 ? "text-danger-700" : "text-warn-700"}`}>{e.days < 0 ? "vencido" : e.days === 0 ? "hoy" : `${e.days} d`}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {s.debts.old_list.length > 0 && (
        <section className="animate-in card p-3">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-sm font-bold text-ink">Deben hace más de 30 días</h2>
            <Link href="/customers?filter=debt" className="text-sm font-semibold text-brand-700">Cobrar →</Link>
          </div>
          <ul className="divide-y divide-slate-100 text-sm">
            {s.debts.old_list.map((d) => (
              <li key={d.name + d.customer_id}>
                <Link href={d.customer_id ? `/customers/detail?id=${d.customer_id}` : "/customers?filter=debt"} className="flex min-h-[44px] items-center gap-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{d.name}</span>
                  <span className="text-xs text-muted">{d.days} d</span>
                  <span className="font-bold tabular-nums text-warn-700">{money(Number(d.amount))}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="animate-in">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Así llega el mensaje</p>
        <pre className="whitespace-pre-wrap rounded-2xl bg-slate-50 p-3 font-mono text-xs leading-snug text-slate-700">{text}</pre>
      </section>
    </div>
  );
}
