"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Customer, Database, PayMethod, Sale, SaleItem } from "@/types/database";
import { fmtMoney } from "./inventory";
import { newOpId, registerPaymentOp } from "./data/ops";

/** Lo que debe un cliente = suma de (total − cobrado) de sus ventas fiadas o a medias. */
export function debtOf(sales: Sale[]): number {
  return Math.round(sales.filter((s) => s.status !== "pagado").reduce((a, s) => a + (Number(s.total) - Number(s.paid)), 0) * 100) / 100;
}

/** Días de la deuda más antigua sin saldar (null si no debe). */
export function oldestDebtDays(sales: Sale[]): number | null {
  const open = sales.filter((s) => s.status !== "pagado");
  if (!open.length) return null;
  const oldest = open.reduce((m, s) => (s.created_at < m ? s.created_at : m), open[0].created_at);
  return Math.floor((Date.now() - new Date(oldest).getTime()) / 86400000);
}

/**
 * Registra un abono en UNA operación del servidor (`register_payment`, 022): se reparte entre las ventas pendientes
 * más antiguas; si paga de más, lo que sobra queda como SALDO A FAVOR y se usa en su próxima venta fiada.
 * `id` hace el abono idempotente (reintentar con el mismo id no lo duplica).
 */
export async function registerPayment(
  supabase: SupabaseClient<Database>,
  customerId: string,
  amount: number,
  method: PayMethod,
  note?: string | null,
  id?: string
): Promise<{ applied: number; left: number; balance: number }> {
  const out = await registerPaymentOp(supabase, { id: id ?? newOpId(), customerId, amount, method, note: note ?? null });
  return { applied: Number(out.applied), left: Number(out.left), balance: Number(out.balance) };
}

/** Mensaje de WhatsApp con el saldo y el detalle de lo que se llevó. */
export function reminderText(customer: Customer, sales: Sale[], items: SaleItem[], business: string | null): string {
  const open = sales.filter((s) => s.status !== "pagado").sort((a, b) => a.created_at.localeCompare(b.created_at));
  const lines = [`Hola ${customer.name.split(" ")[0]}, te escribo de *${business || "la tienda"}*.`, `Tienes un saldo pendiente de *Bs ${fmtMoney(debtOf(sales))}*:`, ""];
  open.forEach((s) => {
    const its = items.filter((i) => i.sale_id === s.id);
    lines.push(`• ${new Date(s.created_at).toLocaleDateString("es", { day: "2-digit", month: "short" })} · Bs ${fmtMoney(Number(s.total) - Number(s.paid))}${its.length ? ` (${its.map((i) => `${i.qty} ${i.product_name ?? "producto"}${i.variant_label ? ` ${i.variant_label}` : ""}`).join(", ")})` : ""}`);
  });
  lines.push("", "¿Pasas esta semana? ¡Gracias!");
  return lines.join("\n");
}

export const waLink = (phone: string | null, text: string) => (phone ? `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`);
