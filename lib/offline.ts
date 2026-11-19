"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Category, Database, MovementType, PayMethod, PaymentInput, Product, ProductVariant, SaleStatus } from "@/types/database";
import { adjustStock, registerSaleOp } from "./data/ops";
import { friendlyError } from "./errors";
import { fromSummary, SUMMARY_COLS } from "./inventory";

/**
 * Modo sin conexión: caché de lectura (inventario, contexto del negocio) y cola de cambios (ventas completas
 * y movimientos de stock). IndexedDB, misma técnica que la cola de fotos (lib/queue).
 * El service worker (public/sw.js) solo guarda las pantallas y los archivos de la app, nunca datos.
 */

const DB = "inventaria-offline";
const VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("cache")) db.createObjectStore("cache");
      if (!db.objectStoreNames.contains("moves")) db.createObjectStore("moves", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const r = fn(t.objectStore(store));
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      })
  );
}

// ---------- caché de lectura ----------

const BIZ_KEY = "inventaria.business";
/** Recuerda el negocio activo (lo fija FlowProvider) para separar la caché por negocio aunque no haya red. */
export function rememberBusiness(id: string | null | undefined) {
  try {
    if (id) localStorage.setItem(BIZ_KEY, id);
  } catch {
    /* sin almacenamiento */
  }
}
/** Clave de caché del negocio activo: «inventory» → «inventory:<negocio>». */
export function bizKey(key: string): string {
  let b = "?";
  try {
    b = localStorage.getItem(BIZ_KEY) ?? "?";
  } catch {
    /* sin almacenamiento */
  }
  return `${key}:${b}`;
}
export interface Cached<T> {
  at: number;
  data: T;
}
export async function cacheSet<T>(key: string, data: T): Promise<void> {
  try {
    await tx("cache", "readwrite", (s) => s.put({ at: Date.now(), data } as Cached<T>, key));
  } catch {
    /* sin IndexedDB (modo privado): no hay caché */
  }
}
export async function cacheGet<T>(key: string): Promise<Cached<T> | null> {
  try {
    return ((await tx<Cached<T> | undefined>("cache", "readonly", (s) => s.get(key))) as Cached<T> | undefined) ?? null;
  } catch {
    return null;
  }
}

// ---------- inventario guardado en el celular (buscar y escanear sin conexión) ----------

export interface InventoryCache {
  categories: Category[];
  products: Product[];
  variants?: ProductVariant[];
}
const INVENTORY = "inventory";
export const cachedInventory = () => cacheGet<InventoryCache>(bizKey(INVENTORY));
export const saveInventory = (data: InventoryCache) => cacheSet(bizKey(INVENTORY), data);

/**
 * Vuelve a guardar el inventario (vista ligera, ≈200 B por producto) si la copia tiene más de `maxAgeMs`.
 * Vender lo llama al abrir, para poder seguir vendiendo si se corta la señal.
 */
export async function refreshInventoryCache(supabase: SupabaseClient<Database>, maxAgeMs = 30 * 60_000): Promise<void> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  const cached = await cachedInventory();
  if (cached && Date.now() - cached.at < maxAgeMs) return;
  const [c, p, v] = await Promise.all([
    supabase.from("categories").select("*"),
    supabase.from("product_summaries").select(SUMMARY_COLS).order("updated_at", { ascending: false }),
    supabase.from("product_variants").select("*").order("created_at"),
  ]);
  if (c.error || p.error || v.error) return;
  await saveInventory({ categories: c.data ?? [], products: (p.data ?? []).map(fromSummary), variants: (v.data ?? []) as ProductVariant[] });
}

