"use client";

import Link from "next/link";
import { fmtMoney, money } from "@/lib/inventory";
import { PERIOD_LABEL, PREV_LABEL, type InsightsReport } from "@/lib/data/insights";
import { EmptyState } from "@/components/ui/Screen";

const delta = (a: number, b: number) => (b === 0 ? null : Math.round(((a - b) / b) * 100));

function Kpi({ label, value, d, sub, strong }: { label: string; value: string; d: number | null; sub: string; strong?: boolean }) {
  return (
    <div className={`rounded-3xl p-3 shadow-card ring-1 ${strong ? "bg-ok-600 text-white ring-ok-600" : "bg-white ring-slate-900/10"}`}>
      <p className={`text-xs font-semibold uppercase tracking-wide ${strong ? "text-white/80" : "text-muted"}`}>{label}</p>
      <p className="text-lg font-bold tabular-nums leading-tight sm:text-xl">{value}</p>
      {d !== null && <p className={`text-xs font-bold ${strong ? "text-white" : d >= 0 ? "text-ok-700" : "text-danger-700"}`}>{d >= 0 ? "▲" : "▼"} {Math.abs(d)} %</p>}
      <p className={`truncate text-xs ${strong ? "text-white/80" : "text-muted"}`}>{sub}</p>
    </div>
  );
}

/** Números › Ventas (antes /reports «Ventas» + mejores clientes): comparativo, últimos 14 días, lo que más deja. */
export default function SalesTab({ r }: { r: InsightsReport }) {
  const p = r.period;
  const max = Math.max(1, ...r.per_day.map((d) => Number(d.total)));
  return (
    <div className="space-y-3">
      <div className="animate-in grid grid-cols-3 gap-2">
        <Kpi strong label="Vendido" value={money(r.now.total)} d={delta(r.now.total, r.prev.total)} sub={`${PREV_LABEL[p]}: ${money(r.prev.total)}`} />
        <Kpi label="Ganancia" value={money(r.now.profit)} d={delta(r.now.profit, r.prev.profit)} sub={`antes: ${money(r.prev.profit)}`} />
        <Kpi label="Ventas" value={String(r.now.count)} d={delta(r.now.count, r.prev.count)} sub={`antes: ${r.prev.count}`} />
      </div>

      <section className="animate-in card p-4">
        <h2 className="text-sm font-bold text-ink">Últimos 14 días</h2>
        <p className="text-xs text-muted">Cuánto vendiste cada día.</p>
        <div className="mt-3 flex h-36 items-end gap-1" role="img" aria-label="Ventas de los últimos 14 días">
          {r.per_day.map((d) => {
            const label = new Date(d.day + "T12:00:00").toLocaleDateString("es", { weekday: "short" }).slice(0, 2);
            return (
              <div key={d.day} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${new Date(d.day + "T12:00:00").toLocaleDateString("es")}: ${money(Number(d.total))} en ${d.count} venta(s)`}>
                <span className="text-xs tabular-nums text-muted">{Number(d.total) ? fmtMoney(Number(d.total)) : ""}</span>
                <div className="w-full rounded-t-md bg-ok-500/80" style={{ height: `${Math.max(2, (Number(d.total) / max) * 100)}%` }} />
                <span className="text-xs text-muted">{label}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="animate-in card p-3">
        <h2 className="mb-2 text-sm font-bold text-ink">Lo que más dinero deja ({PERIOD_LABEL[p]})</h2>
        {r.top_profit.length === 0 ? (
          <p className="text-sm text-muted">Sin ventas en este periodo.</p>
        ) : (
          <ol className="space-y-1">
            {r.top_profit.map((x, i) => (
              <li key={(x.product_id ?? x.name) + i}>
                <Link href={x.product_id ? `/products/${x.product_id}` : "#"} className="flex min-h-[44px] items-center gap-3 text-sm">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ok-100 text-xs font-bold text-ok-800">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{x.name}</span>
                  <span className="text-xs text-muted">{x.units} unid.</span>
                  <span className="font-bold tabular-nums text-ok-700">{money(Number(x.profit))}</span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="animate-in card p-3">
        <h2 className="mb-2 text-sm font-bold text-ink">Mejores clientes ({PERIOD_LABEL[p]})</h2>
        {r.top_customers.length === 0 ? (
          <EmptyState title="Sin ventas con cliente" body="Al vender, elige el cliente en la hoja Cobrar para saber quién te compra más." />
        ) : (
          <ol className="space-y-1">
            {r.top_customers.map((c, i) => (
              <li key={c.id}>
                <Link href={`/customers/detail?id=${c.id}`} className="flex min-h-[44px] items-center gap-3 text-sm">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-800">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{c.name}</span>
                  <span className="text-xs text-muted">{c.count} compra{c.count === 1 ? "" : "s"}</span>
                  <span className="font-bold tabular-nums text-ink">{money(Number(c.total))}</span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
