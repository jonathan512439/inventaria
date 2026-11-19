"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Customer, PayMethod } from "@/types/database";
import { money } from "@/lib/inventory";
import { METHOD_LABEL } from "@/lib/sales";
import { registerPayment } from "@/lib/customers";
import { newOpId } from "@/lib/data/ops";
import { friendlyError } from "@/lib/errors";
import Sheet from "@/components/ui/Sheet";
import { NumberPad, padNumber } from "@/components/ui/NumberPad";
import { useToast } from "@/components/ui/Toast";
import { IconCheck, Spinner } from "@/components/ui/Icons";

/**
 * «Cobrar abono» (C7.6): monto con teclado grande y atajos (todo, la mitad), medio de pago y cuánto le quedará.
 * Una sola operación `register_payment` (022) con id propio: reintentar no duplica. Si paga de más, queda a su favor.
 */
export default function PaySheet({ open, onClose, customer, debt, onDone }: { open: boolean; onClose: () => void; customer: Customer; debt: number; onDone: () => void }) {
  const supabase = createClient();
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PayMethod>("efectivo");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [payId, setPayId] = useState(newOpId);

  useEffect(() => {
    if (open) {
      setAmount(debt > 0 ? String(debt).replace(".", ",") : "");
      setMethod("efectivo");
      setNote("");
    }
  }, [open, debt]);

  const value = padNumber(amount);
  const left = Math.max(0, Math.round((debt - value) * 100) / 100);
  const extra = Math.max(0, Math.round((value - debt) * 100) / 100);
  const quick = debt > 0 ? [debt, Math.round(debt * 50) / 100].filter((v, i, a) => v > 0 && a.indexOf(v) === i) : [];

  async function pay() {
    if (value <= 0) return toast("info", "Escribe cuánto paga");
    setSaving(true);
    try {
      const r = await registerPayment(supabase, customer.id, value, method, note.trim() || null, payId);
      navigator.vibrate?.(30);
      toast("success", r.left > 0 ? `Abono registrado. ${money(r.left)} quedan a favor de ${customer.name}.` : `Abono de ${money(value)} registrado`);
      setPayId(newOpId());
      onDone();
      onClose();
    } catch (e) {
      toast("error", friendlyError(e, "No se pudo registrar el abono"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Cobrar abono · ${customer.name}`}
      footer={
        <button type="button" onClick={pay} disabled={saving || value <= 0} className="btn-success btn-lg w-full">
          {saving ? <Spinner /> : <IconCheck size={20} />} Cobrar {money(value)}
        </button>
      }
    >
      <div className="space-y-3">
        <div className="rounded-2xl bg-slate-50 p-3 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Paga</p>
          <p className="text-4xl font-bold tabular-nums text-ink">{money(value)}</p>
          <p className={`text-sm ${extra > 0 ? "text-info-700" : left > 0 ? "text-warn-700" : "text-ok-700"}`}>
            {extra > 0 ? `${money(extra)} quedan a su favor` : left > 0 ? `Le quedará debiendo ${money(left)}` : "Queda al día ✓"}
          </p>
        </div>
        {quick.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {quick.map((v, i) => (
              <button key={v} type="button" onClick={() => setAmount(String(v).replace(".", ","))} className="chip min-h-[44px]">
                {i === 0 ? "Todo" : "La mitad"} · {money(v)}
              </button>
            ))}
          </div>
        )}
        <NumberPad value={amount} onChange={setAmount} />
        <div className="grid grid-cols-3 gap-2">
          {(["efectivo", "qr", "transferencia"] as PayMethod[]).map((m) => (
            <button key={m} type="button" onClick={() => setMethod(m)} className={`min-h-[44px] rounded-2xl border-2 px-2 text-sm font-semibold ${method === m ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-700"}`}>
              {METHOD_LABEL[m]}
            </button>
          ))}
        </div>
        <input className="input min-h-[44px]" placeholder="Nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Sheet>
  );
}
