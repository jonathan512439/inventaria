/**
 * Capa de datos de las operaciones atómicas (migración 021 · Fase 6.9 C2).
 *
 * Regla: el stock y el dinero NUNCA se escriben desde la pantalla con «leer → calcular → escribir».
 * Toda pantalla llama a estas funciones, que llaman a una función SQL que hace todo o nada en el servidor.
 * Cada operación lleva un `id` (uuid) generado en el celular: si se reintenta con el mismo id
 * (corte de red, doble toque, cola sin conexión), el servidor devuelve lo ya guardado y no duplica.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CountRowInput,
  Database,
  MovementType,
  PayMethod,
  PurchaseLineInput,
  SaleLineInput,
  SaleStatus,
  StockResult,
} from "@/types/database";

type DB = SupabaseClient<Database>;
type Fns = Database["public"]["Functions"];

/** Error de una operación: conserva el código de Postgres para `friendlyError` y para distinguir fallos de red. */
export class OpError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "OpError";
    this.code = code;
  }
}

/** Nuevo id de operación (idempotencia). Generarlo UNA vez por intento del usuario y reutilizarlo al reintentar. */
export const newOpId = (): string => crypto.randomUUID();

async function call<K extends keyof Fns>(db: DB, fn: K, args: Fns[K]["Args"]): Promise<Fns[K]["Returns"]> {
  // supabase-js tipa rpc por nombre; el cast evita que TS pierda la relación nombre → argumentos
  const { data, error } = await (db.rpc as unknown as (f: string, a: unknown) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>)(fn as string, args);
  if (error) throw new OpError(error.message, error.code);
  return data as Fns[K]["Returns"];
}

// ---------- Stock ----------

/** Sumar (entrada) o restar (salida) stock fuera de una venta, o un ajuste con signo. */
export function adjustStock(
  db: DB,
  op: { id: string; productId: string; variantId?: string | null; delta: number; tipo: Exclude<MovementType, "venta">; motivo?: string | null; precio?: number | null; at?: string | null }
): Promise<StockResult> {
  return call(db, "adjust_stock", {
    p_id: op.id,
    p_product: op.productId,
    p_variant: op.variantId ?? null,
    p_delta: Math.trunc(op.delta),
    p_tipo: op.tipo,
    p_motivo: op.motivo ?? null,
    p_precio: op.precio ?? null,
    p_at: op.at ?? null,
  });
}

/** Dejar el stock en un valor exacto (corrección a mano). Registra un ajuste por la diferencia; si no cambia, no hace nada. */
export function setStock(db: DB, op: { id: string; productId: string; variantId?: string | null; value: number; motivo?: string | null }): Promise<StockResult> {
  return call(db, "set_stock", { p_id: op.id, p_product: op.productId, p_variant: op.variantId ?? null, p_value: Math.max(0, Math.trunc(op.value)), p_motivo: op.motivo ?? null });
}

// ---------- Ventas ----------

export function registerSaleOp(
  db: DB,
  op: { id: string; lines: SaleLineInput[]; method: PayMethod; status: SaleStatus; paid: number; discount: number; customerId?: string | null; customerName?: string | null; note?: string | null; at?: string | null }
) {
  return call(db, "register_sale", {
    p_id: op.id,
    p_lines: op.lines,
    p_method: op.method,
    p_status: op.status,
    p_paid: op.paid,
    p_discount: op.discount,
    p_customer: op.customerId ?? null,
    p_customer_name: op.customerName ?? null,
    p_note: op.note ?? null,
    p_at: op.at ?? null,
  });
}

// ---------- Compras ----------

export function registerPurchase(db: DB, op: { id: string; supplierId: string | null; doc: string | null; note?: string | null; lines: PurchaseLineInput[] }) {
  return call(db, "register_purchase", { p_id: op.id, p_supplier: op.supplierId, p_doc: op.doc, p_note: op.note ?? null, p_lines: op.lines });
}

// ---------- Consignación ----------

export function consignOut(db: DB, op: { id: string; customerId: string; lines: SaleLineInput[]; note?: string | null }) {
  return call(db, "consign_out", { p_id: op.id, p_customer: op.customerId, p_lines: op.lines, p_note: op.note ?? null });
}

export function consignSettle(db: DB, op: { id: string; consignmentId: string; rows: { item_id: string; sold: number; returned: number }[]; pay: SaleStatus; method: PayMethod }) {
  return call(db, "consign_settle", { p_id: op.id, p_consignment: op.consignmentId, p_rows: op.rows, p_pay: op.pay, p_method: op.method });
}

// ---------- Conteo ----------

export function applyCount(db: DB, op: { id: string; categoryId: string | null; categoryName: string | null; rows: CountRowInput[]; note?: string | null }) {
  return call(db, "apply_count", { p_id: op.id, p_category: op.categoryId, p_category_name: op.categoryName, p_rows: op.rows, p_note: op.note ?? null });
}

// ---------- Precios ----------

/** Cambia precios en lote (el historial lo escribe la base). Devuelve cuántos productos cambiaron. */
export function setPrices(db: DB, rows: { product_id: string; field: "precio" | "precio_mayorista" | "precio_compra"; value: number | null }[], source = "masivo"): Promise<number> {
  return call(db, "set_prices", { p_rows: rows, p_source: source });
}

/** Claves de `data` que son columnas del sistema de stock: no se envían al guardar un formulario (ver 021). */
export const STOCK_KEYS = ["stock", "cantidad", "existencias"];
/** Quita las claves de stock de un `data` antes de guardarlo: la base conserva el stock real (021). */
export function withoutStock<T extends Record<string, unknown>>(data: T): T {
  const out = { ...data };
  for (const k of Object.keys(out)) if (STOCK_KEYS.includes(k.toLowerCase())) delete out[k];
  return out;
}
