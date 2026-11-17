"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, PayMethod, Product, ProductVariant, Sale, SaleItem, SaleStatus } from "@/types/database";
import { fmtMoney, priceOf } from "./inventory";
import { newOpId, registerSaleOp } from "./data/ops";

/** Una línea del carrito. */
export interface CartLine {
  key: string; // product.id o variant.id
  product: Product;
  variant: ProductVariant | null;
  qty: number;
  unitPrice: number;
}

export interface SaleOptions {
  method: PayMethod;
  status: SaleStatus;
  /** Lo cobrado ahora (= total si está pagado) */
  paid: number;
  discount: number;
  customerId?: string | null;
  customerName?: string | null;
  note?: string | null;
}

export const METHOD_LABEL: Record<PayMethod, string> = { efectivo: "Efectivo", qr: "QR", transferencia: "Transferencia", mixto: "Mixto" };
export const STATUS_LABEL: Record<SaleStatus, string> = { pagado: "Pagado", parcial: "Pago parcial", fiado: "Fiado" };

export const lineTotal = (l: CartLine) => Math.round(l.qty * l.unitPrice * 100) / 100;
export const cartSubtotal = (lines: CartLine[]) => Math.round(lines.reduce((s, l) => s + lineTotal(l), 0) * 100) / 100;

/** Precio sugerido para una línea: el de la variante si tiene, si no el del producto. */
export function suggestedPrice(p: Product, v: ProductVariant | null): number {
  return v?.precio ?? priceOf(p) ?? 0;
}

/**
 * Registra la venta en UNA operación del servidor (`register_sale`, migración 021): ticket, líneas, stock con
 * bloqueo, movimientos y costo vigente leído en la base (ganancia real también cuando vende un vendedor).
 * `opts.id` hace la venta idempotente: reintentar con el mismo id no la duplica (generar uno por intento de cobro).
 * Si se vende más de lo registrado, el stock queda en 0 y el movimiento anota el faltante.
 */
export async function registerSale(supabase: SupabaseClient<Database>, lines: CartLine[], opts: SaleOptions & { id?: string; at?: string | null }): Promise<{ sale: Sale; items: SaleItem[] }> {
  const valid = lines.filter((l) => l.qty > 0);
  if (!valid.length) throw new Error("La venta no tiene productos");
  const out = await registerSaleOp(supabase, {
    id: opts.id ?? newOpId(),
    lines: valid.map((l) => ({ product_id: l.product.id, variant_id: l.variant?.id ?? null, qty: l.qty, unit_price: l.unitPrice })),
    method: opts.method,
    status: opts.status,
    paid: opts.paid,
    discount: opts.discount,
    customerId: opts.customerId ?? null,
    customerName: opts.customerName ?? null,
    note: opts.note ?? null,
    at: opts.at ?? null,
  });
  return { sale: out.sale, items: out.items };
}

/** Texto del ticket para WhatsApp / copiar. */
export function ticketText(sale: Sale, items: SaleItem[], business: string | null): string {
  const lines = [
    `*${business || "Mi negocio"}*`,
    `Venta N.º ${sale.number ?? "—"} · ${new Date(sale.created_at).toLocaleString("es", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}`,
    "",
    ...items.map((i) => `${i.qty} × ${i.product_name ?? "Producto"}${i.variant_label ? ` (${i.variant_label})` : ""} · Bs ${fmtMoney(Number(i.line_total))}`),
    "",
  ];
  if (Number(sale.discount) > 0) lines.push(`Subtotal: Bs ${fmtMoney(Number(sale.subtotal))}`, `Descuento: −Bs ${fmtMoney(Number(sale.discount))}`);
  lines.push(`*Total: Bs ${fmtMoney(Number(sale.total))}*`, `Pago: ${METHOD_LABEL[sale.method]}${sale.status !== "pagado" ? ` · ${STATUS_LABEL[sale.status]} (cobrado Bs ${fmtMoney(Number(sale.paid))}, debe Bs ${fmtMoney(Number(sale.total) - Number(sale.paid))})` : ""}`);
  if (sale.customer_name) lines.push(`Cliente: ${sale.customer_name}`);
  lines.push("", "¡Gracias por su compra!");
  return lines.join("\n");
}
