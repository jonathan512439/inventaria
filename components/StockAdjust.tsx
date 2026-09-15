"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import type { MovementType, Product, ProductVariant } from "@/types/database";
import { normalizeFieldName, productTitle } from "@/lib/fields";
import { fmtMoney, priceOf, stockOf } from "@/lib/inventory";
import { useToast } from "./ui/Toast";
import { isNetworkError, queueMove } from "@/lib/offline";
import { IconCheck, IconPlus, IconX, Spinner } from "./ui/Icons";

interface Props {
  product: Product;
  /** Variantes del producto (si tiene): se pide elegir una antes de mover stock */
  variants?: ProductVariant[];
  /** Variante ya elegida (p. ej. al tocar una casilla de la cuadrícula) */
  variant?: ProductVariant | null;
  onClose: () => void;
  /** Se llama con el producto actualizado (stock total) y la variante tocada, si la hubo */
  onSaved: (updated: Product, variant?: ProductVariant) => void;
}

const MOTIVOS_SALIDA = ["Retiro personal", "Merma o rotura", "Regalo o muestra", "Devolución al proveedor", "Corrección de conteo"];

/**
 * Atajo para sumar o restar stock sin editar el producto.
 * Al restar se pregunta si es una VENTA (suma a ingresos y al resumen) o SOLO un retiro (no suma nada).
 */
