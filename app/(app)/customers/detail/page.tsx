"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Consignment, ConsignmentItem, Customer, Payment, Sale, SaleItem } from "@/types/database";
import { currencyLabel, money } from "@/lib/inventory";
import { METHOD_LABEL, STATUS_LABEL } from "@/lib/sales";
import { debtOf, oldestDebtDays, reminderText, waLink } from "@/lib/customers";
import { friendlyError } from "@/lib/errors";
import PaySheet from "@/components/customers/PaySheet";
import ConsignSection from "@/components/customers/ConsignSection";
import { EmptyState, Tabs } from "@/components/ui/Screen";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { useFlow } from "@/components/FlowProvider";
import { IconArrowLeft, IconCheck, IconChevronRight, IconTrash, Spinner } from "@/components/ui/Icons";

type Tab = "compras" | "abonos" | "entregas" | "datos";
const TABS: Tab[] = ["compras", "abonos", "entregas", "datos"];

export default function CustomerDetailPage() {
  return (
    <Suspense fallback={<ListSkeleton rows={4} />}>
      <CustomerDetail />
    </Suspense>
  );
}

/**
 * Ficha del cliente (C7.6 · RECONSTRUCCION_VISUAL.md §3.2, F32 + F33): saldo grande con **Cobrar abono** y
 * **Recordar por WhatsApp**; pestañas Compras · Abonos · Mercadería entregada (entregar y rendir cuentas aquí
 * mismo, antes /consign) · Datos. «¿Cuánto debe y por qué?» se responde sin moverse: lo pendiente va primero.
 */
