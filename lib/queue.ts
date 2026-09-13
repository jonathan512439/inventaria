"use client";

import { useSyncExternalStore } from "react";
import type { Product } from "@/types/database";
import { createClient } from "@/lib/supabase/client";

/**
 * Cola de fotos para procesar con la IA en segundo plano.
 * - Singleton en memoria (sobrevive a la navegación dentro de la app)
 * - Persistida en IndexedDB (sobrevive a recargas / cierre de pestaña)
 * - Ritmo controlado para no superar el límite del free tier de Gemini
 */

export type ItemStatus = "queued" | "processing" | "done" | "error";

export interface QueueItem {
  id: string;
  blob: Blob;
  previewUrl: string;
  categoryId: string | null;
  status: ItemStatus;
  attempts: number;
  error?: string;
  product?: Product;
  aiFields?: string[];
  createdAt: number;
}

interface State {
  items: QueueItem[];
  paused: boolean;
  pausedUntil: number | null; // timestamp mientras esperamos por límite de IA
}

const CONCURRENCY = 2;
const MIN_GAP_MS = 4500; // ~13 análisis/minuto como máximo
const MAX_ATTEMPTS = 3;
const DB_NAME = "inventaria";
const STORE = "queue";

let state: State = { items: [], paused: false, pausedUntil: null };
const listeners = new Set<() => void>();
let lastStart = 0;
let running = 0;
let hydrated = false;
let timer: ReturnType<typeof setTimeout> | null = null;
const controllers = new Map<string, AbortController>(); // fetch en curso por elemento (para cancelar)
const cancelled = new Set<string>(); // ids de producto cancelados (limpieza si el servidor alcanzó a crearlos)

function emit() {
  listeners.forEach((l) => l());
}
function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  emit();
}
function update(id: string, patch: Partial<QueueItem>) {
  set({ items: state.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
}

// ---------- IndexedDB ----------
function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}
async function dbPut(item: QueueItem) {
  const db = await openDb();
  if (!db) return;
  const { blob, id, categoryId, createdAt, attempts } = item;
  db.transaction(STORE, "readwrite").objectStore(STORE).put({ id, blob, categoryId, createdAt, attempts });
}
async function dbDelete(id: string) {
  const db = await openDb();
  if (!db) return;
  db.transaction(STORE, "readwrite").objectStore(STORE).delete(id);
}
async function dbAll(): Promise<Array<{ id: string; blob: Blob; categoryId: string | null; createdAt: number; attempts: number }>> {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => resolve([]);
  });
}

/** Recupera fotos pendientes guardadas (llamar una vez al montar la app). */
export async function hydrateQueue() {
  if (hydrated) return;
  hydrated = true;
  const saved = await dbAll();
  if (!saved.length) return;
  const items: QueueItem[] = saved
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((s) => ({ ...s, previewUrl: URL.createObjectURL(s.blob), status: "queued" as const }));
  set({ items: [...items, ...state.items] });
  schedule();
}

// ---------- API pública ----------
export function enqueue(blobs: Blob[], categoryId: string | null) {
  const now = Date.now();
  const items: QueueItem[] = blobs.map((blob, i) => ({
    id: crypto.randomUUID(),
    blob,
    previewUrl: URL.createObjectURL(blob),
    categoryId,
    status: "queued",
    attempts: 0,
    createdAt: now + i,
  }));
  items.forEach(dbPut);
  set({ items: [...state.items, ...items] });
  schedule();
}

export function retryItem(id: string) {
  update(id, { status: "queued", error: undefined, attempts: 0 });
  schedule();
}

export function removeItem(id: string) {
  const it = state.items.find((i) => i.id === id);
  if (it) URL.revokeObjectURL(it.previewUrl);
  dbDelete(id);
  set({ items: state.items.filter((i) => i.id !== id) });
}

/** Borra (mejor esfuerzo) un producto y su foto que el servidor pudo crear tras cancelar. */
async function cleanupCancelled(productId: string) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from("products").delete().eq("id", productId);
    if (user) await supabase.storage.from("product-images").remove([`${user.id}/${productId}.jpg`]);
  } catch {
    /* sin conexión: no pasa nada, el producto quedaría como pendiente */
  }
}

