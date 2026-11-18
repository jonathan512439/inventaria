"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Fotos privadas (026 · Fase 6.9 C5.3). `products.image_url` guarda la dirección de siempre
 * (…/storage/v1/object/public/product-images/<carpeta>/<archivo>), pero el bucket ya no es público:
 * para mostrarla se pide un enlace FIRMADO que dura 1 hora y solo se entrega a miembros del negocio activo.
 * Las fotos que se piden juntas (una lista) se firman en una sola petición y se guardan en memoria.
 * Las direcciones que no son de nuestro bucket (vista previa local, catálogo público) se usan tal cual.
 */

const BUCKET = "product-images";
const MARK = `/object/public/${BUCKET}/`;
const TTL_S = 3600;

/** Ruta dentro del bucket a partir de la dirección guardada; null si no es una foto nuestra. */
export function storagePath(url: string | null | undefined): string | null {
  if (!url) return null;
  const i = url.indexOf(MARK);
  if (i < 0) return null;
  return decodeURIComponent(url.slice(i + MARK.length).split("?")[0]);
}

const cache = new Map<string, { url: string; exp: number }>();
let pending = new Map<string, ((u: string | null) => void)[]>();
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush() {
  const batch = pending;
  pending = new Map();
  timer = null;
  const paths = Array.from(batch.keys());
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    const { data } = await createClient().storage.from(BUCKET).createSignedUrls(chunk, TTL_S);
    const byPath = new Map((data ?? []).map((d) => [d.path ?? "", d.signedUrl ?? null]));
    for (const p of chunk) {
      const url = byPath.get(p) ?? null;
      if (url) cache.set(p, { url, exp: Date.now() + (TTL_S - 120) * 1000 });
      (batch.get(p) ?? []).forEach((resolve) => resolve(url));
    }
  }
}

/** Enlace firmado (o la dirección tal cual si no es del bucket). */
export function signedPhotoUrl(url: string | null | undefined): Promise<string | null> {
  const path = storagePath(url);
  if (!path) return Promise.resolve(url ?? null);
  const hit = cache.get(path);
  if (hit && hit.exp > Date.now()) return Promise.resolve(hit.url);
  return new Promise((resolve) => {
    const list = pending.get(path) ?? [];
    list.push(resolve);
    pending.set(path, list);
    if (!timer) timer = setTimeout(flush, 20); // junta las fotos de una lista en una sola petición
  });
}

/** Versión síncrona si ya está en memoria (para no parpadear al volver a una pantalla). */
function cachedNow(url: string | null | undefined): string | null {
  const path = storagePath(url);
  if (!path) return url ?? null;
  const hit = cache.get(path);
  return hit && hit.exp > Date.now() ? hit.url : null;
}

/** Hook: dirección lista para <img>. Mientras se firma devuelve null. */
export function useStoredImage(url: string | null | undefined): string | null {
  const [src, setSrc] = useState<string | null>(() => cachedNow(url));
  useEffect(() => {
    let alive = true;
    const now = cachedNow(url);
    if (now) setSrc(now);
    else signedPhotoUrl(url).then((u) => alive && setSrc(u));
    return () => {
      alive = false;
    };
  }, [url]);
  return src;
}