export default function StockAdjust({ product, variants = [], variant = null, onClose, onSaved }: Props) {
  const supabase = createClient();
  const toast = useToast();
  const [sel, setSel] = useState<ProductVariant | null>(variant);
  const pack = Math.max(1, parseInt(String(product.data.unidades_por_paquete ?? "1"), 10) || 1);
  const needsVariant = variants.length > 0 && !sel;
  const current = sel ? sel.stock : stockOf(product) ?? 0;
  const price = sel?.precio ?? priceOf(product);
  const [mode, setMode] = useState<"add" | "remove">("remove");
  const [qty, setQty] = useState(1);
  const [asSale, setAsSale] = useState<boolean | null>(null); // null = aún no decidió
  const [salePrice, setSalePrice] = useState<string>(price !== null ? String(price) : "");
  const [motivo, setMotivo] = useState(MOTIVOS_SALIDA[0]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setAsSale(null);
  }, [mode]);

  const newStock = mode === "add" ? current + qty : Math.max(0, current - qty);
  const total = asSale ? qty * (Number(salePrice) || 0) : 0;
  const canSave = !needsVariant && qty > 0 && (mode === "add" || asSale !== null) && (!asSale || Number(salePrice) >= 0);

  useEffect(() => {
    if (sel) setSalePrice(sel.precio !== null ? String(sel.precio) : price !== null ? String(price) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  /** Sin conexión: se guarda en el celular y se envía al reconectar (el delta se aplica sobre el stock real de ese momento). */
  async function saveOffline(key: string) {
    const tipo: MovementType = mode === "add" ? "entrada" : asSale ? "venta" : "salida";
    const delta = mode === "add" ? qty : -Math.min(qty, current);
    await queueMove({
      product_id: product.id,
      product_name: productTitle(product.data) || null,
      variant_id: sel?.id ?? null,
      variant_label: sel?.label ?? null,
      delta,
      tipo,
      precio_unitario: asSale ? Number(salePrice) || 0 : null,
      total: asSale ? total : null,
      motivo: mode === "remove" && !asSale ? motivo : null,
    });
    setSaving(false);
    toast("info", "Sin conexión: el cambio quedó guardado en el celular y se enviará al reconectar");
    const totalStock = sel ? variants.reduce((t, v) => t + (v.id === sel.id ? newStock : v.stock), 0) : newStock;
    onSaved({ ...product, data: { ...product.data, [key]: totalStock } }, sel ? { ...sel, stock: newStock } : undefined);
    onClose();
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    const keys = Object.keys(product.data);
    const key = ["stock", "cantidad", "existencias"].map((k) => keys.find((x) => normalizeFieldName(x) === k)).find(Boolean) ?? "stock";
    if (typeof navigator !== "undefined" && !navigator.onLine) return saveOffline(key);
    let data = { ...product.data, [key]: newStock };
    let updatedVariant: ProductVariant | undefined;
    if (sel) {
      // Stock por variante: el total del producto lo recalcula la base de datos (suma de variantes)
      const { error: ev } = await supabase.from("product_variants").update({ stock: newStock }).eq("id", sel.id);
      if (ev) {
        if (isNetworkError(ev)) return saveOffline(key);
        setSaving(false);
        return toast("error", ev.message);
      }
      updatedVariant = { ...sel, stock: newStock };
      const total = variants.reduce((t, v) => t + (v.id === sel.id ? newStock : v.stock), 0);
      data = { ...product.data, [key]: total };
    } else {
      const { error: e1 } = await supabase.from("products").update({ data }).eq("id", product.id);
      if (e1) {
        if (isNetworkError(e1)) return saveOffline(key);
        setSaving(false);
        return toast("error", e1.message);
      }
    }
    const tipo: MovementType = mode === "add" ? "entrada" : asSale ? "venta" : "salida";
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: e2 } = await supabase.from("stock_movements").insert({
      user_id: user!.id,
      product_id: product.id,
      product_name: productTitle(product.data) || null,
      variant_id: sel?.id ?? null,
      variant_label: sel?.label ?? null,
      tipo,
      cantidad: qty,
      precio_unitario: asSale ? Number(salePrice) || 0 : null,
      total: asSale ? total : null,
      motivo: mode === "remove" && !asSale ? motivo : null,
      stock_resultante: newStock,
    });
    setSaving(false);
    if (e2) return toast("error", e2.message);
    navigator.vibrate?.(20);
    toast(
      "success",
      mode === "add"
        ? `+${qty} al stock (${current} → ${newStock})`
        : asSale
          ? `Venta registrada: ${qty} × Bs ${fmtMoney(Number(salePrice) || 0)} = Bs ${fmtMoney(total)} · stock ${current} → ${newStock}`
          : `−${qty} del stock (${current} → ${newStock}) · no cuenta como venta`
    );
    onSaved({ ...product, data }, updatedVariant);
    onClose();
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center md:items-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" />
      <div className="animate-in relative w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl md:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start gap-3">
          {product.image_url && <img src={product.image_url} alt="" className="h-12 w-12 rounded-xl object-cover" />}
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold text-ink">{productTitle(product.data) || "Producto"}</p>
            {sel && <p className="truncate text-xs font-semibold text-violet-700">Variante: {sel.label}</p>}
            <p className="text-xs text-slate-500">Stock actual{sel ? " de esta variante" : ""}: <b className="text-ink">{current}</b>{price !== null ? ` · precio Bs ${fmtMoney(price)}` : ""}</p>
          </div>
          <button onClick={onClose} className="btn-ghost btn-sm -mr-2"><IconX size={18} /></button>
        </div>

        {/* Paso 0 (solo con variantes): ¿cuál? */}
        {variants.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">¿Cuál variante?</p>
            <div className="mt-1 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
              {variants.map((v) => (
                <button key={v.id} type="button" onClick={() => setSel(v)} className={`rounded-full border-2 px-3 py-1 text-sm font-semibold ${sel?.id === v.id ? "border-violet-600 bg-violet-600 text-white" : v.stock <= 0 ? "border-rose-200 bg-rose-50 text-rose-700" : "border-slate-300 bg-white text-slate-700"}`}>
                  {v.label} <span className="opacity-70">{v.stock}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Paso 1: sumar o restar */}
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">1 · ¿Qué quieres hacer?</p>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <button onClick={() => setMode("add")} className={`rounded-2xl border-2 p-3 text-left ${mode === "add" ? "border-emerald-500 bg-emerald-50" : "border-slate-200"}`}>
            <span className="block text-lg font-bold text-emerald-700">+ Sumar</span>
            <span className="block text-xs text-slate-600">llegó mercadería</span>
          </button>
          <button onClick={() => setMode("remove")} className={`rounded-2xl border-2 p-3 text-left ${mode === "remove" ? "border-rose-500 bg-rose-50" : "border-slate-200"}`}>
            <span className="block text-lg font-bold text-rose-700">− Restar</span>
            <span className="block text-xs text-slate-600">venta o retiro</span>
          </button>
        </div>

        {/* Paso 2: cantidad */}
        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">2 · ¿Cuántas unidades?</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {[1, 5, 10].map((n) => (
            <button key={n} onClick={() => setQty(n)} className={`chip ${qty === n ? "chip-active" : ""}`}>{n}</button>
          ))}
          {pack > 1 && [1, 2].map((k) => (
            <button key={`p${k}`} onClick={() => setQty(k * pack)} className={`chip ${qty === k * pack ? "chip-active" : ""}`} title={`${k} paquete${k === 1 ? "" : "s"} de ${pack}`}>
              {k} paq. <span className="opacity-70">= {k * pack}</span>
            </button>
          ))}
          <input type="number" min={1} inputMode="numeric" className="input w-24 py-2 text-center text-lg font-bold tabular-nums" value={qty} onChange={(e) => setQty(Math.max(1, parseInt(e.target.value, 10) || 1))} />
        </div>
        {pack > 1 && <p className="mt-1 text-[11px] text-slate-500">Este producto viene en paquetes de {pack} unidades; el stock se lleva por unidad.</p>}
        {mode === "remove" && qty > current && <p className="mt-1 text-xs text-amber-700">Solo hay {current}. El stock quedará en 0.</p>}

        {/* Paso 3 (solo al restar): ¿es una venta? */}
        {mode === "remove" && (
          <>
            <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">3 · ¿Es una venta?</p>
            <div className="mt-1 grid gap-2">
              <button onClick={() => setAsSale(true)} className={`flex items-start gap-3 rounded-2xl border-2 p-3 text-left ${asSale === true ? "border-emerald-500 bg-emerald-50" : "border-slate-200"}`}>
                <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${asSale === true ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300"}`}>{asSale === true && <IconCheck size={12} />}</span>
                <span>
                  <span className="block font-semibold text-ink">Sí, registrar como venta</span>
                  <span className="block text-xs text-slate-600">Se suma a <b>Ingresos</b> y aparece en el resumen de ventas.</span>
                </span>
              </button>
              <button onClick={() => setAsSale(false)} className={`flex items-start gap-3 rounded-2xl border-2 p-3 text-left ${asSale === false ? "border-slate-500 bg-slate-100" : "border-slate-200"}`}>
                <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${asSale === false ? "border-slate-600 bg-slate-600 text-white" : "border-slate-300"}`}>{asSale === false && <IconCheck size={12} />}</span>
                <span>
                  <span className="block font-semibold text-ink">No, solo restar</span>
                  <span className="block text-xs text-slate-600">Retiro, merma, regalo o corrección. <b>No suma nada</b> a las ventas.</span>
                </span>
              </button>
            </div>

            {asSale === true && (
              <div className="mt-3 rounded-2xl bg-emerald-50 p-3">
                <label className="label" htmlFor="sale-price">Precio de venta por unidad (Bs)</label>
                <input id="sale-price" type="number" inputMode="decimal" step="any" className="input-lg tabular-nums" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} />
                <p className="mt-2 text-sm text-emerald-900">Total de la venta: <b>Bs {fmtMoney(total)}</b></p>
              </div>
            )}
            {asSale === false && (
              <div className="mt-3">
                <label className="label" htmlFor="motivo">Motivo</label>
                <select id="motivo" className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
                  {MOTIVOS_SALIDA.map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>
            )}
          </>
        )}

        {/* Confirmación con el resultado explícito */}
        <button onClick={save} disabled={!canSave || saving} className={`btn-lg mt-5 w-full ${mode === "add" ? "btn-success" : asSale ? "btn-success" : "btn-primary"}`}>
          {saving ? <Spinner /> : mode === "add" ? <IconPlus size={20} /> : <IconCheck size={20} />}
          {needsVariant
            ? "Elige primero la variante"
            : mode === "add"
            ? `Sumar ${qty} · stock queda en ${newStock}`
            : asSale === null
              ? "Elige si es venta o solo retiro"
              : asSale
                ? `Registrar venta de Bs ${fmtMoney(total)} · stock queda en ${newStock}`
                : `Restar ${qty} sin venta · stock queda en ${newStock}`}
        </button>
      </div>
    </div>,
    document.body
  );
}
