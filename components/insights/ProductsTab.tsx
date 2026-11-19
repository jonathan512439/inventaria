"use client";

import Link from "next/link";
import { money } from "@/lib/inventory";
import { categoryColor } from "@/lib/colors";
import { PERIOD_LABEL, type InsightsReport } from "@/lib/data/insights";
import { Stat } from "@/components/ui/Screen";
import { IconChevronRight } from "@/components/ui/Icons";

/**
 * Números › Productos (antes /reports «Lo que se mueve», «Ganancia», «Lo que tengo»): más vendidos, parados,
 * ganancia por categoría y cuánto vale lo que tienes (también por categoría, antes en los estantes).
 */
export default function ProductsTab({ r, restockIds, restock, expiring }: { r: InsightsReport; restockIds: Set<string>; restock: number; expiring: number }) {
  const p = r.period;
  return (
    <div className="space-y-3">
      <div className="animate-in grid grid-cols-3 gap-2">
        <Stat label="Vale (venta)" value={money(r.inventory.sale)} hint={`${r.inventory.units} unid.`} />
        <Stat label="Te costó" value={money(r.inventory.cost)} hint={r.inventory.cost ? "según costos" : "sin costos"} />
        <Stat label="Si vendes todo" value={money(r.inventory.sale - r.inventory.cost)} hint="ganancia a hoy" tone="ok" />
      </div>
      <div className="animate-in grid grid-cols-3 gap-2">
        <Link href="/products?filter=restock"><Stat label="Por reponer" value={restock} tone={restock ? "warn" : undefined} /></Link>
        <Link href="/products?filter=expiring"><Stat label="Por vencer" value={expiring} tone={expiring ? "warn" : undefined} /></Link>
        <a href="#parados"><Stat label="Parados" value={r.dead.count} hint={money(r.dead.value)} /></a>
      </div>

      <section className="animate-in card p-3">
        <h2 className="mb-1 text-sm font-bold text-ink">Los más vendidos ({PERIOD_LABEL[p]})</h2>
        <p className="mb-2 text-xs text-muted">Los que conviene tener siempre. Si alguno está por reponer, pídelo primero.</p>
        {r.top_units.length === 0 ? (
          <p className="text-sm text-muted">Sin ventas en este periodo.</p>
        ) : (
          <ol className="space-y-1">
            {r.top_units.map((x, i) => {
              const low = !!x.product_id && restockIds.has(x.product_id);
              return (
                <li key={(x.product_id ?? x.name) + i}>
                  <Link href={x.product_id ? `/products/${x.product_id}` : "#"} className="flex min-h-[44px] items-center gap-3 text-sm">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-800">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-ink">{x.name}</span>
                      <span className="block text-xs text-muted">
                        {x.stock !== null ? `${x.stock} en stock` : "ya no está"}
                        {low && <span className="font-semibold text-warn-700"> · por reponer</span>}
                      </span>
                    </span>
                    <span className="font-bold tabular-nums">{x.units} unid.</span>
                    <span className="hidden w-20 text-right text-xs tabular-nums text-muted sm:block">{money(Number(x.revenue))}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section id="parados" className="animate-in card scroll-mt-20 p-3">
        <h2 className="mb-1 text-sm font-bold text-ink">Parados: con stock y sin venderse hace 60 días</h2>
        <p className="mb-2 text-xs text-muted">
          Dinero quieto en el estante: {money(r.dead.value)} en {r.dead.count} producto{r.dead.count === 1 ? "" : "s"}. Ofértalos, muévelos de sitio o deja de reponerlos.
        </p>
        {r.dead.count === 0 ? (
          <p className="text-sm text-ok-800">Todo lo que tienes se vendió en los últimos 60 días. 🎉</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {r.dead.list.map((d) => (
              <li key={d.id}>
                <Link href={`/products/${d.id}`} className="flex min-h-[48px] items-center gap-3 py-1.5 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{d.name}</span>
                    <span className="block text-xs text-muted">{d.stock} unid. · {d.last_sale ? `última venta ${new Date(d.last_sale).toLocaleDateString("es", { day: "2-digit", month: "short" })}` : "nunca vendido"}</span>
                  </span>
                  <span className="font-bold tabular-nums text-slate-700">{money(Number(d.value))}</span>
                </Link>
              </li>
            ))}
            {r.dead.count > r.dead.list.length && <li className="py-2 text-center text-xs text-muted">y {r.dead.count - r.dead.list.length} más</li>}
          </ul>
        )}
      </section>

      <section className="animate-in card p-3">
        <h2 className="mb-1 text-sm font-bold text-ink">Ganancia por categoría ({PERIOD_LABEL[p]})</h2>
        <p className="mb-2 text-xs text-muted">Vendido − lo que te costó. Si una categoría no tiene costo anotado, la ganancia sale inflada: anota las entradas con su costo.</p>
        {r.margins.length === 0 ? (
          <p className="text-sm text-muted">Sin ventas en este periodo.</p>
        ) : (
          <ul className="space-y-2">
            {r.margins.map((m) => {
              const col = categoryColor(m.name);
              const pct = Number(m.revenue) ? Math.round((Number(m.profit) / Number(m.revenue)) * 100) : 0;
              return (
                <li key={m.id ?? "none"} className="rounded-2xl bg-slate-50 p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl text-base ring-1 ${col.bg} ${col.ring}`}>{m.icon || "🏷️"}</span>
                    <span className="min-w-0 flex-1 truncate font-semibold text-ink">{m.name}</span>
                    <span className="font-bold tabular-nums text-ok-700">{money(Number(m.profit))}</span>
                    <span className={`badge ${pct >= 30 ? "bg-ok-100 text-ok-800" : pct >= 15 ? "bg-warn-100 text-warn-800" : "bg-danger-100 text-danger-700"}`}>{pct} %</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
                    <div className="h-full rounded-full bg-ok-500" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-muted">vendido {money(Number(m.revenue))} · costó {money(Number(m.cost))} · {m.units} unid.</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {r.by_category.length > 0 && (
        <section className="animate-in card p-3">
          <h2 className="mb-2 text-sm font-bold text-ink">Lo que tienes, por categoría</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {r.by_category.map((c) => (
              <li key={c.id ?? "none"}>
                <Link href={`/products?category=${c.id ?? "none"}`} className="flex min-h-[48px] items-center gap-2 py-1.5">
                  <span className="text-base">{c.icon || "🏷️"}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{c.name}</span>
                  <span className="text-xs text-muted">{c.units} unid.</span>
                  <span className="font-bold tabular-nums">{money(Number(c.sale))}</span>
                  <IconChevronRight size={16} className="shrink-0 text-slate-300" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
