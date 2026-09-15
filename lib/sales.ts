"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, PayMethod, Product, ProductVariant, Sale, SaleItem, SaleStatus } from "@/types/database";
import { costOf, fmtMoney, priceOf } from "./inventory";
import { productTitle } from "./fields";

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
 * Registra la venta: ticket + líneas, descuenta el stock (producto o variante) y deja un movimiento por línea.
 * El costo de lo vendido se toma del precio de compra vigente → ganancia real.
 */
export async function registerSale(supabase: SupabaseClient<Database>, lines: CartLine[], opts: SaleOptions): Promise<{ sale: Sale; items: SaleItem[] }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("No autenticado");
  const valid = lines.filter((l) => l.qty > 0);
  if (!valid.length) throw new Error("La venta no tiene productos");
  const subtotal = cartSubtotal(valid);
  const discount = Math.min(subtotal, Math.max(0, Math.round(opts.discount * 100) / 100));
  const total = Math.round((subtotal - discount) * 100) / 100;
  const costTotal = Math.round(valid.reduce((s, l) => s + l.qty * (l.variant?.costo ?? costOf(l.product) ?? 0), 0) * 100) / 100;
  const paid = opts.status === "pagado" ? total : Math.min(total, Math.max(0, opts.paid));

  const { data: sale, error } = await supabase
    .from("sales")
    .insert({
      user_id: user.id,
      status: opts.status,
      method: opts.method,
      subtotal,
      discount,
      total,
      paid,
      cost_total: costTotal,
      items: valid.length,
      customer_name: opts.customerName?.trim() || null,
      note: opts.note?.trim() || null,
    })
    .select()
    .single();
  if (error || !sale) throw new Error(error?.message ?? "No se pudo guardar la venta");

  const itemRows = valid.map((l) => ({
    sale_id: sale.id,
    user_id: user.id,
    product_id: l.product.id,
    variant_id: l.variant?.id ?? null,
    product_name: productTitle(l.product.data) || null,
    variant_label: l.variant?.label ?? null,
    qty: l.qty,
    unit_price: l.unitPrice,
    unit_cost: l.variant?.costo ?? costOf(l.product),
    line_total: lineTotal(l),
  }));
  const { data: items, error: ie } = await supabase.from("sale_items").insert(itemRows).select();
  if (ie) throw new Error(ie.message);

  // Stock y movimientos (sobre el stock actual del servidor, no el de la pantalla)
  for (const l of valid) {
    let resultante = 0;
    if (l.variant) {
      const { data: v } = await supabase.from("product_variants").select("stock").eq("id", l.variant.id).maybeSingle();
      resultante = Math.max(0, (v?.stock ?? 0) - l.qty);
      await supabase.from("product_variants").update({ stock: resultante }).eq("id", l.variant.id);
    } else {
      const { data: p } = await supabase.from("products").select("data").eq("id", l.product.id).maybeSingle();
      if (p) {
        const keys = Object.keys(p.data);
        const key = ["stock", "cantidad", "existencias"].map((k) => keys.find((x) => x.toLowerCase() === k)).find(Boolean) ?? "stock";
        resultante = Math.max(0, (Number(p.data[key] ?? 0) || 0) - l.qty);
        await supabase.from("products").update({ data: { ...p.data, [key]: resultante } }).eq("id", l.product.id);
      }
    }
    await supabase.from("stock_movements").insert({
      user_id: user.id,
      product_id: l.product.id,
      product_name: productTitle(l.product.data) || null,
      variant_id: l.variant?.id ?? null,
      variant_label: l.variant?.label ?? null,
      tipo: "venta",
      cantidad: l.qty,
      precio_unitario: l.unitPrice,
      total: lineTotal(l),
      stock_resultante: resultante,
      sale_id: sale.id,
    });
  }
  return { sale: sale as Sale, items: (items ?? []) as SaleItem[] };
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
