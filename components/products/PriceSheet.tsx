"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Product } from "@/types/database";
import { currencyLabel, money, priceOf } from "@/lib/inventory";
import { productTitle } from "@/lib/fields";
import { setPrices } from "@/lib/data/ops";
import { friendlyError } from "@/lib/errors";
import Sheet from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { IconCheck, Spinner } from "@/components/ui/Icons";

type Field = "precio" | "precio_mayorista";
type Mode = "pct" | "amount" | "margin";
type Round = "none" | "0.5" | "1";

/**
 * Cambiar precio de los productos elegidos (antes /prices): +%, monto fijo o margen sobre el costo,
 * con redondeo y vista previa. Un solo cambio atómico (021); el historial lo escribe la base. Solo el dueño.
 */
export default function PriceSheet({ open, onClose, products, onApplied }: { open: boolean; onClose: () => void; products: Product[]; onApplied: (rows: { id: string; field: Field; value: number }[]) => void }) {
  const supabase = createClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [field, setField] = useState<Field>("precio");
  const [mode, setMode] = useState<Mode>("pct");
  const [value, setValue] = useState("10");
  const [round, setRound] = useState<Round>("0.5");
  const [saving, setSaving] = useState(false);

  const n = Number(value.replace(",", ".")) || 0;
  const preview = useMemo(() => {
    const roundTo = (x: number) => (round === "none" ? Math.round(x * 100) / 100 : round === "0.5" ? Math.round(x * 2) / 2 : Math.round(x));
    return products
      .map((p) => {
        const base = field === "precio" ? priceOf(p) : Number(p.data.precio_mayorista ?? "") || null;
        const cost = Number(p.data.precio_compra ?? "") || null;
        let next: number | null = null;
        if (mode === "pct" && base !== null) next = base * (1 + n / 100);
        if (mode === "amount" && base !== null) next = base + n;
        if (mode === "margin" && cost !== null) next = cost * (1 + n / 100);
        if (next !== null) next = Math.max(0, roundTo(next));
        return { p, base, next };
      })
      .filter((r): r is { p: Product; base: number | null; next: number } => r.next !== null && r.next !== r.base);
  }, [products, field, mode, n, round]);

  async function apply() {
    if (!preview.length) return;
    const sube = preview.filter((r) => r.next > (r.base ?? 0)).length;
    const ok = await confirm({
      title: "¿Cambiamos los precios?",
      body: "Todo queda en el historial de cada producto por si quieres revisarlo.",
      details: [
        { label: "Productos", value: String(preview.length) },
        { label: sube >= preview.length - sube ? "Suben de precio" : "Bajan de precio", value: String(Math.max(sube, preview.length - sube)), tone: "warn" },
        { label: "Qué precio", value: field === "precio" ? "De venta" : "Mayorista" },
      ],
      confirmLabel: `Sí, cambiar ${preview.length}`,
      cancelLabel: "Revisar otra vez",
      tone: "primary",
    });
    if (!ok) return;
    setSaving(true);
    try {
      const done = await setPrices(supabase, preview.map((r) => ({ product_id: r.p.id, field, value: r.next })), "masivo");
      toast("success", `${done} precio${done === 1 ? "" : "s"} actualizado${done === 1 ? "" : "s"}`);
      onApplied(preview.map((r) => ({ id: r.p.id, field, value: r.next })));
      onClose();
    } catch (e) {
      toast("error", friendlyError(e));
    } finally {
      setSaving(false);
    }
  }

  const cur = currencyLabel();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      wide
      title={`Cambiar precio · ${products.length} producto${products.length === 1 ? "" : "s"}`}
      footer={
        <button onClick={apply} disabled={saving || !preview.length} className="btn-primary btn-lg w-full">
          {saving ? <Spinner /> : <IconCheck size={20} />} Aplicar a {preview.length} producto{preview.length === 1 ? "" : "s"}
        </button>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold uppercase text-muted">
            Qué precio
            <select className="input mt-1 normal-case" value={field} onChange={(e) => setField(e.target.value as Field)}>
              <option value="precio">Precio de venta</option>
              <option value="precio_mayorista">Precio mayorista</option>
            </select>
          </label>
          <label className="text-xs font-semibold uppercase text-muted">
            Cómo cambiar
            <select className="input mt-1 normal-case" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
              <option value="pct">Porcentaje (+10 % / −5 %)</option>
              <option value="amount">{`Monto fijo (+2 ${cur} / −1 ${cur})`}</option>
              <option value="margin">Margen sobre el costo (costo + 30 %)</option>
            </select>
          </label>
          <label className="text-xs font-semibold uppercase text-muted">
            {mode === "amount" ? `Monto (${cur})` : "Porcentaje (%)"}
            <input type="number" step="any" inputMode="decimal" className="input mt-1 text-lg font-bold tabular-nums" value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
          <div className="text-xs font-semibold uppercase text-muted">
            Redondear
            <div className="mt-1 flex flex-wrap gap-2">
              {([["0.5", "a 0,50"], ["1", `a 1 ${cur}`], ["none", "sin redondear"]] as [Round, string][]).map(([k, t]) => (
                <button key={k} type="button" onClick={() => setRound(k)} className={`chip min-h-[40px] normal-case ${round === k ? "chip-active" : ""}`}>{t}</button>
              ))}
            </div>
          </div>
        </div>
        <div>
          <p className="mb-1 text-sm font-bold text-ink">Vista previa · {preview.length} de {products.length} cambian</p>
          {preview.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted">{mode === "margin" ? "Ninguno de los elegidos tiene precio de compra." : "Nada que cambiar con esos valores."}</p>
          ) : (
            <ul className="max-h-[40vh] divide-y divide-slate-100 overflow-y-auto rounded-2xl ring-1 ring-slate-900/10">
              {preview.map(({ p, base, next }) => (
                <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{productTitle(p.data) || "Sin nombre"}</span>
                  <span className="tabular-nums text-slate-400 line-through">{base === null ? "—" : money(base)}</span>
                  <span className="font-bold tabular-nums text-ok-700">{money(next)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Sheet>
  );
}
