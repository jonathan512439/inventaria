"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Consignment, ConsignmentItem, Customer, PayMethod, Product, ProductVariant } from "@/types/database";
import { currencyLabel, money } from "@/lib/inventory";
import { productTitle } from "@/lib/fields";
import { METHOD_LABEL, suggestedPrice } from "@/lib/sales";
import { consignOut, consignSettle, newOpId } from "@/lib/data/ops";
import { friendlyError } from "@/lib/errors";
import ProductFinder from "@/components/ProductFinder";
import Sheet from "@/components/ui/Sheet";
import { EmptyState } from "@/components/ui/Screen";
import { QtyStepper } from "@/components/ui/NumberPad";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { IconCheck, IconPlus, IconTrash, IconTruck, Spinner } from "@/components/ui/Icons";

interface Line {
  key: string;
  product: Product;
  variant: ProductVariant | null;
  qty: number;
  price: string;
}

const pendingOf = (i: ConsignmentItem) => i.qty_out - i.qty_sold - i.qty_returned;

/**
 * Mercadería entregada de UN cliente (C7.6 · antes /consign, F33): lo que tiene para vender, «Entregar» y
 * «Rendir cuentas» sin salir de su ficha. Entregar = `consign_out` (sale del estante, sigue siendo tuya);
 * rendir = `consign_settle` (lo vendido es una venta pagada o fiada; lo devuelto vuelve al estante).
 */
