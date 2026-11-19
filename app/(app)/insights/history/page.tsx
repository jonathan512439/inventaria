"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { MovementType, Sale, SaleItem, StockMovement } from "@/types/database";
import { METHOD_LABEL, STATUS_LABEL } from "@/lib/sales";
import { money } from "@/lib/inventory";
import { businessDayStart, businessMonthStart } from "@/lib/dates";
import { friendlyError } from "@/lib/errors";
import { useFlow } from "@/components/FlowProvider";
import { ChipFilter, EmptyState, ScreenHeader, Stat } from "@/components/ui/Screen";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { IconChevronRight, IconList } from "@/components/ui/Icons";

type Kind = "venta" | "entrada" | "salida" | "ajuste" | "todos";
type Range = "hoy" | "7d" | "mes" | "todo";
const KINDS: Kind[] = ["venta", "entrada", "salida", "ajuste", "todos"];
const RANGES: Range[] = ["hoy", "7d", "mes", "todo"];
const LIMIT = 300;

const LABEL: Record<MovementType, { t: string; c: string; sign: string }> = {
  venta: { t: "Venta", c: "bg-ok-100 text-ok-800", sign: "−" },
  entrada: { t: "Entrada", c: "bg-brand-100 text-brand-800", sign: "+" },
  salida: { t: "Retiro", c: "bg-slate-200 text-slate-700", sign: "−" },
  ajuste: { t: "Ajuste", c: "bg-warn-100 text-warn-800", sign: "±" },
};

function rangeStart(r: Range): Date | null {
  // En la zona horaria del negocio (023), no la del celular
  if (r === "hoy") return businessDayStart();
  if (r === "7d") return businessDayStart(6);
  if (r === "mes") return businessMonthStart();
  return null;
}

export default function HistoryPage() {
  return (
    <Suspense fallback={<ListSkeleton rows={5} />}>
      <History />
    </Suspense>
  );
}

/**
 * Historial (C7.7 · antes /movements, F30): todas las ventas y movimientos con filtros por **tipo**, **fecha** y
 * **persona** (quién lo hizo: la firma de 015). Los filtros se aplican en la base (antes se traían 1000 filas
 * y se filtraba en el teléfono). Estado en la dirección: ?tipo=…&rango=…&quien=<user_id>.
 */
