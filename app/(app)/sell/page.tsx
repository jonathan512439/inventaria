"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Customer, PayMethod, Product, ProductVariant, Sale, SaleItem, SaleStatus } from "@/types/database";
import CustomerPicker from "@/components/CustomerPicker";
import ProductFinder from "@/components/ProductFinder";
import { debtOf } from "@/lib/customers";
import { currencyLabel, fromSummary, money, stockOf, SUMMARY_COLS } from "@/lib/inventory";
import { productTitle } from "@/lib/fields";
import { METHOD_LABEL, cartSubtotal, lineTotal, registerSale, suggestedPrice, ticketText, type CartLine } from "@/lib/sales";
import { useToast } from "@/components/ui/Toast";
import { useFlow } from "@/components/FlowProvider";
import { newOpId } from "@/lib/data/ops";
import { friendlyError } from "@/lib/errors";
import Sheet from "@/components/ui/Sheet";
import { EmptyState, ScreenHeader } from "@/components/ui/Screen";
import { NumberPad, QtyStepper, padNumber } from "@/components/ui/NumberPad";
import { IconAlert, IconCart, IconCheck, IconPlus, IconRegister, IconTag, IconTrash, Spinner } from "@/components/ui/Icons";

type SplitMethod = "efectivo" | "qr" | "transferencia";
const SPLIT_METHODS: SplitMethod[] = ["efectivo", "qr", "transferencia"];
type PayMode = "todo" | "parte" | "fiado";

/**
 * Vender (C7.2 · RECONSTRUCCION_VISUAL.md §3.2): buscar o escanear → carrito → «Cobrar» (hoja con teclado grande,
 * vuelto, varios medios, fiado con cliente) → ticket. Todo se guarda en una operación (register_sale, 021/022).
 */
