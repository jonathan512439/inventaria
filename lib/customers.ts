"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Customer, Database, PayMethod, Sale, SaleItem } from "@/types/database";
import { fmtMoney } from "./inventory";

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
 * Registra un abono y lo aplica a las ventas pendientes más antiguas primero.
 * Devuelve cuánto se aplicó y cuánto sobró (si pagó de más, queda anotado en la nota).
 */
export async function registerPayment(supabase: SupabaseClient<Database>, customerId: string, amount: number, method: PayMethod, note?: string | null): Promise<{ applied: number; left: number }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("No autenticado");
  const { data: open } = await supabase.from("sales").select("*").eq("customer_id", customerId).neq("status", "pagado").order("created_at", { ascending: true });
  let left = Math.round(amount * 100) / 100;
  let applied = 0;
  for (const s of (open ?? []) as Sale[]) {
    if (left <= 0) break;
    const due = Math.round((Number(s.total) - Number(s.paid)) * 100) / 100;
    if (due <= 0) continue;
    const pay = Math.min(due, left);
    const paid = Math.round((Number(s.paid) + pay) * 100) / 100;
    const { error } = await supabase.from("sales").update({ paid, status: paid >= Number(s.total) ? "pagado" : "parcial" }).eq("id", s.id);
    if (error) throw new Error(error.message);
    left = Math.round((left - pay) * 100) / 100;
    applied = Math.round((applied + pay) * 100) / 100;
  }
  const { error } = await supabase.from("payments").insert({ user_id: user.id, customer_id: customerId, amount, method, note: [note?.trim(), left > 0 ? `Sobraron Bs ${fmtMoney(left)} (a favor del cliente)` : ""].filter(Boolean).join(" · ") || null });
  if (error) throw new Error(error.message);
  return { applied, left };
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
