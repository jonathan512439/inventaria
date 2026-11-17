"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, MovementType } from "@/types/database";
import { adjustStock, registerSaleOp } from "./data/ops";
import { friendlyError } from "./errors";

/**
 * Modo sin conexión: caché de lectura (inventario) y cola de movimientos de stock.
 * IndexedDB, misma técnica que la cola de fotos (lib/queue). El service worker no cachea datos de red.
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

// ---------- cola de movimientos ----------
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
        if (m.tipo === "venta") {
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
