"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Category, Product, Sale, SaleItem } from "@/types/database";
import { SUMMARY_COLS, fmtMoney, fromSummary, expiringSoon, needsRestock, stockOf } from "@/lib/inventory";
import { deadStock, inventoryValue, marginByCategory, periodStart, previousRange, salesByProduct, salesPerDay, type Period } from "@/lib/reports";
import { categoryPath } from "@/lib/categories";
import { categoryColor } from "@/lib/colors";
import { useFlow } from "@/components/FlowProvider";
import CoachTip from "@/components/CoachTip";
import OwnerOnly from "@/components/OwnerOnly";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { IconArrowLeft, IconChevronRight } from "@/components/ui/Icons";

type Tab = "ventas" | "rotacion" | "margen" | "inventario";

/** Reportes: qué se vende, qué no, cuánto ganas por categoría y cuánto vale lo que tienes. */
export default function ReportsPage() {
  const supabase = createClient();
  const { alerts } = useFlow();
  const [period, setPeriod] = useState<Period>("mes");
  const [tab, setTab] = useState<Tab>("ventas");
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [items, setItems] = useState<SaleItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - 180 * 86400000).toISOString();
      const [p, c, s, i] = await Promise.all([
        supabase.from("product_summaries").select(SUMMARY_COLS).eq("status", "confirmed"),
        supabase.from("categories").select("*"),
        supabase.from("sales").select("*").gte("created_at", since).order("created_at", { ascending: false }).limit(3000),
        supabase.from("sale_items").select("*").gte("created_at", since).order("created_at", { ascending: false }).limit(6000),
      ]);
      setProducts((p.data ?? []).map(fromSummary));
      setCategories(c.data ?? []);
      setSales((s.data ?? []) as Sale[]);
      setItems((i.data ?? []) as SaleItem[]);
      setLoading(false);
    })();
  }, [supabase]);

  const start = periodStart(period);
  const prev = previousRange(period);
  const salesIn = useMemo(() => sales.filter((s) => new Date(s.created_at) >= start), [sales, start]);
  const salesPrev = useMemo(() => sales.filter((s) => new Date(s.created_at) >= prev.start && new Date(s.created_at) < prev.end), [sales, prev.start, prev.end]);
  const itemsIn = useMemo(() => items.filter((i) => new Date(i.created_at) >= start), [items, start]);

  const sum = (list: Sale[]) => ({ total: list.reduce((a, s) => a + Number(s.total), 0), profit: list.reduce((a, s) => a + Number(s.total) - Number(s.cost_total), 0), count: list.length });
  const now = sum(salesIn);
  const before = sum(salesPrev);
  const delta = (a: number, b: number) => (b === 0 ? null : Math.round(((a - b) / b) * 100));

  const byProduct = useMemo(() => salesByProduct(itemsIn), [itemsIn]);
  const top = [...byProduct].sort((a, b) => b.units - a.units).slice(0, 10);
  const topProfit = [...byProduct].sort((a, b) => b.profit - a.profit).slice(0, 5);
  const dead = useMemo(() => deadStock(products, items, 60), [products, items]);
  const margins = useMemo(() => marginByCategory(itemsIn, products, categories), [itemsIn, products, categories]);
  const value = useMemo(() => inventoryValue(products), [products]);
  const perDay = useMemo(() => salesPerDay(sales, 14), [sales]);
  const maxDay = Math.max(1, ...perDay.map((d) => d.total));
  const restock = products.filter((p) => needsRestock(p, categories, alerts)).length;
  const expiring = products.filter((p) => expiringSoon(p, alerts, categories)).length;
  const periodLabel = { "7d": "últimos 7 días", mes: "este mes", "90d": "últimos 90 días" }[period];
  const prevLabel = { "7d": "7 días anteriores", mes: "mes anterior", "90d": "90 días anteriores" }[period];

  return (
    <OwnerOnly>
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="animate-in">
        <Link href="/dashboard" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"><IconArrowLeft size={16} /> Inicio</Link>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Cómo va el negocio</h1>
        <p className="text-sm text-slate-500">Qué se vende, qué no se mueve, cuánto ganas y cuánto vale lo que tienes.</p>
      </header>
      <CoachTip screen="reports" title="Para decidir, no para llenar planillas">
        Empieza por <b>Ventas</b> (cómo va contra el periodo anterior), sigue con <b>Lo que se mueve</b> (qué reponer y qué está parado) y <b>Ganancia</b> (dónde ganas más).
      </CoachTip>

      <div className="animate-in flex flex-wrap gap-2">
        {(["7d", "mes", "90d"] as Period[]).map((p) => (
          <button key={p} onClick={() => setPeriod(p)} className={`chip ${period === p ? "chip-active" : ""}`}>{{ "7d": "7 días", mes: "Este mes", "90d": "90 días" }[p]}</button>
        ))}
      </div>
      <div className="animate-in grid grid-cols-4 gap-1 rounded-2xl bg-slate-100 p-1 text-xs sm:text-sm">
        {([["ventas", "Ventas"], ["rotacion", "Lo que se mueve"], ["margen", "Ganancia"], ["inventario", "Lo que tengo"]] as [Tab, string][]).map(([k, t]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-xl px-1 py-2 font-semibold ${tab === k ? "bg-white text-ink shadow" : "text-slate-500"}`}>{t}</button>
        ))}
      </div>

      {loading ? (
        <ListSkeleton rows={5} />
      ) : tab === "ventas" ? (
        <div className="space-y-3">
          <div className="animate-in grid grid-cols-3 gap-2">
            <Kpi label={`Vendido ${periodLabel}`} value={`Bs ${fmtMoney(now.total)}`} delta={delta(now.total, before.total)} sub={`${prevLabel}: Bs ${fmtMoney(before.total)}`} tone="emerald" />
            <Kpi label="Ganancia" value={`Bs ${fmtMoney(now.profit)}`} delta={delta(now.profit, before.profit)} sub={`antes: Bs ${fmtMoney(before.profit)}`} />
            <Kpi label="Ventas" value={String(now.count)} delta={delta(now.count, before.count)} sub={`antes: ${before.count}`} />
          </div>
          <section className="animate-in card p-4">
            <h2 className="text-sm font-bold text-ink">Últimos 14 días</h2>
            <p className="text-xs text-slate-500">Cuánto vendiste cada día.</p>
            <div className="mt-3 flex h-36 items-end gap-1">
              {perDay.map((d) => (
                <div key={d.day} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${new Date(d.day + "T00:00:00").toLocaleDateString("es")}: Bs ${fmtMoney(d.total)} en ${d.count} venta(s)`}>
                  <span className="text-[9px] tabular-nums text-slate-500">{d.total ? fmtMoney(d.total) : ""}</span>
                  <div className="w-full rounded-t-md bg-emerald-500/80" style={{ height: `${Math.max(2, (d.total / maxDay) * 100)}%` }} />
                  <span className="text-[10px] text-slate-400">{d.label}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="animate-in card p-3">
            <h2 className="mb-2 text-sm font-bold text-ink">Lo que más dinero deja ({periodLabel})</h2>
            {topProfit.length === 0 ? <p className="text-sm text-slate-500">Sin ventas en este periodo.</p> : (
              <ol className="space-y-1.5">
                {topProfit.map((r, i) => (
                  <li key={r.product_id} className="flex items-center gap-3 text-sm">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-medium text-ink">{r.name}</span>
                    <span className="text-xs text-slate-500">{r.units} unid.</span>
                    <span className="font-bold tabular-nums text-emerald-700">Bs {fmtMoney(r.profit)}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      ) : tab === "rotacion" ? (
        <div className="space-y-3">
          <section className="animate-in card p-3">
            <h2 className="mb-1 text-sm font-bold text-ink">Los más vendidos ({periodLabel})</h2>
            <p className="mb-2 text-xs text-slate-500">Los que conviene tener siempre. Si alguno está por reponer, pídelo primero.</p>
            {top.length === 0 ? <p className="text-sm text-slate-500">Sin ventas en este periodo.</p> : (
              <ol className="space-y-1.5">
                {top.map((r, i) => {
                  const p = products.find((x) => x.id === r.product_id);
                  const low = p ? needsRestock(p, categories, alerts) : false;
                  return (
                    <li key={r.product_id} className="flex items-center gap-3 text-sm">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-800">{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <Link href={p ? `/products/${p.id}` : "#"} className="block truncate font-medium text-ink hover:text-brand-700">{r.name}</Link>
                        <span className="block text-[11px] text-slate-500">{p ? `${stockOf(p) ?? 0} en stock` : ""}{low ? <span className="font-semibold text-orange-700"> · por reponer</span> : ""}</span>
                      </span>
                      <span className="font-bold tabular-nums">{r.units} unid.</span>
                      <span className="w-20 text-right text-xs tabular-nums text-slate-500">Bs {fmtMoney(r.revenue)}</span>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
          <section className="animate-in card p-3">
            <h2 className="mb-1 text-sm font-bold text-ink">Parado: con stock y sin venderse hace 60 días</h2>
            <p className="mb-2 text-xs text-slate-500">Dinero quieto en el estante: Bs {fmtMoney(dead.reduce((a, r) => a + r.value, 0))} en {dead.length} producto{dead.length === 1 ? "" : "s"}. Ofértalos, muévelos de sitio o deja de reponerlos.</p>
            {dead.length === 0 ? <p className="text-sm text-emerald-800">Todo lo que tienes se ha vendido en los últimos 60 días. 🎉</p> : (
              <ul className="divide-y divide-slate-100">
                {dead.slice(0, 15).map((r) => (
                  <li key={r.product.id} className="flex items-center gap-3 py-1.5 text-sm">
                    <Link href={`/products/${r.product.id}`} className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-ink">{String(r.product.data.nombre || "Sin nombre")}</span>
                      <span className="block text-[11px] text-slate-500">{categoryPath(categories, r.product.category_id) || "Sin categoría"} · {stockOf(r.product) ?? 0} unid. · {r.lastSale ? `última venta ${new Date(r.lastSale).toLocaleDateString("es", { day: "2-digit", month: "short" })}` : "nunca vendido"}</span>
                    </Link>
                    <span className="font-bold tabular-nums text-slate-700">Bs {fmtMoney(r.value)}</span>
                  </li>
                ))}
                {dead.length > 15 && <li className="py-2 text-center text-xs text-slate-500">y {dead.length - 15} más</li>}
              </ul>
            )}
          </section>
        </div>
      ) : tab === "margen" ? (
        <div className="space-y-3">
          <section className="animate-in card p-3">
            <h2 className="mb-1 text-sm font-bold text-ink">Ganancia por categoría ({periodLabel})</h2>
            <p className="mb-2 text-xs text-slate-500">Vendido − lo que te costó. Si una categoría no tiene precio de compra, la ganancia sale inflada: anota las compras.</p>
            {margins.length === 0 ? <p className="text-sm text-slate-500">Sin ventas en este periodo.</p> : (
              <ul className="space-y-2">
                {margins.map((m) => {
                  const col = categoryColor(m.category?.name);
                  const pct = m.revenue ? Math.round((m.profit / m.revenue) * 100) : 0;
                  return (
                    <li key={m.category?.id ?? "none"} className="rounded-2xl bg-slate-50 p-3">
                      <div className="flex items-center gap-2 text-sm">
                        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl text-base ring-1 ${col.bg} ${col.ring}`}>{m.category?.icon || "🏷️"}</span>
                        <span className="min-w-0 flex-1 truncate font-semibold text-ink">{m.category?.name ?? "Sin categoría"}</span>
                        <span className="font-bold tabular-nums text-emerald-700">Bs {fmtMoney(m.profit)}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${pct >= 30 ? "bg-emerald-100 text-emerald-800" : pct >= 15 ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-700"}`}>{pct} %</span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">vendido Bs {fmtMoney(m.revenue)} · costó Bs {fmtMoney(m.cost)} · {m.units} unid.</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="animate-in grid grid-cols-3 gap-2">
            <Kpi label="Vale a precio de venta" value={`Bs ${fmtMoney(value.sale)}`} sub={`${value.units} unidades`} tone="emerald" />
            <Kpi label="Te costó" value={`Bs ${fmtMoney(value.cost)}`} sub={value.cost ? "según precios de compra" : "sin costos anotados"} />
            <Kpi label="Ganancia si vendes todo" value={`Bs ${fmtMoney(value.sale - value.cost)}`} sub="a precios de hoy" />
          </div>
          <div className="animate-in grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Link href="/restock" className="press flex items-center gap-3 rounded-2xl bg-white p-3 shadow-card ring-1 ring-slate-900/10 hover:ring-orange-400">
              <span className="min-w-0 flex-1"><span className="block text-2xl font-bold tabular-nums text-orange-700">{restock}</span><span className="block text-xs text-slate-500">por reponer</span></span><IconChevronRight className="text-slate-300" />
            </Link>
            <Link href="/restock?tab=vencer" className="press flex items-center gap-3 rounded-2xl bg-white p-3 shadow-card ring-1 ring-slate-900/10 hover:ring-amber-400">
              <span className="min-w-0 flex-1"><span className="block text-2xl font-bold tabular-nums text-amber-700">{expiring}</span><span className="block text-xs text-slate-500">por vencer</span></span><IconChevronRight className="text-slate-300" />
            </Link>
            <button onClick={() => setTab("rotacion")} className="press flex items-center gap-3 rounded-2xl bg-white p-3 text-left shadow-card ring-1 ring-slate-900/10 hover:ring-slate-400">
              <span className="min-w-0 flex-1"><span className="block text-2xl font-bold tabular-nums text-slate-700">{dead.length}</span><span className="block text-xs text-slate-500">parados 60 días · Bs {fmtMoney(dead.reduce((a, r) => a + r.value, 0))}</span></span><IconChevronRight className="text-slate-300" />
            </button>
          </div>
          <section className="animate-in card p-3">
            <h2 className="mb-2 text-sm font-bold text-ink">Valor por categoría</h2>
            <ul className="divide-y divide-slate-100 text-sm">
              {categories.filter((c) => !c.parent_id).map((c) => {
                const ids = new Set(categories.filter((x) => x.id === c.id || x.parent_id === c.id).map((x) => x.id));
                const v = inventoryValue(products.filter((p) => p.category_id && ids.has(p.category_id)));
                if (!v.units) return null;
                return (
                  <li key={c.id} className="flex items-center gap-2 py-2">
                    <span className="text-base">{c.icon || "🏷️"}</span>
                    <span className="min-w-0 flex-1 truncate font-medium text-ink">{c.name}</span>
                    <span className="text-xs text-slate-500">{v.units} unid.</span>
                    <span className="font-bold tabular-nums">Bs {fmtMoney(v.sale)}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      )}
    </div>
    </OwnerOnly>
  );
}

function Kpi({ label, value, sub, delta, tone }: { label: string; value: string; sub?: string; delta?: number | null; tone?: "emerald" }) {
  return (
    <div className={`rounded-2xl p-3 shadow-card ring-1 ${tone === "emerald" ? "bg-emerald-600 text-white ring-emerald-600" : "bg-white ring-slate-900/10"}`}>
      <p className={`text-[10px] font-semibold uppercase tracking-wide ${tone === "emerald" ? "text-white/70" : "text-slate-500"}`}>{label}</p>
      <p className="text-lg font-bold tabular-nums leading-tight sm:text-xl">{value}</p>
      {delta !== undefined && delta !== null && (
        <p className={`text-[11px] font-bold ${tone === "emerald" ? "text-white/90" : delta >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{delta >= 0 ? "▲" : "▼"} {Math.abs(delta)} %</p>
      )}
      {sub && <p className={`truncate text-[10px] ${tone === "emerald" ? "text-white/70" : "text-slate-400"}`}>{sub}</p>}
    </div>
  );
}
