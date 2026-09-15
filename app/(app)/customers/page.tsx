"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Consignment, ConsignmentItem, Customer, Sale } from "@/types/database";
import { fmtMoney } from "@/lib/inventory";
import { debtOf, oldestDebtDays } from "@/lib/customers";
import CoachTip from "@/components/CoachTip";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { IconArrowLeft, IconChevronRight, IconPlus, IconSearch, IconX, Spinner } from "@/components/ui/Icons";

type Tab = "todos" | "deben" | "inactivos" | "resumen";

/** Clientes: a quién se vendió qué, quién debe, quién dejó de venir y qué mercadería está en manos de terceros. */
export default function CustomersPage() {
  const supabase = createClient();
  const toast = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [consignments, setConsignments] = useState<Consignment[]>([]);
  const [consItems, setConsItems] = useState<ConsignmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("todos");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [c, s, co, ci] = await Promise.all([
      supabase.from("customers").select("*").is("deleted_at", null).order("name"),
      supabase.from("sales").select("*").not("customer_id", "is", null).order("created_at", { ascending: false }).limit(2000),
      supabase.from("consignments").select("*").eq("status", "abierta"),
      supabase.from("consignment_items").select("*"),
    ]);
    setCustomers((c.data ?? []) as Customer[]);
    setSales((s.data ?? []) as Sale[]);
    setConsignments((co.data ?? []) as Consignment[]);
    setConsItems((ci.data ?? []) as ConsignmentItem[]);
    setLoading(false);
  }, [supabase]);
  useEffect(() => {
    load();
  }, [load]);

  const byCustomer = useMemo(() => {
    const m = new Map<string, Sale[]>();
    sales.forEach((s) => s.customer_id && m.set(s.customer_id, [...(m.get(s.customer_id) ?? []), s]));
    return m;
  }, [sales]);
  const outOf = (customerId: string) => {
    const ids = new Set(consignments.filter((c) => c.customer_id === customerId).map((c) => c.id));
    return consItems.filter((i) => ids.has(i.consignment_id)).reduce((a, i) => a + (i.qty_out - i.qty_sold - i.qty_returned), 0);
  };

  const rows = useMemo(() => {
    const now = Date.now();
    return customers.map((c) => {
      const s = byCustomer.get(c.id) ?? [];
      const last = s[0]?.created_at ?? null;
      return { c, sales: s, debt: debtOf(s), days: oldestDebtDays(s), last, inactiveDays: last ? Math.floor((now - new Date(last).getTime()) / 86400000) : null, total: s.reduce((a, x) => a + Number(x.total), 0), out: outOf(c.id) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, byCustomer, consignments, consItems]);

  const term = q.trim().toLowerCase();
  const visible = rows
    .filter((r) => !term || r.c.name.toLowerCase().includes(term) || (r.c.phone ?? "").includes(term))
    .filter((r) => (tab === "deben" ? r.debt > 0 : tab === "inactivos" ? r.last !== null && (r.inactiveDays ?? 0) >= 30 : true))
    .sort((a, b) => (tab === "deben" ? b.debt - a.debt : tab === "inactivos" ? (b.inactiveDays ?? 0) - (a.inactiveDays ?? 0) : a.c.name.localeCompare(b.c.name, "es")));

  // Resumen
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const topMonth = rows
    .map((r) => ({ ...r, month: r.sales.filter((s) => new Date(s.created_at) >= monthStart).reduce((a, s) => a + Number(s.total), 0) }))
    .filter((r) => r.month > 0)
    .sort((a, b) => b.month - a.month)
    .slice(0, 5);
  const debtTotal = rows.reduce((a, r) => a + r.debt, 0);
  const debtOld = rows.filter((r) => r.debt > 0 && (r.days ?? 0) >= 30).reduce((a, r) => a + r.debt, 0);
  const outUnits = rows.reduce((a, r) => a + r.out, 0);
  const inactive = rows.filter((r) => r.last !== null && (r.inactiveDays ?? 0) >= 30).length;

  async function addCustomer() {
    if (!form.name.trim()) return;
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from("customers").insert({ user_id: user!.id, name: form.name.trim(), phone: form.phone.trim() || null });
    setSaving(false);
    if (error) return toast("error", error.message);
    setForm({ name: "", phone: "" });
    setAdding(false);
    toast("success", "Cliente guardado");
    load();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <header className="animate-in">
        <Link href="/dashboard" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"><IconArrowLeft size={16} /> Inicio</Link>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink">Clientes</h1>
            <p className="text-sm text-slate-500">Quién te compra, quién te debe y qué mercadería tienes en manos de otros.</p>
          </div>
          <button onClick={() => setAdding(true)} className="btn-primary btn-sm"><IconPlus size={16} /> Nuevo cliente</button>
        </div>
      </header>
      <CoachTip screen="customers" title="Solo cuando hace falta">
        No necesitas anotar cada cliente: la mayoría de ventas son sin nombre. Guarda a los que fían, a los que les entregas mercadería para revender o a los que quieres tener a mano.
      </CoachTip>

      {adding && (
        <div className="animate-in card space-y-2 p-4">
          <div className="flex items-center justify-between"><p className="font-bold text-ink">Nuevo cliente</p><button onClick={() => setAdding(false)} className="btn-ghost btn-sm"><IconX size={16} /></button></div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input className="input" placeholder="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
            <input className="input" placeholder="Teléfono (WhatsApp)" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <button onClick={addCustomer} disabled={saving || !form.name.trim()} className="btn-primary w-full">{saving ? <Spinner size={16} /> : "Guardar"}</button>
        </div>
      )}

      <div className="animate-in grid grid-cols-4 gap-1 rounded-2xl bg-slate-100 p-1 text-xs sm:text-sm">
        {([["todos", "Todos"], ["deben", `Deben${rows.filter((r) => r.debt > 0).length ? ` (${rows.filter((r) => r.debt > 0).length})` : ""}`], ["inactivos", `Sin venir${inactive ? ` (${inactive})` : ""}`], ["resumen", "Resumen"]] as [Tab, string][]).map(([k, t]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-xl px-1 py-2 font-semibold ${tab === k ? "bg-white text-ink shadow" : "text-slate-500"}`}>{t}</button>
        ))}
      </div>

      {loading ? (
        <ListSkeleton rows={4} />
      ) : tab === "resumen" ? (
        <div className="space-y-3">
          <div className="animate-in grid grid-cols-2 gap-2">
            <Tile label="Deuda en la calle" value={`Bs ${fmtMoney(debtTotal)}`} hint={`${rows.filter((r) => r.debt > 0).length} cliente${rows.filter((r) => r.debt > 0).length === 1 ? "" : "s"} deben`} tone={debtTotal ? "warn" : undefined} />
            <Tile label="Deuda de más de 30 días" value={`Bs ${fmtMoney(debtOld)}`} hint="conviene recordar" tone={debtOld ? "danger" : undefined} />
            <Tile label="Mercadería entregada" value={`${outUnits} unid.`} hint="en consignación, sin liquidar" />
            <Tile label="Sin venir 30 días" value={String(inactive)} hint="clientes que dejaron de comprar" />
          </div>
          <section className="animate-in card p-3">
            <h2 className="mb-2 text-sm font-bold text-ink">Mejores clientes del mes</h2>
            {topMonth.length === 0 ? (
              <p className="text-sm text-slate-500">Todavía no hay ventas con cliente este mes.</p>
            ) : (
              <ol className="space-y-1.5">
                {topMonth.map((r, i) => (
                  <li key={r.c.id} className="flex items-center gap-3 text-sm">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800">{i + 1}</span>
                    <Link href={`/customers/detail?id=${r.c.id}`} className="min-w-0 flex-1 truncate font-medium text-ink hover:text-brand-700">{r.c.name}</Link>
                    <span className="font-bold tabular-nums text-emerald-700">Bs {fmtMoney(r.month)}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <Link href="/consign" className="animate-in btn-secondary w-full">Ver entregas en consignación</Link>
        </div>
      ) : (
        <>
          <div className="animate-in relative">
            <IconSearch size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-11" placeholder="Buscar por nombre o teléfono…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {visible.length === 0 ? (
            <div className="animate-in card text-center">
              <p className="text-lg font-bold text-ink">{customers.length === 0 ? "Aún no tienes clientes guardados" : "Nadie por aquí"}</p>
              <p className="mt-1 text-sm text-slate-500">{customers.length === 0 ? "Se crean desde aquí o al fiar en una venta." : tab === "deben" ? "Nadie te debe. 🎉" : "Todos han comprado hace poco."}</p>
            </div>
          ) : (
            <ul className="stagger space-y-2">
              {visible.map((r) => (
                <li key={r.c.id}>
                  <Link href={`/customers/detail?id=${r.c.id}`} className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-card ring-1 ring-slate-900/10 hover:ring-brand-400">
                    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold ${r.debt > 0 ? "bg-amber-100 text-amber-800" : "bg-brand-100 text-brand-800"}`}>{r.c.name.slice(0, 1).toUpperCase()}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-ink">{r.c.name}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {r.last ? `última compra ${r.inactiveDays === 0 ? "hoy" : `hace ${r.inactiveDays} d`}` : "sin compras"} · {r.sales.length} venta{r.sales.length === 1 ? "" : "s"} · Bs {fmtMoney(r.total)}
                        {r.out ? ` · ${r.out} unid. entregadas` : ""}
                      </span>
                    </span>
                    {r.debt > 0 ? (
                      <span className="text-right">
                        <span className="block font-bold tabular-nums text-amber-700">debe Bs {fmtMoney(r.debt)}</span>
                        <span className={`block text-[11px] ${(r.days ?? 0) >= 30 ? "text-rose-600" : "text-slate-500"}`}>{r.days} d</span>
                      </span>
                    ) : null}
                    <IconChevronRight className="text-slate-300" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: "warn" | "danger" }) {
  return (
    <div className="rounded-2xl bg-white p-3 shadow-card ring-1 ring-slate-900/10">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${tone === "danger" ? "text-rose-700" : tone === "warn" ? "text-amber-700" : "text-ink"}`}>{value}</p>
      <p className="truncate text-[11px] text-slate-400">{hint}</p>
    </div>
  );
}
