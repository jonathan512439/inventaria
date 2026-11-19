"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Consignment, ConsignmentItem, Customer, Sale } from "@/types/database";
import { money } from "@/lib/inventory";
import { debtOf, oldestDebtDays } from "@/lib/customers";
import { friendlyError } from "@/lib/errors";
import Sheet from "@/components/ui/Sheet";
import { ChipFilter, EmptyState, ScreenHeader, Stat } from "@/components/ui/Screen";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { IconChevronRight, IconPlus, IconSearch, IconTruck, IconUsers, Spinner } from "@/components/ui/Icons";

const FILTERS = ["all", "debt", "inactive", "consign"] as const;
type Filter = (typeof FILTERS)[number];
/** Direcciones antiguas: /customers?tab=deben|inactivos */
const LEGACY: Record<string, Filter> = { deben: "debt", inactivos: "inactive" };

export default function CustomersPage() {
  return (
    <Suspense fallback={<ListSkeleton rows={5} />}>
      <Customers />
    </Suspense>
  );
}

/**
 * Clientes (C7.6 · RECONSTRUCCION_VISUAL.md §3.2, F31): buscador y chips Todos · Deben · Sin venir 30 días ·
 * Con mercadería entregada (antes /consign); botón fijo **Nuevo cliente**. La mercadería entregada se maneja
 * en la ficha de cada cliente. Los mejores clientes están en Números › Ventas (C7.7).
 */
