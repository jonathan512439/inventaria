"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Customer, PayMethod, Product, ProductVariant, Sale, SaleItem, SaleStatus } from "@/types/database";
import CustomerPicker from "@/components/CustomerPicker";
import { debtOf } from "@/lib/customers";
import { SUMMARY_COLS, fmtMoney, fromSummary, stockOf } from "@/lib/inventory";
import { productTitle } from "@/lib/fields";
import { METHOD_LABEL, cartSubtotal, lineTotal, registerSale, suggestedPrice, ticketText, type CartLine } from "@/lib/sales";
import BarcodeCamera from "@/components/BarcodeCamera";
import CoachTip from "@/components/CoachTip";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { useFlow } from "@/components/FlowProvider";
import { IconArrowLeft, IconBox, IconCheck, IconPlus, IconSearch, IconTag, IconTrash, IconX, Spinner } from "@/components/ui/Icons";

/** Vender: carrito con varios productos, medio de pago y ticket. Descuenta el stock y guarda la ganancia real. */
export default function SellPage() {
  const supabase = createClient();
  const toast = useToast();
  const confirm = useConfirm();
  const flow = useFlow();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [picking, setPicking] = useState<{ product: Product; variants: ProductVariant[] } | null>(null);
  const [method, setMethod] = useState<PayMethod>("efectivo");
  const [status, setStatus] = useState<SaleStatus>("pagado");
  const [paid, setPaid] = useState("");
  const [discount, setDiscount] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerDebt, setCustomerDebt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ sale: Sale; items: SaleItem[] } | null>(null);
  const [business, setBusiness] = useState<string | null>(null);
  const [recent, setRecent] = useState<Product[]>([]);

  useEffect(() => {
    supabase.from("profiles").select("business_name").maybeSingle().then(({ data }) => setBusiness(data?.business_name ?? null));
    // Lo más vendido últimamente, para tenerlo a mano
    supabase
      .from("sale_items")
      .select("product_id")
      .order("created_at", { ascending: false })
      .limit(60)
      .then(async ({ data }) => {
        const ids = Array.from(new Set((data ?? []).map((r) => r.product_id).filter(Boolean) as string[])).slice(0, 8);
        if (!ids.length) return;
        const { data: ps } = await supabase.from("product_summaries").select(SUMMARY_COLS).in("id", ids);
        setRecent((ps ?? []).map(fromSummary));
      });
  }, [supabase]);

  // Deuda actual del cliente elegido (para avisar del límite)
  useEffect(() => {
    if (!customer) return setCustomerDebt(0);
    supabase
      .from("sales")
      .select("*")
      .eq("customer_id", customer.id)
      .neq("status", "pagado")
      .then(({ data }) => setCustomerDebt(debtOf((data ?? []) as Sale[])));
  }, [customer, supabase]);

  useEffect(() => {
    const term = q.trim().toLowerCase();
    if (!term) return setResults([]);
    const t = setTimeout(async () => {
      const { data } = await supabase.from("product_summaries").select(SUMMARY_COLS).eq("status", "confirmed").ilike("search", `%${term.replace(/[%_]/g, "")}%`).limit(8);
      setResults((data ?? []).map(fromSummary));
    }, 200);
    return () => clearTimeout(t);
  }, [q, supabase]);

  async function add(p: Product, variant?: ProductVariant | null) {
    if (variant === undefined) {
      const { data: vs } = await supabase.from("product_variants").select("*").eq("product_id", p.id).order("created_at");
      if (vs?.length) return setPicking({ product: p, variants: vs as ProductVariant[] });
      variant = null;
    }
    const key = variant ? variant.id : p.id;
    setLines((ls) => {
      const found = ls.find((l) => l.key === key);
      if (found) return ls.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l));
      return [...ls, { key, product: p, variant: variant ?? null, qty: 1, unitPrice: suggestedPrice(p, variant ?? null) }];
    });
    setPicking(null);
    setQ("");
    setResults([]);
    navigator.vibrate?.(10);
  }

  async function onCode(code: string) {
    const res = await fetch(`/api/barcode?code=${encodeURIComponent(code)}`);
    const json = (await res.json().catch(() => ({}))) as { found?: string; product?: Product; variant?: ProductVariant | null; variants?: ProductVariant[] };
    if (json.found !== "own" || !json.product) return toast("info", `Código ${code}: no está en tu inventario`);
    if (json.variant) return add(json.product, json.variant);
    if (json.variants?.length) return setPicking({ product: json.product, variants: json.variants });
    add(json.product, null);
  }

  const setQty = (key: string, qty: number) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, qty: Math.max(1, qty) } : l)));
  const setPrice = (key: string, raw: string) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, unitPrice: Math.max(0, Number(raw.replace(",", ".")) || 0) } : l)));
  const remove = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));

  const subtotal = cartSubtotal(lines);
  const disc = Math.min(subtotal, Math.max(0, Number(discount.replace(",", ".")) || 0));
  const total = Math.round((subtotal - disc) * 100) / 100;
  const paidNum = status === "pagado" ? total : Math.min(total, Math.max(0, Number(paid.replace(",", ".")) || 0));
  const units = lines.reduce((s, l) => s + l.qty, 0);
  const stockWarn = useMemo(() => lines.filter((l) => l.qty > (l.variant ? l.variant.stock : stockOf(l.product) ?? 0)), [lines]);

  async function finish() {
    if (!lines.length) return;
    if (status !== "pagado" && !customer) return toast("info", "Elige o crea el cliente que va a deber");
    const overLimit = !!customer && customer.credit_limit !== null && status !== "pagado" && customerDebt + (total - paidNum) > Number(customer.credit_limit);
    const ok = await confirm({
      title: "¿Cerramos la venta?",
      body: overLimit
        ? `Ojo: ${customer!.name} pasaría su límite de fiado (Bs ${fmtMoney(Number(customer!.credit_limit))}). Ya debe Bs ${fmtMoney(customerDebt)}.`
        : stockWarn.length
          ? `Ojo: ${stockWarn.length} producto${stockWarn.length === 1 ? "" : "s"} se vende${stockWarn.length === 1 ? "" : "n"} por encima del stock que dice la app; el stock quedará en 0.`
          : "El stock baja al instante y queda el ticket.",
      details: [
        { label: "Productos", value: `${lines.length} · ${units} unid.` },
        ...(disc ? [{ label: "Descuento", value: `−Bs ${fmtMoney(disc)}` }] : []),
        { label: "Total", value: `Bs ${fmtMoney(total)}`, tone: "ok" as const },
        { label: "Pago", value: `${METHOD_LABEL[method]}${status !== "pagado" ? ` · cobrado Bs ${fmtMoney(paidNum)}` : ""}` },
        ...(customer ? [{ label: "Cliente", value: customer.name }] : []),
        ...(status !== "pagado" ? [{ label: "Queda debiendo", value: `Bs ${fmtMoney(total - paidNum)}`, tone: "warn" as const }] : []),
      ],
      confirmLabel: status === "pagado" ? `Cobrar Bs ${fmtMoney(total)}` : "Registrar venta",
      tone: "success",
    });
    if (!ok) return;
    setSaving(true);
    try {
      const out = await registerSale(supabase, lines, { method, status, paid: paidNum, discount: disc, customerId: customer?.id ?? null, customerName: customer?.name ?? null });
      setDone(out);
      setLines([]);
      setDiscount("");
      setPaid("");
      setCustomer(null);
      setStatus("pagado");
      flow.refresh();
      navigator.vibrate?.(30);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "No se pudo registrar la venta");
    } finally {
      setSaving(false);
    }
  }

  function shareTicket() {
    if (!done) return;
    const text = ticketText(done.sale, done.items, business);
    if (navigator.share) navigator.share({ text }).catch(() => window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank"));
    else window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  }

  if (done) {
    const s = done.sale;
    return (
      <div className="mx-auto max-w-md space-y-4">
        <div className="animate-in card text-center">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-emerald-600"><IconCheck size={34} /></span>
          <h1 className="mt-3 text-2xl font-bold text-ink">Venta N.º {s.number} registrada</h1>
          <p className="mt-1 text-3xl font-bold tabular-nums text-emerald-700">Bs {fmtMoney(Number(s.total))}</p>
          <p className="text-sm text-slate-500">{METHOD_LABEL[s.method]}{s.status !== "pagado" ? ` · debe Bs ${fmtMoney(Number(s.total) - Number(s.paid))}` : ""} · el stock ya bajó</p>
          <pre className="mt-4 whitespace-pre-wrap rounded-2xl bg-slate-50 p-3 text-left font-mono text-[12px] leading-snug text-slate-700">{ticketText(s, done.items, business)}</pre>
          <div className="mt-4 grid gap-2">
            <button onClick={shareTicket} className="btn-success btn-lg w-full"><IconTag size={18} /> Enviar ticket por WhatsApp</button>
            <button onClick={() => window.print()} className="btn-secondary w-full">Imprimir</button>
            <button onClick={() => setDone(null)} className="btn-primary w-full"><IconPlus size={18} /> Nueva venta</button>
            <Link href="/movements" className="text-sm font-semibold text-brand-700 underline">Ver ventas del día</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="has-action mx-auto max-w-2xl space-y-4">
      <header className="animate-in">
        <Link href="/dashboard" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"><IconArrowLeft size={16} /> Inicio</Link>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Vender</h1>
        <p className="text-sm text-slate-500">Escanea o busca lo que se lleva el cliente, elige cómo paga y listo: el stock baja solo.</p>
      </header>
      <CoachTip screen="sell" title="Así se vende">
        Agrega productos escaneando o buscando (los más vendidos están a mano), ajusta cantidades, elige cómo paga y toca <b>Cobrar</b>. Al final puedes enviar el ticket por WhatsApp.
      </CoachTip>

      {/* Agregar productos */}
      <section className="animate-in card space-y-3 p-4">
        <div className="relative">
          <IconSearch size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-11" placeholder="Buscar producto…" value={q} onChange={(e) => setQ(e.target.value)} />
          {results.length > 0 && (
            <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-2xl bg-white p-1 shadow-2xl ring-1 ring-slate-900/10">
              {results.map((p) => (
                <li key={p.id}>
                  <button onClick={() => add(p)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-brand-50">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{productTitle(p.data) || "Sin nombre"}</span>
                    <span className="text-xs text-slate-500">Bs {fmtMoney(suggestedPrice(p, null))} · {stockOf(p) ?? 0} en stock</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <BarcodeCamera onCode={onCode} label="Escanear producto" />
        {recent.length > 0 && !q && (
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Los más vendidos</p>
            <div className="flex flex-wrap gap-1.5">
              {recent.map((p) => (
                <button key={p.id} onClick={() => add(p)} className="chip py-1 text-xs">{productTitle(p.data) || "Producto"}</button>
              ))}
            </div>
          </div>
        )}
        {picking && (
          <div className="rounded-2xl bg-violet-50 p-3">
            <p className="text-xs font-semibold text-violet-900">{productTitle(picking.product.data)} · ¿cuál se lleva?</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {picking.variants.map((v) => (
                <button key={v.id} onClick={() => add(picking.product, v)} disabled={v.stock <= 0} className="rounded-full border-2 border-violet-300 bg-white px-3 py-1 text-sm font-semibold text-violet-800 disabled:opacity-40">{v.label} <span className="opacity-60">{v.stock}</span></button>
              ))}
              <button onClick={() => setPicking(null)} className="btn-ghost btn-sm"><IconX size={14} /></button>
            </div>
          </div>
        )}
      </section>

      {/* Carrito */}
      <section className="animate-in card p-4">
        {lines.length === 0 ? (
          <p className="flex items-center justify-center gap-2 py-6 text-sm text-slate-500"><IconBox size={18} /> Todavía no hay productos en la venta.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {lines.map((l) => {
              const stock = l.variant ? l.variant.stock : stockOf(l.product) ?? 0;
              return (
                <li key={l.key} className="space-y-2 py-3">
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-ink">{productTitle(l.product.data) || "Producto"}{l.variant ? <span className="text-violet-800"> · {l.variant.label}</span> : null}</span>
                      <span className={`block text-xs ${l.qty > stock ? "text-rose-600" : "text-slate-500"}`}>{l.qty > stock ? `solo hay ${stock} en stock` : `${stock} en stock`}</span>
                    </span>
                    <span className="font-bold tabular-nums text-ink">Bs {fmtMoney(lineTotal(l))}</span>
                    <button onClick={() => remove(l.key)} className="rounded-full p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600" aria-label="Quitar"><IconTrash size={16} /></button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center rounded-xl border-2 border-slate-200">
                      <button onClick={() => setQty(l.key, l.qty - 1)} className="px-3 py-1.5 text-lg font-bold text-slate-600">−</button>
                      <input type="number" min={1} inputMode="numeric" className="w-14 border-0 bg-transparent text-center text-base font-bold tabular-nums outline-none" value={l.qty} onChange={(e) => setQty(l.key, parseInt(e.target.value, 10) || 1)} />
                      <button onClick={() => setQty(l.key, l.qty + 1)} className="px-3 py-1.5 text-lg font-bold text-slate-600">+</button>
                    </div>
                    <label className="flex items-center gap-1 text-xs text-slate-500">
                      a Bs
                      <input type="number" min={0} step="any" inputMode="decimal" className="input w-24 py-1.5 text-center tabular-nums" value={l.unitPrice} onChange={(e) => setPrice(l.key, e.target.value)} />
                      c/u
                    </label>
                    {Number(l.product.data.precio_mayorista) > 0 && l.unitPrice !== Number(l.product.data.precio_mayorista) && (
                      <button onClick={() => setPrice(l.key, String(l.product.data.precio_mayorista))} className="chip py-1 text-xs">Mayorista Bs {fmtMoney(Number(l.product.data.precio_mayorista))}</button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Pago */}
      {lines.length > 0 && (
        <section className="animate-in card space-y-3 p-4">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Cliente {status === "pagado" ? "(opcional)" : ""}</p>
            <CustomerPicker value={customer} onChange={setCustomer} required={status !== "pagado"} />
            {customer && customerDebt > 0 && <p className="mt-1 text-xs text-amber-800">Ya debe Bs {fmtMoney(customerDebt)}{customer.credit_limit !== null ? ` · límite Bs ${fmtMoney(Number(customer.credit_limit))}` : ""}.</p>}
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-600">Subtotal</span>
            <span className="font-semibold tabular-nums">Bs {fmtMoney(subtotal)}</span>
          </div>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="text-slate-600">Descuento (Bs)</span>
            <input type="number" min={0} step="any" inputMode="decimal" className="input w-28 py-1.5 text-right tabular-nums" placeholder="0" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </label>
          <div className="flex items-center justify-between border-t border-slate-100 pt-2">
            <span className="font-bold text-ink">Total</span>
            <span className="text-2xl font-bold tabular-nums text-emerald-700">Bs {fmtMoney(total)}</span>
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">¿Cómo paga?</p>
            <div className="grid grid-cols-3 gap-2">
              {(["efectivo", "qr", "transferencia"] as PayMethod[]).map((m) => (
                <button key={m} onClick={() => setMethod(m)} className={`rounded-xl border-2 px-2 py-2 text-sm font-semibold ${method === m ? "border-brand-500 bg-brand-500 text-white" : "border-slate-200 bg-white text-slate-700"}`}>{METHOD_LABEL[m]}</button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">¿Paga todo ahora?</p>
            <div className="grid grid-cols-3 gap-2">
              {([["pagado", "Sí, todo"], ["parcial", "Una parte"], ["fiado", "Fiado"]] as [SaleStatus, string][]).map(([k, t]) => (
                <button key={k} onClick={() => setStatus(k)} className={`rounded-xl border-2 px-2 py-2 text-sm font-semibold ${status === k ? (k === "pagado" ? "border-emerald-500 bg-emerald-500 text-white" : "border-amber-500 bg-amber-500 text-white") : "border-slate-200 bg-white text-slate-700"}`}>{t}</button>
              ))}
            </div>
            {status !== "pagado" && (
              <div className="mt-2 grid gap-2 rounded-2xl bg-amber-50 p-3 sm:grid-cols-2">
                {status === "parcial" && (
                  <label className="text-xs font-semibold text-amber-900">
                    ¿Cuánto paga ahora? (Bs)
                    <input type="number" min={0} step="any" inputMode="decimal" className="input mt-1 py-1.5 tabular-nums" value={paid} onChange={(e) => setPaid(e.target.value)} />
                  </label>
                )}
                <p className="text-[11px] text-amber-800 sm:col-span-2">Queda pendiente <b>Bs {fmtMoney(total - paidNum)}</b> a nombre de {customer ? <b>{customer.name}</b> : "el cliente que elijas arriba"}. Lo verás en su ficha, con sus productos, para cobrarlo o recordárselo por WhatsApp.</p>
              </div>
            )}
          </div>
        </section>
      )}

      <div className="sticky-action">
        <button onClick={finish} disabled={saving || !lines.length} className="btn-success btn-lg w-full">
          {saving ? <Spinner /> : <IconCheck size={20} />} {lines.length ? (status === "pagado" ? `Cobrar Bs ${fmtMoney(total)}` : `Registrar venta · Bs ${fmtMoney(total)}`) : "Agrega productos para vender"}
        </button>
      </div>
    </div>
  );
}