const norm = (x: unknown) => String(x ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Busca en la copia del celular (nombre, marca o código, también el de una variante). */
export async function localFind(term: string, limit = 12): Promise<Product[]> {
  const inv = (await cachedInventory())?.data;
  if (!inv) return [];
  const t = norm(term);
  const byVariantCode = new Set((inv.variants ?? []).filter((v) => norm(v.codigo_barras).includes(t)).map((v) => v.product_id));
  return inv.products
    .filter((p) => p.status === "confirmed" && (byVariantCode.has(p.id) || [p.data.nombre, p.data.marca, p.data.codigo_barras].some((x) => norm(x).includes(t))))
    .sort((a, b) => String(a.data.nombre ?? "").localeCompare(String(b.data.nombre ?? ""), "es"))
    .slice(0, limit);
}
export async function localVariants(productId: string): Promise<ProductVariant[]> {
  return ((await cachedInventory())?.data.variants ?? []).filter((v) => v.product_id === productId);
}
/** Código escaneado sin conexión: el producto (y la variante si el código es de una). */
export async function localByCode(code: string): Promise<{ product: Product; variant: ProductVariant | null; variants: ProductVariant[] } | null> {
  const inv = (await cachedInventory())?.data;
  if (!inv) return null;
  const c = code.trim();
  const variant = (inv.variants ?? []).find((v) => v.codigo_barras === c) ?? null;
  const product = inv.products.find((p) => p.status === "confirmed" && (variant ? p.id === variant.product_id : String(p.data.codigo_barras ?? "") === c));
  if (!product) return null;
  return { product, variant, variants: (inv.variants ?? []).filter((v) => v.product_id === product.id) };
}
/** Descuenta en la copia lo vendido sin conexión (para que la siguiente venta vea el stock que queda). */
export async function applyLocalSale(lines: { product_id: string; variant_id: string | null; qty: number }[]): Promise<void> {
  const cached = await cachedInventory();
  if (!cached) return;
  const inv = cached.data;
  const sold = new Map<string, number>();
  lines.forEach((l) => sold.set(l.product_id, (sold.get(l.product_id) ?? 0) + l.qty));
  const variants = (inv.variants ?? []).map((v) => {
    const q = lines.filter((l) => l.variant_id === v.id).reduce((t, l) => t + l.qty, 0);
    return q ? { ...v, stock: Math.max(0, v.stock - q) } : v;
  });
  const products = inv.products.map((p) => (sold.has(p.id) ? { ...p, data: { ...p.data, stock: Math.max(0, (Number(p.data.stock) || 0) - sold.get(p.id)!) } } : p));
  // Se conserva la hora de la copia: sigue contando como vieja y se vuelve a pedir apenas haya señal
  await tx("cache", "readwrite", (st) => st.put({ at: cached.at, data: { ...inv, products, variants } } as Cached<InventoryCache>, bizKey(INVENTORY))).catch(() => undefined);
}

// ---------- cola de cambios (ventas y movimientos) ----------

/** Venta completa hecha sin conexión: se envía tal cual con register_sale (mismo id → no se duplica). */
export interface QueuedSale {
  lines: { product_id: string; variant_id: string | null; qty: number; unit_price: number }[];
  method: PayMethod;
  status: SaleStatus;
  paid: number;
  discount: number;
  payments: PaymentInput[] | null;
  customerId: string | null;
  customerName: string | null;
}

export interface PendingMove {
  id: string;
  at: number;
  product_id: string;
  product_name: string | null;
  variant_id: string | null;
  variant_label: string | null;
  delta: number; // + entrada, − venta/salida
  tipo: MovementType;
  precio_unitario: number | null;
  total: number | null;
  motivo: string | null;
  /** Rechazos del servidor (no de red). Tras MAX_TRIES queda como fallido y deja de reintentarse. */
  tries?: number;
  /** Motivo del rechazo, en palabras simples, cuando ya no se reintenta */
  failed?: string | null;
  /** Venta del carrito (Vender sin conexión). Sin esto, `tipo: "venta"` es la venta rápida de una línea de «+/− Stock». */
  sale?: QueuedSale | null;
}

const MAX_TRIES = 5;

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Guarda un cambio sin conexión. `id` = id de la operación (si ya se intentó en línea, el mismo, para no duplicar). */
export async function queueMove(m: Omit<PendingMove, "id" | "at"> & { id?: string }): Promise<PendingMove> {
  const row: PendingMove = { ...m, id: m.id ?? crypto.randomUUID(), at: Date.now() };
  await tx("moves", "readwrite", (s) => s.put(row));
  notify();
  return row;
}
/** Guarda una venta del carrito sin conexión con el id de la venta en curso (si ya llegó al servidor, no se repite). */
export async function queueSale(id: string, sale: QueuedSale, total: number): Promise<PendingMove> {
  const units = sale.lines.reduce((t, l) => t + l.qty, 0);
  const row = await queueMove({
    id,
    product_id: sale.lines[0].product_id,
    product_name: `Venta de ${units} unidad${units === 1 ? "" : "es"}`,
    variant_id: null,
    variant_label: null,
    delta: -units,
    tipo: "venta",
    precio_unitario: null,
    total,
    motivo: null,
    sale,
  });
  await applyLocalSale(sale.lines);
  return row;
}
export async function listMoves(): Promise<PendingMove[]> {
  try {
    return ((await tx<PendingMove[]>("moves", "readonly", (s) => s.getAll())) ?? []).sort((a, b) => a.at - b.at);
  } catch {
    return [];
  }
}
async function removeMove(id: string) {
  await tx("moves", "readwrite", (s) => s.delete(id));
  notify();
}

/** ¿Es un fallo de red (y no un rechazo del servidor)? */
export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const msg = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e ?? "");
  return /fetch|network|Failed to|load failed|NetworkError|ECONN/i.test(msg);
}

