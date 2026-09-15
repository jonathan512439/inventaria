"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Consignment, ConsignmentItem, Customer, PayMethod, Payment, Sale, SaleItem } from "@/types/database";
import { fmtMoney } from "@/lib/inventory";
import { METHOD_LABEL, STATUS_LABEL } from "@/lib/sales";
import { debtOf, oldestDebtDays, registerPayment, reminderText, waLink } from "@/lib/customers";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { IconArrowLeft, IconCheck, IconChevronRight, IconEdit, IconTag, IconTrash, IconX, Spinner } from "@/components/ui/Icons";

export default function CustomerDetailPage() {
  return (
    <Suspense>
      <CustomerDetail />
    </Suspense>
  );
}

/** Ficha del cliente: saldo con detalle, abonar, recordar por WhatsApp, compras, entregas y datos. */
function CustomerDetail() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const supabase = createClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [items, setItems] = useState<SaleItem[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [consignments, setConsignments] = useState<Consignment[]>([]);
  const [consItems, setConsItems] = useState<ConsignmentItem[]>([]);
  const [business, setBusiness] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState<{ amount: string; method: PayMethod; note: string } | null>(null);
  const [editing, setEditing] = useState<{ name: string; phone: string; note: string; credit_limit: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const [c, s, p, co, prof] = await Promise.all([
      supabase.from("customers").select("*").eq("id", id).maybeSingle(),
      supabase.from("sales").select("*").eq("customer_id", id).order("created_at", { ascending: false }),
      supabase.from("payments").select("*").eq("customer_id", id).order("created_at", { ascending: false }).limit(50),
      supabase.from("consignments").select("*").eq("customer_id", id).order("created_at", { ascending: false }),
      supabase.from("profiles").select("business_name").maybeSingle(),
    ]);
    setCustomer((c.data as Customer | null) ?? null);
    const list = (s.data ?? []) as Sale[];
    setSales(list);
    setPayments((p.data ?? []) as Payment[]);
    setConsignments((co.data ?? []) as Consignment[]);
    setBusiness(prof.data?.business_name ?? null);
    if (list.length) {
      const { data: its } = await supabase.from("sale_items").select("*").in("sale_id", list.map((x) => x.id));
      setItems((its ?? []) as SaleItem[]);
    }
    if (co.data?.length) {
      const { data: ci } = await supabase.from("consignment_items").select("*").in("consignment_id", co.data.map((x) => x.id));
      setConsItems((ci ?? []) as ConsignmentItem[]);
    }
    setLoading(false);
  }, [supabase, id]);
  useEffect(() => {
    load();
  }, [load]);

  const debt = debtOf(sales);
  const days = oldestDebtDays(sales);
  const openCons = consignments.filter((c) => c.status === "abierta");
  const outUnits = consItems.filter((i) => openCons.some((c) => c.id === i.consignment_id)).reduce((a, i) => a + (i.qty_out - i.qty_sold - i.qty_returned), 0);

  async function pay() {
    if (!paying || !customer) return;
    const amount = Number(paying.amount.replace(",", ".")) || 0;
    if (amount <= 0) return toast("info", "Escribe cuánto paga");
    const ok = await confirm({
      title: "¿Registramos el abono?",
      body: "Se descuenta de lo más antiguo que debe.",
      details: [
        { label: "Paga", value: `Bs ${fmtMoney(amount)} · ${METHOD_LABEL[paying.method]}`, tone: "ok" },
        { label: "Debía", value: `Bs ${fmtMoney(debt)}` },
        { label: "Le quedará", value: `Bs ${fmtMoney(Math.max(0, debt - amount))}`, tone: debt - amount > 0 ? "warn" : "ok" },
      ],
      confirmLabel: "Sí, abonar",
      tone: "success",
    });
    if (!ok) return;
    setSaving(true);
    try {
      const r = await registerPayment(supabase, customer.id, amount, paying.method, paying.note);
      toast("success", r.left > 0 ? `Abono registrado. Sobraron Bs ${fmtMoney(r.left)} a favor de ${customer.name}.` : `Abono de Bs ${fmtMoney(amount)} registrado`);
      setPaying(null);
      load();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "No se pudo registrar el abono");
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit() {
    if (!editing || !customer) return;
    const limit = editing.credit_limit.trim() === "" ? null : Math.max(0, Number(editing.credit_limit.replace(",", ".")) || 0);
    const { error } = await supabase.from("customers").update({ name: editing.name.trim() || customer.name, phone: editing.phone.trim() || null, note: editing.note.trim() || null, credit_limit: limit }).eq("id", customer.id);
    if (error) return toast("error", error.message);
    setEditing(null);
    toast("success", "Datos guardados");
    load();
  }

  async function remove() {
    if (!customer) return;
    const ok = await confirm({
      title: `¿Quitar a ${customer.name}?`,
      body: debt > 0 ? `Todavía debe Bs ${fmtMoney(debt)}. Sus ventas se conservan, pero dejará de aparecer en la lista.` : "Sus ventas se conservan; solo deja de aparecer en la lista.",
      confirmLabel: "Quitar cliente",
      tone: "danger",
    });
    if (!ok) return;
    await supabase.from("customers").update({ deleted_at: new Date().toISOString() }).eq("id", customer.id);
    router.push("/customers");
  }

  if (loading) return <ListSkeleton rows={4} />;
  if (!customer) return <div className="card text-sm">Cliente no encontrado. <Link href="/customers" className="text-brand-600 underline">Volver</Link></div>;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <header className="animate-in">
        <Link href="/customers" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"><IconArrowLeft size={16} /> Clientes</Link>
        <div className="flex items-start gap-3">
          <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-full text-lg font-bold ${debt > 0 ? "bg-amber-100 text-amber-800" : "bg-brand-100 text-brand-800"}`}>{customer.name.slice(0, 1).toUpperCase()}</span>
          <div className="min-w-0 flex-1">
            <h1 className="break-words text-2xl font-bold tracking-tight text-ink">{customer.name}</h1>
            <p className="text-sm text-slate-500">
              {customer.phone ? <a href={waLink(customer.phone, "")} target="_blank" rel="noreferrer" className="text-emerald-700 underline">{customer.phone}</a> : "sin teléfono"}
              {customer.note ? ` · ${customer.note}` : ""}
            </p>
          </div>
          <button onClick={() => setEditing({ name: customer.name, phone: customer.phone ?? "", note: customer.note ?? "", credit_limit: customer.credit_limit === null ? "" : String(customer.credit_limit) })} className="btn-ghost btn-sm" aria-label="Editar"><IconEdit size={18} /></button>
        </div>
      </header>

      {editing && (
        <div className="animate-in card space-y-2 p-4">
          <div className="flex items-center justify-between"><p className="font-bold text-ink">Datos del cliente</p><button onClick={() => setEditing(null)} className="btn-ghost btn-sm"><IconX size={16} /></button></div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input className="input" placeholder="Nombre" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <input className="input" placeholder="Teléfono (WhatsApp)" inputMode="tel" value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
            <input className="input" placeholder="Nota (p. ej. vive en la esquina)" value={editing.note} onChange={(e) => setEditing({ ...editing, note: e.target.value })} />
            <label className="flex items-center gap-2 text-xs text-slate-600">
              Límite de fiado (Bs)
              <input type="number" min={0} step="any" inputMode="decimal" className="input py-1.5 tabular-nums" placeholder="sin límite" value={editing.credit_limit} onChange={(e) => setEditing({ ...editing, credit_limit: e.target.value })} />
            </label>
          </div>
          <div className="flex gap-2">
            <button onClick={saveEdit} className="btn-primary flex-1">Guardar</button>
            <button onClick={remove} className="btn-destructive btn-sm"><IconTrash size={14} /> Quitar</button>
          </div>
        </div>
      )}

      {/* Saldo */}
      <section className={`animate-in rounded-3xl p-4 text-white shadow-float ${debt > 0 ? "bg-amber-600" : "bg-emerald-600"}`}>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-white/75">{debt > 0 ? "Te debe" : "Al día"}</p>
        <p className="text-3xl font-bold tabular-nums">Bs {fmtMoney(debt)}</p>
        <p className="text-xs text-white/85">
          {debt > 0 ? `desde hace ${days} día${days === 1 ? "" : "s"}` : "no tiene deudas pendientes"}
          {customer.credit_limit !== null ? ` · límite Bs ${fmtMoney(Number(customer.credit_limit))}${debt >= Number(customer.credit_limit) ? " (alcanzado)" : ""}` : ""}
          {outUnits ? ` · ${outUnits} unid. entregadas` : ""}
        </p>
        {debt > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button onClick={() => setPaying({ amount: String(debt), method: "efectivo", note: "" })} className="btn bg-white py-2.5 text-amber-800 hover:bg-white/90"><IconCheck size={18} /> Abonar</button>
            <a href={waLink(customer.phone, reminderText(customer, sales, items, business))} target="_blank" rel="noreferrer" className="btn bg-white/20 py-2.5 text-white hover:bg-white/30"><IconTag size={18} /> Recordar por WhatsApp</a>
          </div>
        )}
      </section>

      {paying && (
        <div className="animate-in card space-y-2 p-4">
          <div className="flex items-center justify-between"><p className="font-bold text-ink">Abono</p><button onClick={() => setPaying(null)} className="btn-ghost btn-sm"><IconX size={16} /></button></div>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <input type="number" min={0} step="any" inputMode="decimal" className="input text-2xl font-bold tabular-nums" value={paying.amount} onChange={(e) => setPaying({ ...paying, amount: e.target.value })} autoFocus />
            <div className="flex gap-1">
              {(["efectivo", "qr", "transferencia"] as PayMethod[]).map((m) => (
                <button key={m} onClick={() => setPaying({ ...paying, method: m })} className={`chip ${paying.method === m ? "chip-active" : ""}`}>{METHOD_LABEL[m]}</button>
              ))}
            </div>
          </div>
          <input className="input" placeholder="Nota (opcional)" value={paying.note} onChange={(e) => setPaying({ ...paying, note: e.target.value })} />
          <button onClick={pay} disabled={saving} className="btn-success w-full">{saving ? <Spinner size={16} /> : <IconCheck size={18} />} Registrar abono</button>
        </div>
      )}

      {/* Lo que debe, por ticket */}
      {sales.some((s) => s.status !== "pagado") && (
        <section className="animate-in card p-3">
          <h2 className="mb-2 text-sm font-bold text-ink">Lo que se llevó y aún debe</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {sales.filter((s) => s.status !== "pagado").map((s) => (
              <li key={s.id} className="py-2">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{new Date(s.created_at).toLocaleDateString("es", { day: "2-digit", month: "short" })} · Venta N.º {s.number}</span>
                  <span className="font-bold tabular-nums text-amber-700">Bs {fmtMoney(Number(s.total) - Number(s.paid))}</span>
                </div>
                <p className="truncate text-xs text-slate-500">{items.filter((i) => i.sale_id === s.id).map((i) => `${i.qty} ${i.product_name ?? "producto"}${i.variant_label ? ` (${i.variant_label})` : ""}`).join(", ")}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Entregas abiertas */}
      {openCons.length > 0 && (
        <section className="animate-in card p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-bold text-ink">Mercadería que tiene para vender</h2>
            <Link href="/consign" className="text-xs font-semibold text-brand-700 underline">Liquidar</Link>
          </div>
          <ul className="divide-y divide-slate-100 text-sm">
            {consItems.filter((i) => openCons.some((c) => c.id === i.consignment_id) && i.qty_out - i.qty_sold - i.qty_returned > 0).map((i) => (
              <li key={i.id} className="flex items-center gap-2 py-1.5">
                <span className="min-w-0 flex-1 truncate">{i.product_name}{i.variant_label ? <span className="text-violet-800"> · {i.variant_label}</span> : null}</span>
                <span className="font-semibold tabular-nums">{i.qty_out - i.qty_sold - i.qty_returned} unid.</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Compras */}
      <section className="animate-in card p-3">
        <h2 className="mb-2 text-sm font-bold text-ink">Compras ({sales.length})</h2>
        {sales.length === 0 ? (
          <p className="text-sm text-slate-500">Todavía no le has vendido nada con su nombre.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {sales.slice(0, 30).map((s) => (
              <li key={s.id}>
                <button onClick={() => setOpen(open === s.id ? null : s.id)} className="flex w-full items-center gap-2 py-2 text-left">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${s.status === "pagado" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{s.status === "pagado" ? "Pagado" : STATUS_LABEL[s.status]}</span>
                  <span className="min-w-0 flex-1 truncate">{new Date(s.created_at).toLocaleDateString("es", { day: "2-digit", month: "short" })} · N.º {s.number} · {s.items} producto{s.items === 1 ? "" : "s"}</span>
                  <span className="font-bold tabular-nums">Bs {fmtMoney(Number(s.total))}</span>
                  <IconChevronRight size={14} className={`text-slate-300 transition ${open === s.id ? "rotate-90" : ""}`} />
                </button>
                {open === s.id && (
                  <ul className="mb-2 space-y-0.5 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    {items.filter((i) => i.sale_id === s.id).map((i) => (
                      <li key={i.id} className="flex justify-between"><span>{i.qty} × {i.product_name}{i.variant_label ? ` (${i.variant_label})` : ""}</span><span className="tabular-nums">Bs {fmtMoney(Number(i.line_total))}</span></li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {payments.length > 0 && (
        <section className="animate-in card p-3">
          <h2 className="mb-2 text-sm font-bold text-ink">Abonos</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center gap-2 py-1.5">
                <span className="min-w-0 flex-1 truncate text-slate-600">{new Date(p.created_at).toLocaleDateString("es", { day: "2-digit", month: "short" })} · {METHOD_LABEL[p.method]}{p.note ? ` · ${p.note}` : ""}</span>
                <span className="font-bold tabular-nums text-emerald-700">Bs {fmtMoney(Number(p.amount))}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