export default function ConsignSection({ customer, consignments, items, onChanged }: { customer: Customer; consignments: Consignment[]; items: ConsignmentItem[]; onChanged: () => void }) {
  const supabase = createClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [delivering, setDelivering] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [deliverId, setDeliverId] = useState(newOpId);
  const [settle, setSettle] = useState<{ cons: Consignment; rows: Record<string, { sold: string; returned: string }>; method: PayMethod; pay: "pagado" | "fiado" } | null>(null);
  const [settleId, setSettleId] = useState(newOpId);
  const [saving, setSaving] = useState(false);

  const open = consignments.filter((c) => c.status === "abierta");
  const closed = consignments.filter((c) => c.status !== "abierta");
  const itemsOf = (c: Consignment) => items.filter((i) => i.consignment_id === c.id);

  function add(p: Product, v: ProductVariant | null) {
    const key = v ? v.id : p.id;
    setLines((ls) => (ls.some((l) => l.key === key) ? ls.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l)) : [...ls, { key, product: p, variant: v, qty: 1, price: String(suggestedPrice(p, v)) }]));
  }

  async function deliver() {
    if (!lines.length) return toast("info", "Agrega lo que entregas");
    const units = lines.reduce((s, l) => s + l.qty, 0);
    const value = lines.reduce((s, l) => s + l.qty * (Number(l.price.replace(",", ".")) || 0), 0);
    const ok = await confirm({
      title: `¿Entregamos a ${customer.name}?`,
      body: "La mercadería sale de tu estante pero sigue siendo tuya hasta que la venda o la devuelva.",
      details: [
        { label: "Productos", value: `${lines.length} · ${units} unid.` },
        { label: "Valor a precio de venta", value: money(value) },
      ],
      confirmLabel: "Sí, entregar",
      tone: "primary",
    });
    if (!ok) return;
    setSaving(true);
    try {
      await consignOut(supabase, {
        id: deliverId,
        customerId: customer.id,
        lines: lines.map((l) => ({ product_id: l.product.id, variant_id: l.variant?.id ?? null, qty: l.qty, unit_price: Number(l.price.replace(",", ".")) || 0 })),
      });
    } catch (e) {
      setSaving(false);
      return toast("error", friendlyError(e));
    }
    setDeliverId(newOpId());
    setSaving(false);
    navigator.vibrate?.(30);
    toast("success", `Entrega registrada: ${units} unidades con ${customer.name}`);
    setLines([]);
    setDelivering(false);
    onChanged();
  }

  async function doSettle() {
    if (!settle) return;
    const parsed = itemsOf(settle.cons).map((i) => {
      const pending = pendingOf(i);
      const sold = Math.max(0, Math.min(pending, parseInt(settle.rows[i.id]?.sold ?? "0", 10) || 0));
      const returned = Math.max(0, Math.min(pending - sold, parseInt(settle.rows[i.id]?.returned ?? "0", 10) || 0));
      return { i, pending, sold, returned };
    });
    const soldUnits = parsed.reduce((s, p) => s + p.sold, 0);
    const retUnits = parsed.reduce((s, p) => s + p.returned, 0);
    if (!soldUnits && !retUnits) return toast("info", "Escribe cuánto vendió o cuánto devuelve");
    const amount = parsed.reduce((s, p) => s + p.sold * Number(p.i.unit_price), 0);
    const remaining = parsed.reduce((s, p) => s + (p.pending - p.sold - p.returned), 0);
    const ok = await confirm({
      title: `¿Rendimos cuentas con ${customer.name}?`,
      body: remaining ? `Quedan ${remaining} unidades todavía afuera; la entrega sigue abierta.` : "Con esto la entrega queda cerrada.",
      details: [
        ...(soldUnits ? [{ label: "Vendió", value: `${soldUnits} unid. · ${money(amount)}`, tone: "ok" as const }] : []),
        ...(soldUnits ? [{ label: settle.pay === "pagado" ? "Te paga ahora" : "Queda debiendo", value: `${money(amount)} · ${settle.pay === "pagado" ? METHOD_LABEL[settle.method] : "fiado"}`, tone: settle.pay === "pagado" ? ("ok" as const) : ("warn" as const) }] : []),
        ...(retUnits ? [{ label: "Devuelve al estante", value: `${retUnits} unid.` }] : []),
      ],
      confirmLabel: "Sí, registrar",
      tone: "success",
    });
    if (!ok) return;
    setSaving(true);
    try {
      await consignSettle(supabase, {
        id: settleId,
        consignmentId: settle.cons.id,
        rows: parsed.filter((p) => p.sold || p.returned).map((p) => ({ item_id: p.i.id, sold: p.sold, returned: p.returned })),
        pay: settle.pay,
        method: settle.method,
      });
      setSettleId(newOpId());
      navigator.vibrate?.(30);
      toast("success", remaining ? "Cuentas registradas; la entrega sigue abierta" : "Entrega cerrada");
      setSettle(null);
      onChanged();
    } catch (e) {
      toast("error", friendlyError(e, "No se pudo registrar"));
    } finally {
      setSaving(false);
    }
  }

  const settleRow = (i: ConsignmentItem, k: "sold" | "returned", v: string) => settle && setSettle({ ...settle, rows: { ...settle.rows, [i.id]: { ...(settle.rows[i.id] ?? { sold: "", returned: "" }), [k]: v } } });

  return (
    <div className="space-y-3">
      <button type="button" onClick={() => setDelivering(true)} className="btn-primary min-h-[44px] w-full"><IconPlus size={18} /> Entregar mercadería</button>

      {open.length === 0 ? (
        <EmptyState icon={<IconTruck size={28} />} title="No tiene mercadería tuya" body="Si le das productos para que los venda, regístralo con «Entregar mercadería». Siguen siendo tuyos hasta que rinda cuentas." />
      ) : (
        open.map((c) => (
          <section key={c.id} className="animate-in card p-3">
            <p className="mb-2 text-sm font-bold text-ink">
              Entregado el {new Date(c.created_at).toLocaleDateString("es", { day: "2-digit", month: "short" })} · {itemsOf(c).reduce((s, i) => s + pendingOf(i), 0)} unid. afuera
            </p>
            <ul className="divide-y divide-slate-100 text-sm">
              {itemsOf(c).map((i) => (
                <li key={i.id} className="flex min-h-[44px] items-center gap-2 py-1.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{i.product_name}{i.variant_label ? <span className="text-violet-800"> · {i.variant_label}</span> : null}</span>
                    <span className="block text-xs text-muted">entregó {i.qty_out} · vendió {i.qty_sold} · devolvió {i.qty_returned}</span>
                  </span>
                  <span className="font-bold tabular-nums">{pendingOf(i)}</span>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setSettle({ cons: c, rows: {}, method: "efectivo", pay: "pagado" })} className="btn-success mt-3 min-h-[44px] w-full"><IconCheck size={18} /> Rendir cuentas</button>
          </section>
        ))
      )}

      {closed.length > 0 && (
        <section className="animate-in card p-3">
          <h3 className="mb-2 text-sm font-bold text-ink">Entregas cerradas</h3>
          <ul className="divide-y divide-slate-100 text-sm">
            {closed.slice(0, 20).map((c) => {
              const its = itemsOf(c);
              return (
                <li key={c.id} className="flex min-h-[44px] items-center gap-3 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-muted">{c.closed_at ? new Date(c.closed_at).toLocaleDateString("es", { day: "2-digit", month: "short" }) : ""}</span>
                  <span className="text-xs text-muted">vendió {its.reduce((s, i) => s + i.qty_sold, 0)} · devolvió {its.reduce((s, i) => s + i.qty_returned, 0)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Entregar */}
      <Sheet
        open={delivering}
        onClose={() => setDelivering(false)}
        title={`Entregar a ${customer.name}`}
        wide
        footer={
          <button type="button" onClick={deliver} disabled={saving || !lines.length} className="btn-primary btn-lg w-full">
            {saving ? <Spinner /> : <IconCheck size={20} />} Entregar {lines.reduce((s, l) => s + l.qty, 0)} u. · {money(lines.reduce((s, l) => s + l.qty * (Number(l.price.replace(",", ".")) || 0), 0))}
          </button>
        }
      >
        <div className="space-y-3">
          <ProductFinder onPick={add} placeholder="Buscar o escanear lo que entregas…" />
          {lines.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted">Busca o escanea los productos. Cada lectura suma 1.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {lines.map((l) => (
                <li key={l.key} className="space-y-2 py-2">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{productTitle(l.product.data)}{l.variant ? <span className="text-violet-800"> · {l.variant.label}</span> : null}</span>
                    <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-danger-50 hover:text-danger-600" aria-label="Quitar"><IconTrash size={18} /></button>
                  </div>
                  <div className="grid grid-cols-[auto_1fr] items-end gap-3">
                    <div>
                      <p className="mb-0.5 text-xs font-semibold text-muted">Unidades</p>
                      <QtyStepper value={l.qty} onChange={(n) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: n } : x)))} />
                    </div>
                    <label className="block text-xs font-semibold text-muted">
                      Precio por unidad ({currencyLabel()})
                      <input type="number" min={0} step="any" inputMode="decimal" className="input mt-0.5 min-h-[44px] text-center tabular-nums" value={l.price} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, price: e.target.value } : x)))} />
                    </label>
                  </div>
                  <p className="text-right text-sm text-muted">
                    {l.qty} u. × {money(Number(l.price.replace(",", ".")) || 0)} = <b className="tabular-nums text-ink">{money(l.qty * (Number(l.price.replace(",", ".")) || 0))}</b>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Sheet>

      {/* Rendir cuentas */}
      <Sheet
        open={!!settle}
        onClose={() => setSettle(null)}
        title={`Rendir cuentas · ${customer.name}`}
        footer={
          <button type="button" onClick={doSettle} disabled={saving} className="btn-success btn-lg w-full">
            {saving ? <Spinner /> : <IconCheck size={20} />} Registrar cuentas
          </button>
        }
      >
        {settle && (
          <div className="space-y-3">
            <ul className="space-y-2">
              {itemsOf(settle.cons).filter((i) => pendingOf(i) > 0).map((i) => {
                const r = settle.rows[i.id] ?? { sold: "", returned: "" };
                return (
                  <li key={i.id} className="rounded-2xl bg-slate-50 p-3">
                    <p className="text-sm font-semibold text-ink">
                      {i.product_name}{i.variant_label ? <span className="text-violet-800"> · {i.variant_label}</span> : null}
                    </p>
                    <p className="text-xs text-muted">Tiene <b className="text-ink">{pendingOf(i)} u.</b> afuera · precio por unidad <b className="text-ink">{money(Number(i.unit_price))}</b></p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <label className="text-xs font-semibold text-muted">Unidades que vendió<input type="number" min={0} max={pendingOf(i)} inputMode="numeric" className="input mt-0.5 min-h-[44px] text-center font-bold tabular-nums" value={r.sold} onChange={(e) => settleRow(i, "sold", e.target.value)} /></label>
                      <label className="text-xs font-semibold text-muted">Unidades que devuelve<input type="number" min={0} max={pendingOf(i)} inputMode="numeric" className="input mt-0.5 min-h-[44px] text-center font-bold tabular-nums" value={r.returned} onChange={(e) => settleRow(i, "returned", e.target.value)} /></label>
                    </div>
                    {(Number(r.sold) || 0) > 0 && (
                      <p className="mt-1 text-right text-sm text-muted">
                        Vendió {Number(r.sold)} u. × {money(Number(i.unit_price))} = <b className="tabular-nums text-ok-700">{money((Number(r.sold) || 0) * Number(i.unit_price))}</b>
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Lo vendido, ¿te lo paga ahora?</p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setSettle({ ...settle, pay: "pagado" })} className={`min-h-[44px] rounded-xl border-2 px-2 text-sm font-semibold ${settle.pay === "pagado" ? "border-ok-600 bg-ok-600 text-white" : "border-slate-200"}`}>Sí, paga</button>
                <button type="button" onClick={() => setSettle({ ...settle, pay: "fiado" })} className={`min-h-[44px] rounded-xl border-2 px-2 text-sm font-semibold ${settle.pay === "fiado" ? "border-warn-500 bg-warn-500 text-white" : "border-slate-200"}`}>Queda debiendo</button>
              </div>
              {settle.pay === "pagado" && (
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {(["efectivo", "qr", "transferencia"] as PayMethod[]).map((m) => (
                    <button key={m} type="button" onClick={() => setSettle({ ...settle, method: m })} className={`min-h-[44px] rounded-xl border-2 px-2 text-sm font-semibold ${settle.method === m ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200"}`}>{METHOD_LABEL[m]}</button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
