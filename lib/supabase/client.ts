"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

let client: ReturnType<typeof createBrowserClient<Database>> | undefined;

/**
 * Quién está atendiendo en este dispositivo (celular compartido, tras su PIN): un TOKEN firmado por la base
 * (`start_shift`, 024) que dura 12 h. Viaja en la cabecera `x-actor-token`; la base firma las filas con esa persona
 * y le da SUS permisos (un vendedor en el celular del dueño actúa como vendedor). Sin token = el dueño de la sesión.
 */
export const ACTOR_KEY = "inventaria.actor";
type StoredActor = { id: string; token: string; exp: number };
function readActor(): StoredActor | null {
  try {
    const raw = sessionStorage.getItem(ACTOR_KEY);
    if (!raw || !raw.startsWith("{")) return null; // formato antiguo (uuid suelto): ya no vale
    const a = JSON.parse(raw) as StoredActor;
    if (!a.token || a.exp * 1000 <= Date.now()) return null;
    return a;
  } catch {
    return null;
  }
}
/** Id de quien atiende (si hay un turno vigente en este celular). */
export function getActor(): string | null {
  return readActor()?.id ?? null;
}
/** Token del turno vigente (para la cabecera x-actor-token). */
export function getActorToken(): string | null {
  return readActor()?.token ?? null;
}
/** Cabeceras para llamar a nuestras rutas /api con la persona que atiende. */
export function actorHeaders(): Record<string, string> {
  const t = getActorToken();
  return t ? { "x-actor-token": t } : {};
}
/** Fija (o quita, con null) el turno: el token lo da `start_shift` y trae su vencimiento. */
export function setActor(userId: string | null, token?: string | null) {
  try {
    if (userId && token) {
      const exp = Number(token.split(".")[2]) || 0;
      sessionStorage.setItem(ACTOR_KEY, JSON.stringify({ id: userId, token, exp }));
    } else sessionStorage.removeItem(ACTOR_KEY);
  } catch {
    /* sin almacenamiento */
  }
}

/** Cliente de Supabase para componentes cliente (usa la sesión del usuario, respeta RLS). */
export function createClient() {
  if (client) return client;
  client = createBrowserClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: {
      // fetch propio para añadir el token de quien atiende en cada petición (sin recrear el cliente)
      fetch: (input, init) => {
        const token = getActorToken();
        if (!token) return fetch(input, init);
        const headers = new Headers(init?.headers ?? {});
        headers.set("x-actor-token", token);
        return fetch(input, { ...init, headers });
      },
    },
  });
  return client;
}
