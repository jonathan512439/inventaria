"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, MovementType } from "@/types/database";

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
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export async function queueMove(m: Omit<PendingMove, "id" | "at">): Promise<PendingMove> {
  const row: PendingMove = { ...m, id: crypto.randomUUID(), at: Date.now() };
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

let syncing = false;
/**
 * Envía los movimientos guardados sin conexión: aplica el delta sobre el stock ACTUAL del servidor
 * (así no se pisan cambios hechos desde otro celular) y registra el movimiento.
 */
export async function syncMoves(supabase: SupabaseClient<Database>): Promise<{ sent: number; failed: number }> {
  if (syncing) return { sent: 0, failed: 0 };
  syncing = true;
  let sent = 0,
    failed = 0;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { sent, failed };
    for (const m of await listMoves()) {
      try {
        let resultante = 0;
        if (m.variant_id) {
          const { data: v, error } = await supabase.from("product_variants").select("stock").eq("id", m.variant_id).maybeSingle();
          if (error) throw error;
          if (!v) {
            await removeMove(m.id); // la variante ya no existe
            continue;
          }
          resultante = Math.max(0, v.stock + m.delta);
          const { error: e2 } = await supabase.from("product_variants").update({ stock: resultante }).eq("id", m.variant_id);
          if (e2) throw e2;
        } else {
          const { data: p, error } = await supabase.from("products").select("data").eq("id", m.product_id).maybeSingle();
          if (error) throw error;
          if (!p) {
            await removeMove(m.id);
            continue;
          }
          const keys = Object.keys(p.data);
          const key = ["stock", "cantidad", "existencias"].map((k) => keys.find((x) => x.toLowerCase() === k)).find(Boolean) ?? "stock";
          resultante = Math.max(0, (Number(p.data[key] ?? 0) || 0) + m.delta);
          const { error: e2 } = await supabase.from("products").update({ data: { ...p.data, [key]: resultante } }).eq("id", m.product_id);
          if (e2) throw e2;
        }
        const { error: e3 } = await supabase.from("stock_movements").insert({
          user_id: user.id,
          product_id: m.product_id,
          product_name: m.product_name,
          variant_id: m.variant_id,
          variant_label: m.variant_label,
          tipo: m.tipo,
          cantidad: Math.abs(m.delta),
          precio_unitario: m.precio_unitario,
          total: m.total,
          motivo: m.motivo,
          stock_resultante: resultante,
          created_at: new Date(m.at).toISOString(),
        });
        if (e3) throw e3;
        await removeMove(m.id);
        sent++;
      } catch (e) {
        failed++;
        if (isNetworkError(e)) break; // seguimos sin red: se reintenta después
      }
    }
  } finally {
    syncing = false;
  }
  return { sent, failed };
}

/** Estado de conexión + número de movimientos pendientes de enviar. */
export function useOffline(): { online: boolean; pending: number } {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  useEffect(() => {
    const upd = () => setOnline(navigator.onLine);
    upd();
    const count = () => listMoves().then((l) => setPending(l.length));
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
  return { online, pending };
}