function History() {
  const params = useSearchParams();
  const router = useRouter();
  const param = (k: string) => params.get(k)?.split("?")[0] ?? null;
  const kind: Kind = KINDS.includes(param("tipo") as Kind) ? (param("tipo") as Kind) : "venta";
  const range: Range = RANGES.includes(param("rango") as Range) ? (param("rango") as Range) : "mes";
  const who = param("quien");
  const { isOwner, members } = useFlow();
  const supabase = createClient();
  const [rows, setRows] = useState<StockMovement[] | null>(null);
  const [tickets, setTickets] = useState<Sale[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [items, setItems] = useState<Record<string, SaleItem[]>>({});
  const [error, setError] = useState<string | null>(null);

  const nameOf = (uid: string) => members.find((m) => m.user_id === uid)?.display_name || (members.length > 1 ? "Alguien del equipo" : null);

  function set(next: { tipo?: Kind; rango?: Range; quien?: string | null }) {
    const q = new URLSearchParams();
    const t = next.tipo ?? kind;
    const r = next.rango ?? range;
    const w = next.quien === undefined ? who : next.quien;
    if (t !== "venta") q.set("tipo", t);
    if (r !== "mes") q.set("rango", r);
    if (w) q.set("quien", w);
    router.replace(`/insights/history${q.toString() ? `?${q}` : ""}`, { scroll: false });
  }

  useEffect(() => {
    setRows(null);
    setError(null);
    const start = rangeStart(range);
    let m = supabase.from("stock_movements").select("*").order("created_at", { ascending: false }).limit(LIMIT);
    if (kind !== "todos") m = m.eq("tipo", kind);
    if (start) m = m.gte("created_at", start.toISOString());
    if (who) m = m.eq("user_id", who);
    let s = supabase.from("sales_v").select("*").order("created_at", { ascending: false }).limit(LIMIT);
    if (start) s = s.gte("created_at", start.toISOString());
    if (who) s = s.eq("user_id", who);
    Promise.all([m, kind === "venta" ? s : Promise.resolve({ data: [], error: null })]).then(([mv, sv]) => {
      if (mv.error || sv.error) setError(friendlyError(mv.error ?? sv.error));
      setRows((mv.data ?? []) as StockMovement[]);
      setTickets((sv.data ?? []) as Sale[]);
    });
  }, [supabase, kind, range, who]);

  async function toggleTicket(id: string) {
    if (open === id) return setOpen(null);
    setOpen(id);
    if (!items[id]) {
      const { data } = await supabase.from("sale_items").select("*").eq("sale_id", id).order("created_at");
      setItems((m) => ({ ...m, [id]: (data ?? []) as SaleItem[] }));
    }
  }

  const list = rows ?? [];
  // Ventas: los tickets + las ventas rápidas hechas sin conexión (movimiento sin ticket)
  const looseSales = list.filter((r) => r.tipo === "venta" && !r.sale_id);
  const sold = tickets.reduce((s, t) => s + Number(t.total), 0) + looseSales.reduce((s, r) => s + (r.total ?? 0), 0);
  const profit = tickets.reduce((s, t) => s + (Number(t.total) - Number(t.cost_total ?? 0)), 0);
  const owed = tickets.filter((t) => t.status !== "pagado").reduce((s, t) => s + (Number(t.total) - Number(t.paid)), 0);
  const units = list.reduce((s, r) => s + r.cantidad, 0);
  const capped = list.length >= LIMIT || tickets.length >= LIMIT;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <ScreenHeader
        title="Historial"
        subtitle="Cada venta, entrada, retiro y ajuste, con quién lo hizo."
        back={{ href: "/insights", label: "Números" }}
        help={<p>Filtra por tipo, por fecha y por persona del equipo. Toca una venta para ver qué se llevó; toca un movimiento para abrir el producto.</p>}
      />

      <ChipFilter<Kind>
        value={[kind]}
        onToggle={(t) => set({ tipo: t })}
        items={[
          { value: "venta", label: "Ventas" },
          { value: "entrada", label: "Entradas" },
          { value: "salida", label: "Retiros" },
          { value: "ajuste", label: "Ajustes" },
          { value: "todos", label: "Todo" },
        ]}
      />
      <div className="flex flex-wrap items-center gap-2">
        <ChipFilter<Range>
          value={[range]}
          onToggle={(r) => set({ rango: r })}
          items={[
            { value: "hoy", label: "Hoy" },
            { value: "7d", label: "7 días" },
            { value: "mes", label: "Este mes" },
            { value: "todo", label: "Todo" },
          ]}
        />
        {members.length > 1 && (
          <select className="input min-h-[44px] w-auto" value={who ?? ""} onChange={(e) => set({ quien: e.target.value || null })} aria-label="Quién lo hizo">
            <option value="">Todo el equipo</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>{m.display_name || (m.role === "dueno" ? "Dueño" : "Vendedor")}</option>
            ))}
          </select>
        )}
      </div>

      {error ? (
        <EmptyState title="No se pudo cargar el historial" body={error} />
      ) : rows === null ? (
        <ListSkeleton rows={5} />
      ) : (
        <>
          {kind === "venta" ? (
            <div className="animate-in grid grid-cols-2 gap-2 md:grid-cols-3">
              <Stat label="Vendido" value={money(sold)} hint={`${tickets.length + looseSales.length} venta${tickets.length + looseSales.length === 1 ? "" : "s"}`} tone="ok" />
              {isOwner ? <Stat label="Ganancia" value={money(profit)} hint="vendido − lo que costó" /> : <Stat label="Unidades" value={units} hint="vendidas" />}
              {owed > 0 && <Stat label="Por cobrar" value={money(owed)} hint="fiado o a medias" tone="warn" />}
            </div>
          ) : (
            list.length > 0 && <p className="text-sm text-muted">{list.length} movimiento{list.length === 1 ? "" : "s"} · {units} unidades</p>
          )}
          {capped && <p className="rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-600">Se muestran los últimos {LIMIT}. Elige un periodo más corto para ver el resto.</p>}

          {kind === "venta" ? (
            tickets.length + looseSales.length === 0 ? (
              <EmptyState icon={<IconList size={28} />} title="Sin ventas en este periodo" action={<Link href="/sell" className="btn-primary">Ir a Vender</Link>} />
            ) : (
              <ul className="space-y-2">
                {tickets.map((t) => (
                  <li key={t.id} className="rounded-2xl bg-white shadow-card ring-1 ring-slate-900/10">
                    <button type="button" onClick={() => toggleTicket(t.id)} className="flex min-h-[56px] w-full items-center gap-3 p-3 text-left">
                      <span className={`badge ${t.status === "pagado" ? "bg-ok-100 text-ok-800" : "bg-warn-100 text-warn-800"}`}>{t.status === "pagado" ? "Venta" : STATUS_LABEL[t.status]}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-ink">N.º {t.number} · {t.items} producto{t.items === 1 ? "" : "s"}{t.customer_name ? ` · ${t.customer_name}` : ""}</span>
                        <span className="block truncate text-xs text-muted">
                          {new Date(t.created_at).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · {METHOD_LABEL[t.method]}
                          {nameOf(t.user_id) ? ` · ${nameOf(t.user_id)}` : ""}
                          {t.status !== "pagado" ? ` · debe ${money(Number(t.total) - Number(t.paid))}` : ""}
                        </span>
                      </span>
                      <span className="text-right">
                        <span className="block font-bold tabular-nums text-ok-700">{money(Number(t.total))}</span>
                        {isOwner && <span className="block text-xs text-muted">gana {money(Number(t.total) - Number(t.cost_total ?? 0))}</span>}
                      </span>
                      <IconChevronRight size={16} className={`shrink-0 text-slate-300 transition ${open === t.id ? "rotate-90" : ""}`} />
                    </button>
                    {open === t.id && (
                      <ul className="divide-y divide-slate-100 border-t border-slate-100 px-3 pb-2 text-sm">
                        {(items[t.id] ?? []).map((i) => (
                          <li key={i.id} className="flex items-center gap-2 py-1.5">
                            <span className="w-8 shrink-0 text-right font-bold tabular-nums">{i.qty}×</span>
                            <span className="min-w-0 flex-1 truncate">{i.product_name ?? "Producto"}{i.variant_label ? <span className="text-violet-800"> · {i.variant_label}</span> : null}</span>
                            <span className="tabular-nums text-muted">{money(Number(i.unit_price))}</span>
                            <span className="font-semibold tabular-nums">{money(Number(i.line_total))}</span>
                          </li>
                        ))}
                        {!items[t.id] && <li className="py-2 text-xs text-muted">Cargando…</li>}
                        {Number(t.discount) > 0 && <li className="flex justify-between py-1.5 text-xs text-muted"><span>Descuento</span><span>−{money(Number(t.discount))}</span></li>}
                      </ul>
                    )}
                  </li>
                ))}
                {looseSales.map((r) => (
                  <li key={r.id} className="flex min-h-[56px] items-center gap-3 rounded-2xl bg-white p-3 shadow-card ring-1 ring-slate-900/10">
                    <span className="badge bg-ok-100 text-ok-800">Venta</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-ink">{r.product_name || "Producto"}{r.variant_label ? <span className="text-violet-800"> · {r.variant_label}</span> : null}</span>
                      <span className="block text-xs text-muted">{new Date(r.created_at).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · registrada sin conexión</span>
                    </span>
                    <span className="font-bold tabular-nums text-ok-700">{money(r.total ?? 0)}</span>
                  </li>
                ))}
              </ul>
            )
          ) : list.length === 0 ? (
            <EmptyState icon={<IconList size={28} />} title="Sin movimientos en este periodo" body="Las entradas, retiros y ajustes aparecen aquí con quién los hizo." />
          ) : (
            <ul className="grid grid-cols-1 gap-2">
              {list.map((r) => {
                const l = LABEL[r.tipo];
                const body = (
                  <>
                    <span className={`badge ${l.c}`}>{l.t}</span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate font-semibold ${r.product_id ? "text-ink" : "text-muted"}`}>{r.product_name || "Producto eliminado"}{r.variant_label ? <span className="text-violet-800"> · {r.variant_label}</span> : null}</span>
                      <span className="block truncate text-xs text-muted">
                        {new Date(r.created_at).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        {nameOf(r.user_id) ? ` · ${nameOf(r.user_id)}` : ""}
                        {r.motivo ? ` · ${r.motivo}` : ""}
                        {r.stock_resultante !== null ? ` · quedó en ${r.stock_resultante}` : ""}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className={`block font-bold tabular-nums ${r.tipo === "entrada" ? "text-brand-700" : "text-ink"}`}>{l.sign}{r.cantidad}</span>
                      {r.tipo === "venta" && <span className="block text-xs font-semibold text-ok-700">{money(r.total ?? 0)}</span>}
                    </span>
                    {r.product_id && <IconChevronRight size={16} className="shrink-0 text-slate-300" />}
                  </>
                );
                const cls = "flex min-h-[56px] items-center gap-3 rounded-2xl bg-white p-3 shadow-card ring-1 ring-slate-900/10";
                return <li key={r.id}>{r.product_id ? <Link href={`/products/${r.product_id}`} className={`${cls} hover:ring-brand-300`}>{body}</Link> : <div className={cls}>{body}</div>}</li>;
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