function Customers() {
  const params = useSearchParams();
  const router = useRouter();
  // Cloudflare puede unir consultas con «?» al redirigir: se corta ahí (ver nota de C7.3)
  const param = (k: string) => params.get(k)?.split("?")[0] ?? null;
  const raw = param("filter") ?? LEGACY[param("tab") ?? ""] ?? "all";
  const filter: Filter = (FILTERS as readonly string[]).includes(raw) ? (raw as Filter) : "all";
  const supabase = createClient();
  const toast = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [consignments, setConsignments] = useState<Consignment[]>([]);
  const [consItems, setConsItems] = useState<ConsignmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [c, s, co] = await Promise.all([
      supabase.from("customers").select("*").is("deleted_at", null).order("name"),
      supabase.from("sales").select("*").not("customer_id", "is", null).order("created_at", { ascending: false }).limit(2000),
      supabase.from("consignments").select("*").eq("status", "abierta"),
    ]);
    setCustomers((c.data ?? []) as Customer[]);
    setSales((s.data ?? []) as Sale[]);
    const cons = (co.data ?? []) as Consignment[];
    setConsignments(cons);
    // Solo los productos de las entregas abiertas (antes se traían todos)
    const ci = cons.length ? await supabase.from("consignment_items").select("*").in("consignment_id", cons.map((x) => x.id)) : { data: [] };
    setConsItems((ci.data ?? []) as ConsignmentItem[]);
    setLoading(false);
  }, [supabase]);
  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    const byCustomer = new Map<string, Sale[]>();
    sales.forEach((s) => s.customer_id && byCustomer.set(s.customer_id, [...(byCustomer.get(s.customer_id) ?? []), s]));
    const outBy = new Map<string, number>();
    consItems.forEach((i) => {
      const c = consignments.find((x) => x.id === i.consignment_id);
      if (c) outBy.set(c.customer_id, (outBy.get(c.customer_id) ?? 0) + (i.qty_out - i.qty_sold - i.qty_returned));
    });
    const now = Date.now();
    return customers.map((c) => {
      const s = byCustomer.get(c.id) ?? [];
      const last = s[0]?.created_at ?? null;
      return { c, sales: s, debt: debtOf(s), days: oldestDebtDays(s), last, inactiveDays: last ? Math.floor((now - new Date(last).getTime()) / 86400000) : null, total: s.reduce((a, x) => a + Number(x.total), 0), out: outBy.get(c.id) ?? 0 };
    });
  }, [customers, sales, consignments, consItems]);

  const counts = {
    debt: rows.filter((r) => r.debt > 0).length,
    inactive: rows.filter((r) => r.last !== null && (r.inactiveDays ?? 0) >= 30).length,
    consign: rows.filter((r) => r.out > 0).length,
  };
  const debtTotal = rows.reduce((a, r) => a + r.debt, 0);
  const debtOld = rows.filter((r) => r.debt > 0 && (r.days ?? 0) >= 30).reduce((a, r) => a + r.debt, 0);
  const outUnits = rows.reduce((a, r) => a + r.out, 0);

  const term = q.trim().toLowerCase();
  const visible = rows
    .filter((r) => !term || r.c.name.toLowerCase().includes(term) || (r.c.phone ?? "").includes(term))
    .filter((r) => (filter === "debt" ? r.debt > 0 : filter === "inactive" ? r.last !== null && (r.inactiveDays ?? 0) >= 30 : filter === "consign" ? r.out > 0 : true))
    .sort((a, b) => (filter === "debt" ? b.debt - a.debt : filter === "inactive" ? (b.inactiveDays ?? 0) - (a.inactiveDays ?? 0) : filter === "consign" ? b.out - a.out : a.c.name.localeCompare(b.c.name, "es")));

  function setFilter(f: Filter) {
    const next = f === filter ? "all" : f;
    router.replace(next === "all" ? "/customers" : `/customers?filter=${next}`, { scroll: false });
  }

  async function addCustomer() {
    if (!form.name.trim()) return;
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error } = await supabase.from("customers").insert({ user_id: user!.id, name: form.name.trim(), phone: form.phone.trim() || null }).select("id").single();
    setSaving(false);
    if (error) return toast("error", friendlyError(error));
    setForm({ name: "", phone: "" });
    setAdding(false);
    toast("success", "Cliente guardado");
    router.push(`/customers/detail?id=${data.id}`);
  }

  return (
    <div className="has-action mx-auto max-w-2xl space-y-4">
      <ScreenHeader
        title="Clientes"
        subtitle="Quién te compra, quién te debe y quién tiene tu mercadería."
        help={
          <>
            <p>No hace falta anotar a cada cliente: la mayoría de las ventas son sin nombre. Guarda a los que te deben, a los que les entregas mercadería para revender o a los que quieres tener a mano.</p>
            <p>Toca un cliente para ver cuánto debe y por qué, cobrarle un abono, recordarle por WhatsApp o entregarle mercadería.</p>
          </>
        }
      />

      {!loading && (debtTotal > 0 || outUnits > 0) && (
        <div className="animate-in grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setFilter("debt")} className="text-left">
            <Stat label="Te deben" value={money(debtTotal)} hint={debtOld > 0 ? `${money(debtOld)} hace más de 30 días` : `${counts.debt} cliente${counts.debt === 1 ? "" : "s"}`} tone={debtOld > 0 ? "danger" : debtTotal > 0 ? "warn" : undefined} />
          </button>
          <button type="button" onClick={() => setFilter("consign")} className="text-left">
            <Stat label="Mercadería afuera" value={`${outUnits} unid.`} hint={`${counts.consign} cliente${counts.consign === 1 ? "" : "s"}`} />
          </button>
        </div>
      )}

      <div className="animate-in relative">
        <IconSearch size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
        <input className="input h-12 pl-11" placeholder="Buscar por nombre o teléfono…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar cliente" />
      </div>

      <ChipFilter<Filter>
        value={[filter]}
        onToggle={setFilter}
        items={[
          { value: "all", label: "Todos", count: rows.length },
          { value: "debt", label: "Deben", count: counts.debt, tone: "warn" },
          { value: "inactive", label: "Sin venir 30 días", count: counts.inactive },
          { value: "consign", label: "Con mercadería entregada", count: counts.consign },
        ]}
      />

      {loading ? (
        <ListSkeleton rows={5} />
      ) : visible.length === 0 ? (
        customers.length === 0 ? (
          <EmptyState icon={<IconUsers size={28} />} title="Aún no tienes clientes guardados" body="Se crean aquí con «Nuevo cliente» o al vender a cuenta en Vender." />
        ) : filter === "consign" ? (
          <EmptyState icon={<IconTruck size={28} />} title="Nadie tiene tu mercadería" body="Para entregar productos a un revendedor: abre el cliente → «Mercadería entregada» → «Entregar mercadería»." />
        ) : (
          <EmptyState title={filter === "debt" ? "Nadie te debe 🎉" : filter === "inactive" ? "Todos compraron hace poco" : "Nadie con ese nombre"} />
        )
      ) : (
        <ul className="stagger space-y-2">
          {visible.map((r) => (
            <li key={r.c.id}>
              <Link href={`/customers/detail?id=${r.c.id}${filter === "consign" ? "&tab=entregas" : ""}`} className="flex min-h-[64px] items-center gap-3 rounded-2xl bg-white p-3 shadow-card ring-1 ring-slate-900/10 hover:ring-brand-400">
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold ${r.debt > 0 ? "bg-warn-100 text-warn-800" : "bg-brand-100 text-brand-800"}`}>{r.c.name.slice(0, 1).toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink">{r.c.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {r.last ? `última compra ${r.inactiveDays === 0 ? "hoy" : `hace ${r.inactiveDays} d`}` : "sin compras"} · {r.sales.length} venta{r.sales.length === 1 ? "" : "s"}
                  </span>
                  {r.out > 0 && <span className="badge mt-0.5 bg-info-100 text-info-800">{r.out} unid. entregadas</span>}
                </span>
                {r.debt > 0 && (
                  <span className="shrink-0 text-right">
                    <span className="block font-bold tabular-nums text-warn-700">debe {money(r.debt)}</span>
                    <span className={`block text-xs ${(r.days ?? 0) >= 30 ? "font-semibold text-danger-700" : "text-muted"}`}>hace {r.days} d</span>
                  </span>
                )}
                <IconChevronRight className="shrink-0 text-slate-300" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="sticky-action">
        <button type="button" onClick={() => setAdding(true)} className="btn-primary btn-lg mx-auto flex w-full max-w-2xl"><IconPlus size={20} /> Nuevo cliente</button>
      </div>

      <Sheet
        open={adding}
        onClose={() => setAdding(false)}
        title="Nuevo cliente"
        footer={
          <button type="button" onClick={addCustomer} disabled={saving || !form.name.trim()} className="btn-primary btn-lg w-full">
            {saving ? <Spinner /> : null} Guardar cliente
          </button>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="n-name">Nombre</label>
            <input id="n-name" className="input min-h-[44px]" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          </div>
          <div>
            <label className="label" htmlFor="n-phone">Teléfono (WhatsApp, opcional)</label>
            <input id="n-phone" className="input min-h-[44px]" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
        </div>
      </Sheet>
    </div>
  );
}
