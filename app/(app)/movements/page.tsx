"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { MovementType, StockMovement } from "@/types/database";
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
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("venta");
  const [range, setRange] = useState<Range>("mes");

  useEffect(() => {
    supabase
      .from("stock_movements")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1000)
      .then(({ data }) => {
        setRows((data ?? []) as StockMovement[]);
        setLoading(false);
      });
  }, [supabase]);

  const inRange = useMemo(() => {
    const start = rangeStart(range);
    return start ? rows.filter((r) => new Date(r.created_at) >= start) : rows;
  }, [rows, range]);
  const list = tab === "todos" ? inRange : inRange.filter((r) => r.tipo === tab);

  const sales = inRange.filter((r) => r.tipo === "venta");
  const ingresos = sales.reduce((s, r) => s + (r.total ?? 0), 0);
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
        <h1 className="text-2xl font-bold tracking-tight text-ink">Ventas y movimientos</h1>
        <p className="text-sm text-slate-500">Lo que entra, lo que se vende y lo que se retira. Se registra desde el botón <b>+/− Stock</b>.</p>
      </header>

      <div className="animate-in flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <button key={r.k} onClick={() => setRange(r.k)} className={`chip ${range === r.k ? "chip-active" : ""}`}>{r.t}</button>
        ))}
      </div>

      {/* Resumen */}
      <div className="animate-in grid grid-cols-2 gap-2 md:grid-cols-4 xl:max-w-4xl">
        <div className="rounded-3xl bg-emerald-600 p-4 text-white shadow-float">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-white/70">Ingresos por ventas</p>
          <p className="text-2xl font-bold tabular-nums">Bs {fmtMoney(ingresos)}</p>
          <p className="text-xs text-white/80">{sales.length} venta{sales.length === 1 ? "" : "s"} · {unidadesVendidas} unid.</p>
        </div>
        <Stat label="Entradas" value={`+${entradas}`} hint="unidades recibidas" />
        <Stat label="Retiros sin venta" value={`−${retiros}`} hint="no suman ingresos" />
        <Stat label="Movimientos" value={String(inRange.length)} hint="en el periodo" />
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
      ) : list.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">Sin movimientos en este periodo. Usa <b>+/− Stock</b> en un producto del inventario.</p>
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
