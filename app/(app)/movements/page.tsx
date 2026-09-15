"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { MovementType, Sale, SaleItem, StockMovement } from "@/types/database";
import { METHOD_LABEL, STATUS_LABEL } from "@/lib/sales";
import { fmtMoney } from "@/lib/inventory";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { IconArrowLeft, IconChevronRight } from "@/components/ui/Icons";

type Tab = "venta" | "entrada" | "salida" | "todos";
type Range = "hoy" | "7d" | "mes" | "todo";

const LABEL: Record<MovementType, { t: string; c: string; sign: string }> = {
  venta: { t: "Venta", c: "bg-emerald-100 text-emerald-800", sign: "−" },
  entrada: { t: "Entrada", c: "bg-brand-100 text-brand-800", sign: "+" },
  salida: { t: "Retiro", c: "bg-slate-200 text-slate-700", sign: "−" },
  ajuste: { t: "Ajuste", c: "bg-amber-100 text-amber-800", sign: "±" },
};

function rangeStart(r: Range): Date | null {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (r === "hoy") return d;
  if (r === "7d") return new Date(d.getTime() - 6 * 86400000);
  if (r === "mes") return new Date(d.getFullYear(), d.getMonth(), 1);
  return null;
}

/** Resumen de ventas y movimientos de stock. */
export default function MovementsPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<StockMovement[]>([]);
  const [tickets, setTickets] = useState<Sale[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [items, setItems] = useState<Record<string, SaleItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("venta");
  const [range, setRange] = useState<Range>("mes");

  useEffect(() => {
    Promise.all([
      supabase.from("stock_movements").select("*").order("created_at", { ascending: false }).limit(1000),
      supabase.from("sales").select("*").order("created_at", { ascending: false }).limit(500),
    ]).then(([m, s]) => {
      setRows((m.data ?? []) as StockMovement[]);
      setTickets((s.data ?? []) as Sale[]);
      setLoading(false);
    });
  }, [supabase]);

  async function toggleTicket(id: string) {
    if (open === id) return setOpen(null);
    setOpen(id);
    if (!items[id]) {
      const { data } = await supabase.from("sale_items").select("*").eq("sale_id", id).order("created_at");
      setItems((m) => ({ ...m, [id]: (data ?? []) as SaleItem[] }));
    }
  }

  const start = rangeStart(range);
  const inRange = useMemo(() => (start ? rows.filter((r) => new Date(r.created_at) >= start) : rows), [rows, start]);
  const ticketsInRange = useMemo(() => (start ? tickets.filter((t) => new Date(t.created_at) >= start) : tickets), [tickets, start]);
  const list = tab === "todos" ? inRange : inRange.filter((r) => r.tipo === tab);

  // Ventas: los tickets + las ventas rápidas hechas sin conexión (movimiento sin ticket)
  const sales = inRange.filter((r) => r.tipo === "venta");
  const looseSales = sales.filter((r) => !r.sale_id);
  const ingresos = ticketsInRange.reduce((s, t) => s + Number(t.total), 0) + looseSales.reduce((s, r) => s + (r.total ?? 0), 0);
  const ganancia = ticketsInRange.reduce((s, t) => s + (Number(t.total) - Number(t.cost_total)), 0);
  const pendienteCobro = ticketsInRange.filter((t) => t.status !== "pagado").reduce((s, t) => s + (Number(t.total) - Number(t.paid)), 0);
  const unidadesVendidas = sales.reduce((s, r) => s + r.cantidad, 0);
  const entradas = inRange.filter((r) => r.tipo === "entrada").reduce((s, r) => s + r.cantidad, 0);
  const retiros = inRange.filter((r) => r.tipo === "salida").reduce((s, r) => s + r.cantidad, 0);

  // Más vendido del periodo
  const byProduct = new Map<string, { name: string; qty: number; total: number }>();
  sales.forEach((r) => {
    const k = (r.product_id ?? r.product_name ?? "?") + (r.variant_id ? `#${r.variant_id}` : "");
    const cur = byProduct.get(k) ?? { name: (r.product_name ?? "Producto") + (r.variant_label ? ` · ${r.variant_label}` : ""), qty: 0, total: 0 };
    cur.qty += r.cantidad;
    cur.total += r.total ?? 0;
    byProduct.set(k, cur);
  });
  const top = Array.from(byProduct.entries()).sort((a, b) => b[1].total - a[1].total).slice(0, 5);

  const RANGES: { k: Range; t: string }[] = [{ k: "hoy", t: "Hoy" }, { k: "7d", t: "7 días" }, { k: "mes", t: "Este mes" }, { k: "todo", t: "Todo" }];
  const TABS: { k: Tab; t: string }[] = [{ k: "venta", t: "Ventas" }, { k: "entrada", t: "Entradas" }, { k: "salida", t: "Retiros" }, { k: "todos", t: "Todo" }];

  return (
    <div className="w-full space-y-5">
      <header className="animate-in">
        <Link href="/products" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"><IconArrowLeft size={16} /> Mi inventario</Link>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink">Ventas y movimientos</h1>
            <p className="text-sm text-slate-500">Lo que vendiste, lo que entró y lo que salió del negocio.</p>
          </div>
          <div className="flex gap-2">
            <Link href="/sell" className="btn-success btn-sm">Vender</Link>
            <Link href="/cash" className="btn-secondary btn-sm">Caja de hoy</Link>
          </div>
        </div>
      </header>

      <div className="animate-in flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <button key={r.k} onClick={() => setRange(r.k)} className={`chip ${range === r.k ? "chip-active" : ""}`}>{r.t}</button>
        ))}
      </div>

      {/* Resumen */}
      <div className="animate-in grid grid-cols-2 gap-2 md:grid-cols-4 xl:max-w-4xl">
        <div className="rounded-3xl bg-emerald-600 p-4 text-white shadow-float">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-white/70">Vendido</p>
          <p className="text-2xl font-bold tabular-nums">Bs {fmtMoney(ingresos)}</p>
          <p className="text-xs text-white/80">{ticketsInRange.length + looseSales.length} venta{ticketsInRange.length + looseSales.length === 1 ? "" : "s"} · {unidadesVendidas} unid.</p>
        </div>
        <Stat label="Ganancia real" value={`Bs ${fmtMoney(ganancia)}`} hint={ganancia > 0 || ingresos === 0 ? "vendido − lo que te costó" : "faltan costos de compra"} />
        {pendienteCobro > 0 ? <Stat label="Por cobrar" value={`Bs ${fmtMoney(pendienteCobro)}`} hint="ventas fiadas o a medias" /> : <Stat label="Entradas" value={`+${entradas}`} hint="unidades recibidas" />}
        <Stat label="Retiros sin venta" value={`−${retiros}`} hint="no suman ingresos" />
      </div>

      {top.length > 0 && (
        <div className="animate-in card">
          <h2 className="mb-2 text-sm font-bold text-ink">Más vendidos ({RANGES.find((r) => r.k === range)?.t.toLowerCase()})</h2>
          <ol className="space-y-1.5">
            {top.map(([k, v], i) => (
              <li key={k} className="flex items-center gap-3 text-sm">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-medium text-ink">{v.name}</span>
                <span className="text-xs text-slate-500">{v.qty} unid.</span>
                <span className="font-bold tabular-nums text-emerald-700">Bs {fmtMoney(v.total)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Lista */}
      <div className="animate-in grid grid-cols-4 gap-1 rounded-2xl bg-slate-100 p-1">
        {TABS.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)} className={`rounded-xl px-2 py-2 text-sm font-semibold ${tab === t.k ? "bg-white text-ink shadow" : "text-slate-500"}`}>{t.t}</button>
        ))}
      </div>

      {loading ? (
        <ListSkeleton rows={4} />
      ) : tab === "venta" && (ticketsInRange.length > 0 || looseSales.length > 0) ? (
        <ul className="stagger space-y-2">
          {ticketsInRange.map((t) => (
            <li key={t.id} className="rounded-2xl bg-white shadow-card ring-1 ring-slate-900/10">
              <button onClick={() => toggleTicket(t.id)} className="flex w-full items-center gap-3 p-3 text-left">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${t.status === "pagado" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{t.status === "pagado" ? "Venta" : STATUS_LABEL[t.status]}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink">N.º {t.number} · {t.items} producto{t.items === 1 ? "" : "s"}{t.customer_name ? ` · ${t.customer_name}` : ""}</span>
                  <span className="block text-xs text-slate-500">
                    {new Date(t.created_at).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · {METHOD_LABEL[t.method]}
                    {t.status !== "pagado" ? ` · debe Bs ${fmtMoney(Number(t.total) - Number(t.paid))}` : ""}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block font-bold tabular-nums text-emerald-700">Bs {fmtMoney(Number(t.total))}</span>
                  <span className="block text-[11px] text-slate-500">gana Bs {fmtMoney(Number(t.total) - Number(t.cost_total))}</span>
                </span>
                <IconChevronRight size={16} className={`text-slate-300 transition ${open === t.id ? "rotate-90" : ""}`} />
              </button>
              {open === t.id && (
                <ul className="divide-y divide-slate-100 border-t border-slate-100 px-3 pb-2 text-sm">
                  {(items[t.id] ?? []).map((i) => (
                    <li key={i.id} className="flex items-center gap-2 py-1.5">
                      <span className="w-8 shrink-0 text-right font-bold tabular-nums">{i.qty}×</span>
                      <span className="min-w-0 flex-1 truncate">{i.product_name ?? "Producto"}{i.variant_label ? <span className="text-violet-800"> · {i.variant_label}</span> : null}</span>
                      <span className="tabular-nums text-slate-500">Bs {fmtMoney(Number(i.unit_price))}</span>
                      <span className="font-semibold tabular-nums">Bs {fmtMoney(Number(i.line_total))}</span>
                    </li>
                  ))}
                  {!items[t.id] && <li className="py-2 text-xs text-slate-500">Cargando…</li>}
                  {Number(t.discount) > 0 && <li className="flex justify-between py-1.5 text-xs text-slate-500"><span>Descuento</span><span>−Bs {fmtMoney(Number(t.discount))}</span></li>}
                </ul>
              )}
            </li>
          ))}
          {looseSales.map((r) => (
            <li key={r.id} className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-card ring-1 ring-slate-900/10">
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">Venta</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-ink">{r.product_name || "Producto"}{r.variant_label ? <span className="text-violet-800"> · {r.variant_label}</span> : null}</span>
                <span className="block text-xs text-slate-500">{new Date(r.created_at).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · registrada sin conexión</span>
              </span>
              <span className="font-bold tabular-nums text-emerald-700">Bs {fmtMoney(r.total ?? 0)}</span>
            </li>
          ))}
        </ul>
      ) : list.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">{tab === "venta" ? <>Sin ventas en este periodo. Toca <Link href="/sell" className="font-semibold text-brand-700 underline">Vender</Link> para registrar una.</> : <>Sin movimientos en este periodo. Usa <b>+/− Stock</b> en un producto del inventario.</>}</p>
      ) : (
        <ul className="stagger grid grid-cols-1 gap-2 xl:grid-cols-2">
          {list.map((r) => {
            const l = LABEL[r.tipo];
            return (
              <li key={r.id} className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-card ring-1 ring-slate-900/10">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${l.c}`}>{l.t}</span>
                <span className="min-w-0 flex-1">
                  {r.product_id ? (
                    <Link href={`/products/${r.product_id}`} className="block truncate font-semibold text-ink hover:text-brand-700">{r.product_name || "Producto"}</Link>
                  ) : (
                    <span className="block truncate font-semibold text-slate-500">{r.product_name || "Producto eliminado"}</span>
                  )}
                  <span className="block text-xs text-slate-500">
                    {new Date(r.created_at).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    {r.variant_label ? <> · <b className="text-violet-800">{r.variant_label}</b></> : null}
                    {r.motivo ? ` · ${r.motivo}` : ""}
                    {r.stock_resultante !== null ? ` · quedó en ${r.stock_resultante}` : ""}
                  </span>
                </span>
                <span className="text-right">
                  <span className={`block font-bold tabular-nums ${r.tipo === "entrada" ? "text-brand-700" : "text-ink"}`}>{l.sign}{r.cantidad}</span>
                  {r.tipo === "venta" && <span className="block text-xs font-semibold text-emerald-700">Bs {fmtMoney(r.total ?? 0)}</span>}
                </span>
                {r.product_id && <IconChevronRight size={16} className="text-slate-300" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-3xl bg-white p-4 shadow-card ring-1 ring-slate-900/10">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-2xl font-bold tabular-nums text-ink">{value}</p>
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
