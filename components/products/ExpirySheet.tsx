"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Product, ProductVariant } from "@/types/database";
import { currencyLabel, daysToExpiry, money, priceOf, stockOf } from "@/lib/inventory";
import { productTitle } from "@/lib/fields";
import { adjustStock, newOpId, setPrices } from "@/lib/data/ops";
import { friendlyError } from "@/lib/errors";
import { useFlow } from "@/components/FlowProvider";
import Sheet from "@/components/ui/Sheet";
import { QtyStepper } from "@/components/ui/NumberPad";
import { useToast } from "@/components/ui/Toast";
import { IconCalendar, IconCheck, IconTag, IconTrash, IconTruck, Spinner } from "@/components/ui/Icons";

type Action = "oferta" | "vencido" | "devolver" | "fecha";

/**
 * Qué hacer con un producto por vencer (R5): ponerlo en oferta (precio nuevo, queda en el historial),
 * retirarlo del stock como vencido, devolverlo al proveedor (salidas con su motivo, 021) o cambiar la fecha
 * (llegó otro lote). La oferta la decide el dueño; lo demás, cualquiera del equipo.
 */
export default function ExpirySheet({ product, variants, onClose, onDone }: { product: Product | null; variants?: ProductVariant[]; onClose: () => void; onDone: () => void }) {
  const supabase = createClient();
  const toast = useToast();
  const { isOwner } = useFlow();
  const [action, setAction] = useState<Action | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);

  const withStock = (variants ?? []).filter((v) => v.stock > 0);
  const variant = withStock.find((v) => v.id === variantId) ?? null;
  const available = variant ? variant.stock : product ? stockOf(product) ?? 0 : 0;
  const current = product ? priceOf(product) : null;

  useEffect(() => {
    setAction(null);
    setVariantId(null);
    setPrice("");
    setDate(product?.expires_at ?? "");
  }, [product]);
  useEffect(() => setQty(Math.max(1, available)), [available]);

  if (!product) return null;
  const days = daysToExpiry(product.expires_at);
  const needsVariant = (action === "vencido" || action === "devolver") && withStock.length > 0 && !variant;

  async function run() {
    if (!product || !action) return;
    setBusy(true);
    try {
      if (action === "oferta") {
        const value = Number(price.replace(",", "."));
        if (!Number.isFinite(value) || value < 0) throw new Error("Escribe el precio de oferta");
        await setPrices(supabase, [{ product_id: product.id, field: "precio", value }], "oferta");
        toast("success", `En oferta a ${money(value)}`);
      } else if (action === "fecha") {
        const { error } = await supabase.from("products").update({ expires_at: date || null }).eq("id", product.id);
        if (error) throw error;
        toast("success", date ? "Fecha de vencimiento cambiada" : "Se quitó la fecha de vencimiento");
      } else {
        if (needsVariant) throw new Error("Elige cuál talla o color sacas");
        await adjustStock(supabase, { id: newOpId(), productId: product.id, variantId: variant?.id ?? null, delta: -qty, tipo: "salida", motivo: action === "vencido" ? "Vencido" : "Devolución al proveedor" });
        toast("success", `${qty} unidad${qty === 1 ? "" : "es"} fuera del stock (${action === "vencido" ? "vencido" : "devuelto al proveedor"})`);
      }
      onDone();
      onClose();
    } catch (e) {
      toast("error", friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const options: { key: Action; title: string; body: string; Icon: (p: { size?: number }) => JSX.Element; owner?: boolean }[] = [
    { key: "oferta", title: "Ponerlo en oferta", body: "Bajar el precio para venderlo antes", Icon: IconTag, owner: true },
    { key: "vencido", title: "Retirar del stock", body: "Ya venció o no se puede vender", Icon: IconTrash },
    { key: "devolver", title: "Devolver al proveedor", body: "Si te lo cambian o te lo reciben", Icon: IconTruck },
    { key: "fecha", title: "Cambiar la fecha", body: "Llegó otro lote o la fecha estaba mal", Icon: IconCalendar },
  ];

  return (
    <Sheet
      open
      onClose={onClose}
      title={productTitle(product.data) || "Producto"}
      footer={
        action ? (
          <button type="button" onClick={run} disabled={busy || needsVariant || (action === "oferta" && !price.trim())} className="btn-primary btn-lg w-full">
            {busy ? <Spinner /> : <IconCheck size={20} />}{" "}
            {action === "oferta" ? "Guardar precio de oferta" : action === "fecha" ? "Guardar fecha" : `Sacar ${qty} del stock`}
          </button>
        ) : undefined
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-muted">
          {days === null ? "Sin fecha" : days < 0 ? <b className="text-danger-700">Venció hace {-days} día{days === -1 ? "" : "s"}</b> : days === 0 ? <b className="text-danger-700">Vence hoy</b> : <>Vence en <b className="text-warn-800">{days} día{days === 1 ? "" : "s"}</b></>}
          {" · "}{stockOf(product) ?? 0} en stock{current !== null ? ` · ${money(current)}` : ""}
        </p>

        {!action ? (
          <ul className="grid gap-2">
            {options.filter((o) => !o.owner || isOwner).map(({ key, title, body, Icon }) => (
              <li key={key}>
                <button type="button" onClick={() => setAction(key)} className="flex min-h-[64px] w-full items-center gap-3 rounded-2xl border-2 border-slate-200 px-3 text-left hover:border-brand-300 hover:bg-brand-50">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-warn-100 text-warn-800"><Icon size={20} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-semibold text-ink">{title}</span>
                    <span className="block text-xs text-muted">{body}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="space-y-3">
            <button type="button" onClick={() => setAction(null)} className="btn-ghost btn-sm min-h-[44px]">‹ Otra acción</button>

            {action === "oferta" && (
              <div className="space-y-2">
                <label className="block">
                  <span className="label">Precio de oferta ({currencyLabel()})</span>
                  <input type="number" min={0} step="any" inputMode="decimal" className="input min-h-[48px] text-center text-xl font-bold tabular-nums" value={price} onChange={(e) => setPrice(e.target.value)} autoFocus />
                </label>
                {current !== null && (
                  <div className="flex flex-wrap gap-1.5">
                    {[10, 20, 30, 50].map((pct) => (
                      <button key={pct} type="button" onClick={() => setPrice(String(Math.round(current * (1 - pct / 100) * 100) / 100))} className="chip min-h-[40px]">−{pct} % · {money(Math.round(current * (1 - pct / 100) * 100) / 100)}</button>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted">Cambia el precio de venta. Queda en el historial de precios con el motivo «oferta».</p>
              </div>
            )}

            {(action === "vencido" || action === "devolver") && (
              <div className="space-y-2">
                {withStock.length > 0 && (
                  <div>
                    <p className="label">¿Cuál?</p>
                    <div className="grid grid-cols-2 gap-2">
                      {withStock.map((v) => (
                        <button key={v.id} type="button" onClick={() => setVariantId(v.id)} className={`min-h-[48px] rounded-2xl border-2 px-3 text-left text-sm font-semibold ${variantId === v.id ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-200"}`}>
                          {v.label} <span className="block text-xs font-normal text-muted">{v.stock} en stock</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {!needsVariant && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-ink">Unidades que salen</span>
                    <QtyStepper value={qty} onChange={(n) => setQty(Math.min(Math.max(1, available), n))} />
                  </div>
                )}
                <p className="text-xs text-muted">Se anota como salida con el motivo «{action === "vencido" ? "Vencido" : "Devolución al proveedor"}» (no es una venta).</p>
              </div>
            )}

            {action === "fecha" && (
              <label className="block">
                <span className="label">Nueva fecha de vencimiento</span>
                <input type="date" className="input min-h-[48px]" value={date} onChange={(e) => setDate(e.target.value)} />
                <span className="mt-1 block text-xs text-muted">Déjala vacía si ya no vence (deja de avisarte).</span>
              </label>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