/**
 * Borra todo lo guardado en este celular (S10): caché del inventario, cambios sin conexión, cola de fotos y
 * turno de «¿quién atiende?». Se llama al cerrar sesión: la próxima cuenta no ve nada de la anterior.
 */
export async function clearDeviceData(): Promise<void> {
  const drop = (name: string) =>
    new Promise<void>((resolve) => {
      try {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      } catch {
        resolve();
      }
    });
  try {
    sessionStorage.removeItem("inventaria.actor");
    localStorage.removeItem(BIZ_KEY);
  } catch {
    /* sin almacenamiento */
  }
  await Promise.all([drop(DB), drop("inventaria")]);
}

/** Quita de la cola los cambios que el servidor rechazó definitivamente (la persona ya los vio). */
export async function discardFailedMoves(): Promise<number> {
  const failed = (await listMoves()).filter((m) => m.failed);
  for (const m of failed) await removeMove(m.id);
  return failed.length;
}

let syncing = false;
/**
 * Envía los cambios guardados sin conexión con las MISMAS operaciones atómicas que en línea (021), usando el id
 * del cambio como id de la operación: si el envío se corta y se repite, el servidor no lo duplica.
 * Una venta rápida hecha sin conexión se registra como venta real (ticket, caja) con su hora original.
 */
export async function syncMoves(supabase: SupabaseClient<Database>): Promise<{ sent: number; failed: number }> {
  if (syncing) return { sent: 0, failed: 0 };
  syncing = true;
  let sent = 0,
    failed = 0;
  try {
    for (const m of await listMoves()) {
      if (m.failed) continue;
      try {
        const at = new Date(m.at).toISOString();
        if (m.sale) {
          await registerSaleOp(supabase, {
            id: m.id,
            lines: m.sale.lines,
            method: m.sale.method,
            status: m.sale.status,
            paid: m.sale.paid,
            discount: m.sale.discount,
            payments: m.sale.payments,
            customerId: m.sale.customerId,
            customerName: m.sale.customerName,
            note: "registrada sin conexión",
            at,
          });
        } else if (m.tipo === "venta") {
          await registerSaleOp(supabase, {
            id: m.id,
            lines: [{ product_id: m.product_id, variant_id: m.variant_id, qty: Math.abs(m.delta), unit_price: m.precio_unitario ?? 0 }],
            method: "efectivo",
            status: "pagado",
            paid: 0,
            discount: 0,
            note: "registrada sin conexión",
            at,
          });
        } else {
          await adjustStock(supabase, { id: m.id, productId: m.product_id, variantId: m.variant_id, delta: m.delta, tipo: m.tipo, motivo: m.motivo, precio: m.precio_unitario, at });
        }
        await removeMove(m.id);
        sent++;
      } catch (e) {
        failed++;
        if (isNetworkError(e)) break; // seguimos sin red: se reintenta después
        const tries = (m.tries ?? 0) + 1;
        await tx("moves", "readwrite", (s) => s.put({ ...m, tries, failed: tries >= MAX_TRIES ? friendlyError(e) : null } as PendingMove));
        notify();
      }
    }
  } finally {
    syncing = false;
  }
  return { sent, failed };
}

/** Estado de conexión, cambios pendientes de enviar y cambios que el servidor rechazó. */
export function useOffline(): { online: boolean; pending: number; failed: PendingMove[] } {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState<PendingMove[]>([]);
  useEffect(() => {
    const upd = () => setOnline(navigator.onLine);
    upd();
    const count = () =>
      listMoves().then((l) => {
        setPending(l.filter((m) => !m.failed).length);
        setFailed(l.filter((m) => m.failed));
      });
    count();
    listeners.add(count);
    window.addEventListener("online", upd);
    window.addEventListener("offline", upd);
    return () => {
      listeners.delete(count);
      window.removeEventListener("online", upd);
      window.removeEventListener("offline", upd);
    };
  }, []);
  return { online, pending, failed };
}