export default function SellPage() {
  const supabase = createClient();
  const toast = useToast();
  const flow = useFlow();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [recent, setRecent] = useState<Product[]>([]);
  const [charging, setCharging] = useState(false);
  const [method, setMethod] = useState<PayMethod>("efectivo");
  const [mode, setMode] = useState<PayMode>("todo");
  const [received, setReceived] = useState(""); // efectivo: con cuánto paga (para el vuelto)
  const [part, setPart] = useState(""); // QR/transferencia: cuánto paga ahora si paga una parte
  const [split, setSplit] = useState<Record<SplitMethod, string>>({ efectivo: "", qr: "", transferencia: "" });
  const [discount, setDiscount] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerDebt, setCustomerDebt] = useState(0);
  const [saving, setSaving] = useState(false);
  // Id de la venta en curso (idempotencia): si se corta la red y se vuelve a tocar «Cobrar», no se duplica
  const [saleId, setSaleId] = useState(newOpId);
  const [done, setDone] = useState<{ sale: Sale; items: SaleItem[]; change: number } | null>(null);
  const business = flow.business?.name ?? null;

  useEffect(() => {
    // Lo más vendido últimamente, a mano
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

  useEffect(() => {
    if (!customer) return setCustomerDebt(0);
    supabase
      .from("sales")
      .select("*")
      .eq("customer_id", customer.id)
      .neq("status", "pagado")
      .then(({ data }) => setCustomerDebt(debtOf((data ?? []) as Sale[])));
  }, [customer, supabase]);

  function add(p: Product, variant: ProductVariant | null) {
    const key = variant ? variant.id : p.id;
    setLines((ls) => {
      const found = ls.find((l) => l.key === key);
      if (found) return ls.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l));
      return [...ls, { key, product: p, variant, qty: 1, unitPrice: suggestedPrice(p, variant) }];
    });
  }
  async function addRecent(p: Product) {
    const { data: vs } = await supabase.from("product_variants").select("id").eq("product_id", p.id).limit(1);
    if (vs?.length) return toast("info", "Este producto tiene tallas o colores: búscalo o escanéalo para elegir cuál");
    add(p, null);
  }
  const setQty = (key: string, qty: number) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, qty: Math.max(1, qty) } : l)));
  const setPrice = (key: string, raw: string) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, unitPrice: Math.max(0, Number(raw.replace(",", ".")) || 0) } : l)));
  const remove = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));

  // ---- Totales y cobro ----
  const subtotal = cartSubtotal(lines);
  const disc = Math.min(subtotal, Math.max(0, Number(discount.replace(",", ".")) || 0));
  const total = Math.round((subtotal - disc) * 100) / 100;
  const units = lines.reduce((s, l) => s + l.qty, 0);
  const splitPays = method === "mixto" ? SPLIT_METHODS.map((m) => ({ method: m, amount: Math.round(padNumber(split[m]) * 100) / 100 })).filter((p) => p.amount > 0) : null;
  const splitSum = Math.round((splitPays ?? []).reduce((s, p) => s + p.amount, 0) * 100) / 100;
  const receivedNum = padNumber(received);
  const paidNow =
    method === "mixto" ? Math.min(total, splitSum) : mode === "todo" ? total : mode === "fiado" ? 0 : Math.min(total, method === "efectivo" ? receivedNum : padNumber(part));
  const status: SaleStatus = paidNow >= total ? "pagado" : paidNow > 0 ? "parcial" : "fiado";
  const change = method === "efectivo" && mode === "todo" && receivedNum > total ? Math.round((receivedNum - total) * 100) / 100 : 0;
  const shortCash = method === "efectivo" && mode === "todo" && received !== "" && receivedNum < total;
  const owes = Math.round((total - paidNow) * 100) / 100;
  const overLimit = !!customer && customer.credit_limit !== null && owes > 0 && customerDebt + owes > Number(customer.credit_limit);
  const stockWarn = useMemo(() => lines.filter((l) => l.qty > (l.variant ? l.variant.stock : stockOf(l.product) ?? 0)), [lines]);
  // Montos rápidos de efectivo: exacto y los billetes redondos siguientes
  const quick = useMemo(() => {
    const out = new Set<number>([total]);
    for (const step of [10, 20, 50, 100, 200]) out.add(Math.ceil(total / step) * step);
    return Array.from(out).filter((n) => n >= total).sort((a, b) => a - b).slice(0, 5);
  }, [total]);

  function openCharge() {
    setMethod("efectivo");
    setMode("todo");
    setReceived("");
    setPart("");
    setCharging(true);
  }

  async function finish() {
    if (!lines.length) return;
    if (method === "mixto" && splitSum > total) return toast("info", `Los montos suman ${money(splitSum)} y el total es ${money(total)}: anota solo lo que se queda (el vuelto no)`);
    if (method === "mixto" && splitSum === 0) return toast("info", "Escribe cuánto paga con cada medio");
    if (shortCash) return toast("info", `Faltan ${money(total - receivedNum)}: completa el efectivo o elige «Paga una parte»`);
    if (status !== "pagado" && !customer) return toast("info", "Elige o crea el cliente que va a deber");
    setSaving(true);
    try {
      const out = await registerSale(supabase, lines, {
        id: saleId,
        method,
        status,
        paid: paidNow,
        payments: splitPays,
        discount: disc,
        customerId: customer?.id ?? null,
        customerName: customer?.name ?? null,
      });
      setDone({ ...out, change });
      setSaleId(newOpId());
      setLines([]);
      setDiscount("");
      setSplit({ efectivo: "", qr: "", transferencia: "" });
      setCustomer(null);
      setCharging(false);
      flow.refresh();
      navigator.vibrate?.(30);
    } catch (e) {
      toast("error", friendlyError(e, "No se pudo registrar la venta"));
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

  // ---- Venta registrada ----
  if (done) {
    const s = done.sale;
    return (
      <div className="mx-auto max-w-md space-y-4">
        <div className="animate-in card text-center">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-ok-100 text-ok-600"><IconCheck size={34} /></span>
          <h1 className="mt-3 text-2xl font-bold text-ink">Venta N.º {s.number} registrada</h1>
          <p className="mt-1 text-3xl font-bold tabular-nums text-ok-700">{money(Number(s.total))}</p>
          {done.change > 0 && <p className="mt-2 rounded-2xl bg-warn-100 px-3 py-2 text-lg font-bold text-warn-900">Vuelto: {money(done.change)}</p>}
          <p className="mt-1 text-sm text-muted">{METHOD_LABEL[s.method]}{s.status !== "pagado" ? ` · debe ${money(Number(s.total) - Number(s.paid))}` : ""} · el stock ya bajó</p>
          <pre className="mt-4 whitespace-pre-wrap rounded-2xl bg-slate-50 p-3 text-left font-mono text-xs leading-snug text-slate-700">{ticketText(s, done.items, business)}</pre>
          <div className="mt-4 grid gap-2">
            <button onClick={() => setDone(null)} className="btn-primary btn-lg w-full"><IconPlus size={18} /> Nueva venta</button>
            <button onClick={shareTicket} className="btn-success w-full"><IconTag size={18} /> Enviar ticket por WhatsApp</button>
            <button onClick={() => window.print()} className="btn-secondary w-full">Imprimir</button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Mostrador ----
  return (
    <div className="has-action mx-auto max-w-2xl space-y-4">
      <ScreenHeader
        title="Vender"
        action={
          <Link href="/sell/cash" className="btn-secondary btn-sm min-h-[44px] shrink-0"><IconRegister size={18} /> Caja</Link>
        }
        help={
          <>
            <p><b>1.</b> Busca o escanea lo que se lleva el cliente. Los más vendidos aparecen abajo para tocarlos.</p>
            <p><b>2.</b> Ajusta cantidades o el precio de una línea si hace falta.</p>
            <p><b>3.</b> Toca <b>Cobrar</b>: elige cómo paga. En efectivo, escribe con cuánto paga y la app te dice el vuelto. Si queda debiendo, elige al cliente.</p>
            <p>El stock baja solo y queda el ticket para enviar por WhatsApp.</p>
          </>
        }
      />

      <section className="animate-in card space-y-3 p-4">
        <ProductFinder onPick={add} disableOutOfStockVariants />
        {recent.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Los más vendidos</p>
            <div className="flex flex-wrap gap-1.5">
              {recent.map((p) => (
                <button key={p.id} type="button" onClick={() => addRecent(p)} className="chip min-h-[40px]">{productTitle(p.data) || "Producto"}</button>
              ))}
            </div>
          </div>
        )}
      </section>

      {lines.length === 0 ? (
        <EmptyState icon={<IconCart size={26} />} title="La venta está vacía" body="Busca o escanea un producto para empezar." />
      ) : (
        <section className="animate-in card p-2">
          <ul className="divide-y divide-slate-100">
            {lines.map((l) => {
              const stock = l.variant ? l.variant.stock : stockOf(l.product) ?? 0;
              const wholesale = Number(l.product.data.precio_mayorista) || 0;
              return (
                <li key={l.key} className="space-y-2 px-2 py-3">
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-semibold text-ink">{productTitle(l.product.data) || "Producto"}{l.variant ? <span className="text-violet-800"> · {l.variant.label}</span> : null}</span>
                      <span className={`block text-xs ${l.qty > stock ? "font-semibold text-danger-600" : "text-muted"}`}>{l.qty > stock ? `solo hay ${stock} en stock` : `${stock} en stock`}</span>
                    </span>
                    <span className="text-base font-bold tabular-nums text-ink">{money(lineTotal(l))}</span>
                    <button type="button" onClick={() => remove(l.key)} className="grid h-11 w-11 place-items-center rounded-full text-slate-400 hover:bg-danger-50 hover:text-danger-600" aria-label={`Quitar ${productTitle(l.product.data)}`}><IconTrash size={18} /></button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <QtyStepper value={l.qty} onChange={(n) => setQty(l.key, n)} />
                    <label className="flex items-center gap-1 text-xs text-muted">
                      a {currencyLabel()}
                      <input type="number" min={0} step="any" inputMode="decimal" className="input w-24 py-2 text-center tabular-nums" value={l.unitPrice} onChange={(e) => setPrice(l.key, e.target.value)} aria-label="Precio por unidad" />
                    </label>
                    {wholesale > 0 && l.unitPrice !== wholesale && (
                      <button type="button" onClick={() => setPrice(l.key, String(wholesale))} className="chip min-h-[40px]">Mayorista {money(wholesale)}</button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="sticky-action">
        <button type="button" onClick={openCharge} disabled={!lines.length} className="btn-success btn-lg w-full">
          <IconCheck size={20} /> {lines.length ? `Cobrar ${money(subtotal)} · ${units} unid.` : "Agrega productos para vender"}
        </button>
      </div>

      {/* Hoja «Cobrar» */}
      <Sheet
        open={charging}
        onClose={() => setCharging(false)}
        title="Cobrar"
        footer={
          <button type="button" onClick={finish} disabled={saving} className="btn-success btn-lg w-full">
            {saving ? <Spinner /> : <IconCheck size={20} />} {status === "pagado" ? `Cobrar ${money(total)}` : `Registrar · debe ${money(owes)}`}
          </button>
        }
      >
        <div className="space-y-4">
          <div className="flex items-end justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Total</p>
              <p className="text-4xl font-bold tabular-nums text-ok-700">{money(total)}</p>
            </div>
            <label className="text-right text-xs text-muted">
              Descuento ({currencyLabel()})
              <input type="number" min={0} step="any" inputMode="decimal" className="input mt-1 w-28 py-2 text-right tabular-nums" placeholder="0" value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </label>
          </div>

          {/* Cómo paga */}
          <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Cómo paga">
            {(["efectivo", "qr", "transferencia", "mixto"] as PayMethod[]).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => setMethod(m)} className={`min-h-[48px] rounded-2xl border-2 px-1 text-sm font-semibold ${method === m ? "border-brand-500 bg-brand-500 text-white" : "border-slate-200 bg-white text-slate-700"}`}>
                {m === "mixto" ? "Varios" : m === "transferencia" ? "Transf." : METHOD_LABEL[m]}
              </button>
            ))}
          </div>

          {method === "mixto" ? (
            <div className="grid gap-2 rounded-2xl bg-slate-50 p-3">
              {SPLIT_METHODS.map((m) => (
                <label key={m} className="flex items-center justify-between gap-2 text-sm font-semibold text-slate-700">
                  {METHOD_LABEL[m]}
                  <input type="number" min={0} step="any" inputMode="decimal" className="input w-32 py-2 text-right tabular-nums" placeholder="0" value={split[m]} onChange={(e) => setSplit({ ...split, [m]: e.target.value })} />
                </label>
              ))}
              <p className={`text-sm font-semibold ${splitSum > total ? "text-danger-700" : splitSum < total ? "text-warn-800" : "text-ok-700"}`}>
                {splitSum > total ? `Suman ${money(splitSum)}: anota solo lo que se queda (el vuelto no)` : splitSum < total ? `Faltan ${money(total - splitSum)}${splitSum > 0 ? ": quedan a cuenta del cliente" : ""}` : "✓ La suma es exacta"}
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="¿Paga todo?">
                {([["todo", "Paga todo"], ["parte", "Paga una parte"], ["fiado", "A cuenta"]] as [PayMode, string][]).map(([k, t]) => (
                  <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)} className={`min-h-[44px] rounded-2xl border-2 px-1 text-sm font-semibold ${mode === k ? (k === "todo" ? "border-ok-500 bg-ok-500 text-white" : "border-warn-500 bg-warn-500 text-white") : "border-slate-200 bg-white text-slate-700"}`}>{t}</button>
                ))}
              </div>
              {method === "efectivo" && mode !== "fiado" && (
                <div className="space-y-2 rounded-2xl bg-slate-50 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-700">{mode === "todo" ? "¿Con cuánto paga?" : "¿Cuánto paga ahora?"}</span>
                    <span className="text-2xl font-bold tabular-nums text-ink">{received ? `${currencyLabel()} ${received}` : "—"}</span>
                  </div>
                  {mode === "todo" && (
                    <div className="flex flex-wrap gap-1.5">
                      {quick.map((n) => (
                        <button key={n} type="button" onClick={() => setReceived(String(n).replace(".", ","))} className="chip min-h-[40px]">{n === total ? "Exacto" : money(n)}</button>
                      ))}
                    </div>
                  )}
                  <NumberPad value={received} onChange={setReceived} />
                  {change > 0 && <p className="rounded-xl bg-warn-100 px-3 py-2 text-center text-lg font-bold text-warn-900">Vuelto: {money(change)}</p>}
                  {shortCash && <p className="text-center text-sm font-semibold text-danger-700">Faltan {money(total - receivedNum)}</p>}
                </div>
              )}
              {method !== "efectivo" && mode === "parte" && (
                <label className="block text-sm font-semibold text-slate-700">
                  ¿Cuánto paga ahora? ({currencyLabel()})
                  <input type="number" min={0} step="any" inputMode="decimal" className="input mt-1 tabular-nums" value={part} onChange={(e) => setPart(e.target.value)} />
                </label>
              )}
            </>
          )}

          {/* Cliente */}
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Cliente {status === "pagado" ? "(opcional)" : "· queda debiendo " + money(owes)}</p>
            <CustomerPicker value={customer} onChange={setCustomer} required={status !== "pagado"} />
            {customer && customerDebt > 0 && <p className="mt-1 text-xs text-warn-800">Ya debe {money(customerDebt)}{customer.credit_limit !== null ? ` · límite ${money(Number(customer.credit_limit))}` : ""}.</p>}
          </div>

          {(overLimit || stockWarn.length > 0) && (
            <div className="space-y-1 rounded-2xl bg-warn-50 p-3 text-sm text-warn-900">
              {overLimit && <p className="flex gap-2"><IconAlert size={18} className="shrink-0" /> {customer!.name} pasaría su límite de fiado ({money(Number(customer!.credit_limit))}).</p>}
              {stockWarn.length > 0 && <p className="flex gap-2"><IconAlert size={18} className="shrink-0" /> {stockWarn.length} producto{stockWarn.length === 1 ? "" : "s"} se vende{stockWarn.length === 1 ? "" : "n"} por encima del stock que dice la app; quedará en 0 y se anota lo que faltaba.</p>}
            </div>
          )}
        </div>
      </Sheet>
    </div>
  );
}