/** Cancela una foto: si está en cola se quita; si se está analizando, se aborta y se limpia. */
export function cancelItem(id: string) {
  const it = state.items.find((i) => i.id === id);
  if (!it) return;
  if (it.status === "processing") {
    controllers.get(id)?.abort();
    controllers.delete(id);
    cancelled.add(id);
    // El servidor puede terminar igual: limpiamos ahora y otra vez más tarde.
    cleanupCancelled(id);
    setTimeout(() => cleanupCancelled(id), 25000);
  }
  removeItem(id);
}

/** Cancela todo lo que aún no terminó. */
export function cancelAll() {
  state.items.filter((i) => i.status === "queued" || i.status === "processing").forEach((i) => cancelItem(i.id));
}

/** Quita la miniatura del producto ya revisado/confirmado. */
export function removeByProductId(productId: string) {
  const it = state.items.find((i) => i.product?.id === productId);
  if (it) removeItem(it.id);
}

/** Quita de la lista los que ya terminaron bien. */
export function clearDone() {
  state.items.filter((i) => i.status === "done").forEach((i) => URL.revokeObjectURL(i.previewUrl));
  set({ items: state.items.filter((i) => i.status !== "done") });
}

export function setPaused(paused: boolean) {
  set({ paused, pausedUntil: paused ? state.pausedUntil : null });
  if (!paused) schedule();
}

// ---------- Motor ----------
function schedule() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    tick();
  }, 50);
}

function tick() {
  if (state.paused) return;
  if (state.pausedUntil && Date.now() < state.pausedUntil) {
    timer = setTimeout(() => {
      timer = null;
      tick();
    }, state.pausedUntil - Date.now() + 100);
    return;
  }
  if (state.pausedUntil) set({ pausedUntil: null });

  while (running < CONCURRENCY) {
    const next = state.items.find((i) => i.status === "queued");
    if (!next) return;
    const wait = lastStart + MIN_GAP_MS - Date.now();
    if (wait > 0) {
      timer = setTimeout(() => {
        timer = null;
        tick();
      }, wait);
      return;
    }
    lastStart = Date.now();
    running++;
    process(next).finally(() => {
      running--;
      schedule();
    });
  }
}

async function process(item: QueueItem) {
  update(item.id, { status: "processing", attempts: item.attempts + 1 });
  try {
    const form = new FormData();
    form.append("image", item.blob, "foto.jpg");
    form.append("product_id", item.id); // el servidor usa este id → permite limpiar si se cancela
    if (item.categoryId) form.append("category_id", item.categoryId);
    const controller = new AbortController();
    controllers.set(item.id, controller);
    const res = await fetch("/api/analyze", { method: "POST", body: form, signal: controller.signal });
    controllers.delete(item.id);
    const json = (await res.json().catch(() => ({}))) as { product?: Product; ai_fields?: string[]; error?: string; retry_after?: number };

    if (res.status === 429) {
      // Límite de la IA: pausamos toda la cola y reintentamos este mismo elemento
      const secs = json.retry_after ?? 30;
      set({ pausedUntil: Date.now() + secs * 1000 });
      update(item.id, { status: "queued", attempts: item.attempts });
      return;
    }
    if (!res.ok || !json.product) throw new Error(json.error || `Error ${res.status}`);

    update(item.id, { status: "done", product: json.product, aiFields: json.ai_fields ?? [], error: undefined });
    dbDelete(item.id);
  } catch (e) {
    controllers.delete(item.id);
    if (cancelled.has(item.id) || (e instanceof DOMException && e.name === "AbortError")) return; // cancelado por el usuario
    const msg = e instanceof Error ? e.message : "Error inesperado";
    const attempts = item.attempts + 1;
    if (attempts < MAX_ATTEMPTS && /fetch|network|Failed|red/i.test(msg)) {
      // Sin conexión: reintentar más tarde sin consumir intentos de usuario
      set({ pausedUntil: Date.now() + 8000 });
      update(item.id, { status: "queued" });
    } else {
      update(item.id, { status: "error", error: msg });
    }
  }
}

// ---------- Hook ----------
const getSnapshot = () => state;
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const serverSnapshot: State = { items: [], paused: false, pausedUntil: null };

export function useQueue() {
  return useSyncExternalStore(subscribe, getSnapshot, () => serverSnapshot);
}

export function queueSummary(items: QueueItem[]) {
  return {
    total: items.length,
    queued: items.filter((i) => i.status === "queued").length,
    processing: items.filter((i) => i.status === "processing").length,
    done: items.filter((i) => i.status === "done").length,
    error: items.filter((i) => i.status === "error").length,
  };
}