function CustomerDetail() {
  const params = useSearchParams();
  // Cloudflare puede unir consultas con «?» al redirigir: se corta ahí (ver nota de C7.3)
  const param = (k: string) => params.get(k)?.split("?")[0] ?? null;
  const id = param("id") ?? "";
  const initialTab = param("tab");
  const router = useRouter();
  const supabase = createClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { business, isOwner } = useFlow();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [items, setItems] = useState<SaleItem[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [consignments, setConsignments] = useState<Consignment[]>([]);
  const [consItems, setConsItems] = useState<ConsignmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>(TABS.includes(initialTab as Tab) ? (initialTab as Tab) : "compras");
  const [paying, setPaying] = useState(false);
  const [form, setForm] = useState<{ name: string; phone: string; note: string; credit_limit: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** Saldo a favor (pagó de más): se usa solo en su próxima venta fiada (022) */
  const [credit, setCredit] = useState(0);

  const load = useCallback(async () => {
    if (!id) return setLoading(false);
    const [c, s, p, co, bal] = await Promise.all([
      supabase.from("customers").select("*").eq("id", id).maybeSingle(),
      supabase.from("sales").select("*").eq("customer_id", id).order("created_at", { ascending: false }),
      // Solo los abonos: lo pagado al vender ya figura en cada venta
      supabase.from("payments").select("*").eq("customer_id", id).eq("kind", "abono").order("created_at", { ascending: false }).limit(50),
      supabase.from("consignments").select("*").eq("customer_id", id).order("created_at", { ascending: false }),
      supabase.from("customer_balances").select("balance").eq("customer_id", id).maybeSingle(),
    ]);
    const cust = (c.data as Customer | null) ?? null;
    setCredit(Math.max(0, -Number(bal.data?.balance ?? 0)));
    setCustomer(cust);
    if (cust) setForm({ name: cust.name, phone: cust.phone ?? "", note: cust.note ?? "", credit_limit: cust.credit_limit === null ? "" : String(cust.credit_limit) });
    const list = (s.data ?? []) as Sale[];
    setSales(list);
    setPayments((p.data ?? []) as Payment[]);
    setConsignments((co.data ?? []) as Consignment[]);
    const [its, ci] = await Promise.all([
      list.length ? supabase.from("sale_items").select("*").in("sale_id", list.map((x) => x.id)) : Promise.resolve({ data: [] }),
      co.data?.length ? supabase.from("consignment_items").select("*").in("consignment_id", co.data.map((x) => x.id)).order("created_at") : Promise.resolve({ data: [] }),
    ]);
    setItems((its.data ?? []) as SaleItem[]);
    setConsItems((ci.data ?? []) as ConsignmentItem[]);
    setLoading(false);
  }, [supabase, id]);
  useEffect(() => {
    load();
  }, [load]);

  const debt = debtOf(sales);
  const days = oldestDebtDays(sales);
  const openCons = consignments.filter((c) => c.status === "abierta");
  const outUnits = consItems.filter((i) => openCons.some((c) => c.id === i.consignment_id)).reduce((a, i) => a + (i.qty_out - i.qty_sold - i.qty_returned), 0);
  const unpaid = sales.filter((s) => s.status !== "pagado");
  const limit = customer?.credit_limit ?? null;
  const itemsText = (saleId: string) => items.filter((i) => i.sale_id === saleId).map((i) => `${i.qty} ${i.product_name ?? "producto"}${i.variant_label ? ` (${i.variant_label})` : ""}`).join(", ");

  async function saveForm() {
    if (!form || !customer) return;
    setSaving(true);
    const lim = form.credit_limit.trim() === "" ? null : Math.max(0, Number(form.credit_limit.replace(",", ".")) || 0);
    const { error } = await supabase.from("customers").update({ name: form.name.trim() || customer.name, phone: form.phone.trim() || null, note: form.note.trim() || null, credit_limit: lim }).eq("id", customer.id);
    setSaving(false);
    if (error) return toast("error", friendlyError(error));
    toast("success", "Datos guardados");
    load();
  }

  async function remove() {
    if (!customer) return;
    const ok = await confirm({
      title: `¿Quitar a ${customer.name}?`,
      body: debt > 0 ? `Todavía debe ${money(debt)}. Sus ventas se conservan, pero dejará de aparecer en la lista.` : "Sus ventas se conservan; solo deja de aparecer en la lista.",
      confirmLabel: "Quitar cliente",
      tone: "danger",
    });
    if (!ok) return;
    const { error } = await supabase.from("customers").update({ deleted_at: new Date().toISOString() }).eq("id", customer.id);
    if (error) return toast("error", friendlyError(error));
    router.push("/customers");
  }

  if (loading) return <ListSkeleton rows={4} />;
  if (!customer)
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState title="Cliente no encontrado" body="Puede que lo hayan quitado de la lista." action={<Link href="/customers" className="btn-secondary">Volver a Clientes</Link>} />
      </div>
    );

  return (
    <div className={`${tab === "datos" ? "has-action" : ""} mx-auto max-w-2xl space-y-4`}>
      <header className="animate-in">
        <Link href="/customers" className="mb-2 inline-flex min-h-[44px] items-center gap-1 text-sm text-muted hover:text-brand-700"><IconArrowLeft size={16} /> Clientes</Link>
        <div className="flex items-center gap-3">
          <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-full text-lg font-bold ${debt > 0 ? "bg-warn-100 text-warn-800" : "bg-brand-100 text-brand-800"}`}>{customer.name.slice(0, 1).toUpperCase()}</span>
          <div className="min-w-0 flex-1">
            <h1 className="break-words text-2xl font-bold tracking-tight text-ink">{customer.name}</h1>
            <p className="truncate text-sm text-muted">
              {customer.phone ? <a href={waLink(customer.phone, "")} target="_blank" rel="noreferrer" className="text-ok-700 underline">{customer.phone}</a> : "sin teléfono"}
              {customer.note ? ` · ${customer.note}` : ""}
            </p>
          </div>
        </div>
      </header>

      {/* Saldo */}
      <section className={`animate-in rounded-3xl p-4 text-white shadow-float ${debt > 0 ? "bg-warn-600" : "bg-ok-600"}`}>
        <p className="text-xs font-semibold uppercase tracking-wide text-white/80">{debt > 0 ? "Te debe" : "Al día"}</p>
        <p className="text-4xl font-bold tabular-nums">{money(debt)}</p>
        <p className="text-sm text-white/90">
          {debt > 0 ? `desde hace ${days} día${days === 1 ? "" : "s"} · ${unpaid.length} compra${unpaid.length === 1 ? "" : "s"} sin pagar` : credit > 0 ? `tiene ${money(credit)} a su favor (se usan en su próxima compra fiada)` : "no tiene deudas pendientes"}
          {limit !== null ? ` · límite ${money(Number(limit))}${debt >= Number(limit) ? " (alcanzado)" : ""}` : ""}
        </p>
        {outUnits > 0 && (
          <button type="button" onClick={() => setTab("entregas")} className="mt-1 text-sm font-semibold text-white underline">
            Tiene {outUnits} unid. de tu mercadería →
          </button>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setPaying(true)} className={`btn min-h-[48px] bg-white hover:bg-white/90 ${debt > 0 ? "text-warn-800" : "text-ok-800"}`}>
            <IconCheck size={18} /> Cobrar abono
          </button>
          {debt > 0 ? (
            <a href={waLink(customer.phone, reminderText(customer, sales, items, business?.name ?? null))} target="_blank" rel="noreferrer" className="btn min-h-[48px] bg-white/20 text-white hover:bg-white/30">
              Recordar por WhatsApp
            </a>
          ) : (
            <Link href="/sell" className="btn min-h-[48px] bg-white/20 text-white hover:bg-white/30">Venderle</Link>
          )}
        </div>
      </section>

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { value: "compras", label: "Compras", count: sales.length },
          { value: "abonos", label: "Abonos", count: payments.length },
          { value: "entregas", label: "Mercadería entregada", count: outUnits },
          { value: "datos", label: "Datos" },
        ]}
      />

      {tab === "compras" && (
        <>
          {unpaid.length > 0 && (
            <section className="animate-in card p-3">
              <h2 className="mb-2 text-sm font-bold text-ink">Lo que se llevó y aún debe</h2>
              <ul className="divide-y divide-slate-100 text-sm">
                {unpaid.map((s) => (
                  <li key={s.id} className="py-2">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate">{new Date(s.created_at).toLocaleDateString("es", { day: "2-digit", month: "short" })} · Venta N.º {s.number}</span>
                      <span className="font-bold tabular-nums text-warn-700">{money(Number(s.total) - Number(s.paid))}</span>
                    </div>
                    <p className="text-xs text-muted">{itemsText(s.id)}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {sales.length === 0 ? (
            <EmptyState title="Todavía no le vendiste nada" body="Al vender, elige este cliente en la hoja Cobrar y sus compras aparecerán aquí." action={<Link href="/sell" className="btn-primary">Ir a Vender</Link>} />
          ) : (
            <section className="animate-in card p-3">
              <h2 className="mb-2 text-sm font-bold text-ink">Todas sus compras</h2>
              <ul className="divide-y divide-slate-100 text-sm">
                {sales.slice(0, 50).map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => setOpen(open === s.id ? null : s.id)} className="flex min-h-[48px] w-full items-center gap-2 py-2 text-left">
                      <span className={`badge ${s.status === "pagado" ? "bg-ok-100 text-ok-800" : "bg-warn-100 text-warn-800"}`}>{STATUS_LABEL[s.status]}</span>
                      <span className="min-w-0 flex-1 truncate">{new Date(s.created_at).toLocaleDateString("es", { day: "2-digit", month: "short" })} · N.º {s.number} · {s.items} producto{s.items === 1 ? "" : "s"}</span>
                      <span className="font-bold tabular-nums">{money(Number(s.total))}</span>
                      <IconChevronRight size={16} className={`text-slate-300 transition ${open === s.id ? "rotate-90" : ""}`} />
                    </button>
                    {open === s.id && (
                      <ul className="mb-2 space-y-0.5 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        {items.filter((i) => i.sale_id === s.id).map((i) => (
                          <li key={i.id} className="flex justify-between gap-2"><span>{i.qty} × {i.product_name}{i.variant_label ? ` (${i.variant_label})` : ""}</span><span className="tabular-nums">{money(Number(i.line_total))}</span></li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {tab === "abonos" &&
        (payments.length === 0 ? (
          <EmptyState title="Sin abonos todavía" body="Cuando te pague algo de lo que debe, tócalo en «Cobrar abono» y quedará anotado aquí." />
        ) : (
          <section className="animate-in card p-3">
            <ul className="divide-y divide-slate-100 text-sm">
              {payments.map((p) => (
                <li key={p.id} className="flex min-h-[44px] items-center gap-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-slate-600">{new Date(p.created_at).toLocaleDateString("es", { day: "2-digit", month: "short" })} · {METHOD_LABEL[p.method]}{p.note ? ` · ${p.note}` : ""}</span>
                  <span className="font-bold tabular-nums text-ok-700">{money(Number(p.amount))}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}

      {tab === "entregas" && <ConsignSection customer={customer} consignments={consignments} items={consItems} onChanged={load} />}

      {tab === "datos" && form && (
        <section className="animate-in card space-y-3 p-4">
          <div>
            <label className="label" htmlFor="c-name">Nombre</label>
            <input id="c-name" className="input min-h-[44px]" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="c-phone">Teléfono (WhatsApp)</label>
            <input id="c-phone" className="input min-h-[44px]" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="c-note">Nota</label>
            <input id="c-note" className="input min-h-[44px]" placeholder="p. ej. vive en la esquina" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="c-limit">Límite de fiado ({currencyLabel()})</label>
            <input id="c-limit" type="number" min={0} step="any" inputMode="decimal" className="input min-h-[44px] tabular-nums" placeholder="sin límite" value={form.credit_limit} onChange={(e) => setForm({ ...form, credit_limit: e.target.value })} />
            <p className="mt-1 text-xs text-muted">Al vender a cuenta, la app avisa si con esa venta pasa del límite.</p>
          </div>
          {isOwner && (
            <button type="button" onClick={remove} className="btn-destructive min-h-[44px] w-full"><IconTrash size={16} /> Quitar cliente</button>
          )}
        </section>
      )}
      {/* Fuera de la sección animada: una animación con transform rompería el position: fixed */}
      {tab === "datos" && form && (
        <div className="sticky-action">
          <button type="button" onClick={saveForm} disabled={saving} className="btn-primary btn-lg mx-auto flex w-full max-w-2xl">
            {saving ? <Spinner /> : <IconCheck size={20} />} Guardar datos
          </button>
        </div>
      )}

      <PaySheet open={paying} onClose={() => setPaying(false)} customer={customer} debt={debt} onDone={load} />
    </div>
  );
}
