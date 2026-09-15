"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

let client: ReturnType<typeof createBrowserClient<Database>> | undefined;

/** Quién está atendiendo en este dispositivo (tras el PIN). Viaja en una cabecera y la base firma las filas con él. */
export const ACTOR_KEY = "inventaria.actor";
export function getActor(): string | null {
  try {
    return sessionStorage.getItem(ACTOR_KEY);
  } catch {
    return null;
  }
}
export function setActor(userId: string | null) {
  try {
    if (userId) sessionStorage.setItem(ACTOR_KEY, userId);
    else sessionStorage.removeItem(ACTOR_KEY);
  } catch {
    /* sin almacenamiento */
  }
}

/** Cliente de Supabase para componentes cliente (usa la sesión del usuario, respeta RLS). */
export function createClient() {
  if (client) return client;
  client = createBrowserClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: {
      // fetch propio para añadir la cabecera del actor en cada petición (sin recrear el cliente)
      fetch: (input, init) => {
        const actor = getActor();
        if (!actor) return fetch(input, init);
        const headers = new Headers(init?.headers ?? {});
        headers.set("x-actor", actor);
        return fetch(input, { ...init, headers });
      },
    },
  });
  return client;
}
