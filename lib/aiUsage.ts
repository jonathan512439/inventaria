import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { drainUsage, modelChain } from "@/lib/gemini";

/** Nombres amigables por modelo (sin exponer nombres de API) y orden de uso. */
export const MODEL_LABELS: Record<string, { name: string; hint: string }> = {
  "gemini-3.6-flash": { name: "Modelo Estándar", hint: "Principal · equilibrio entre precisión y velocidad" },
  "gemini-3.7-flash": { name: "Modelo Pro", hint: "Respaldo 1 · mayor capacidad de lectura" },
  "gemini-3.5-flash": { name: "Modelo Clásico", hint: "Respaldo 2 · versión anterior, muy estable" },
  "gemini-3.5-flash-lite": { name: "Modelo Ligero", hint: "Respaldo 3 · más rápido, menos detalle" },
  "gemini-flash-lite-latest": { name: "Modelo Ligero Plus", hint: "Respaldo 4 · ligero, última versión" },
  "gemini-flash-latest": { name: "Modelo Universal", hint: "Respaldo 5 · última versión general" },
};

export const DEFAULT_DAILY_LIMIT = 20; // free tier: peticiones/día por modelo

export function labelFor(model: string) {
  return MODEL_LABELS[model] ?? { name: `Modelo ${model.replace(/^gemini-/, "").replace(/-/g, " ")}`, hint: "Respaldo" };
}

/** Guarda en la BD los intentos de IA acumulados (llamar al final de cada ruta que use Gemini). */
export async function logUsage(admin: SupabaseClient<Database>, userId: string | null, purpose: string, ownKey = false) {
  const attempts = drainUsage();
  if (!attempts.length) return;
  await admin.from("ai_usage").insert(
    attempts.map((a) => ({ user_id: userId, model: a.model, purpose, status: a.status, quota_limit: a.quota_limit ?? null, own_key: ownKey }))
  );
}

/** Inicio del día actual en hora del Pacífico (cuando Google reinicia los cupos). */
export function pacificDayStart(): Date {
  const now = new Date();
  const pt = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const offsetMs = now.getTime() - pt.getTime();
  const start = new Date(pt);
  start.setHours(0, 0, 0, 0);
  return new Date(start.getTime() + offsetMs);
}

export interface ModelUsage {
  model: string;
  name: string;
  hint: string;
  order: number;
  used: number; // análisis exitosos hoy
  limit: number; // cupo diario
  remaining: number;
  exhausted: boolean; // Google respondió "cupo agotado" hoy
  lastUsedAt: string | null;
}

/** Agrega el consumo de hoy por modelo (global de la app: el cupo lo comparte toda la app). */
export async function usageToday(admin: SupabaseClient<Database>, own?: { userId: string }): Promise<{ models: ModelUsage[]; resetAt: string; totalToday: number }> {
  const since = pacificDayStart();
  // Con clave propia el cupo es del usuario (solo sus filas own_key); con la del servicio, el cupo lo comparte toda la app
  let q = admin.from("ai_usage").select("model,status,quota_limit,created_at").gte("created_at", since.toISOString());
  q = own ? q.eq("own_key", true).eq("user_id", own.userId) : q.eq("own_key", false);
  const { data } = await q;
  const rows = data ?? [];
  const chain = modelChain();
  const models: ModelUsage[] = chain.map((model, i) => {
    const mine = rows.filter((r) => r.model === model);
    const used = mine.filter((r) => r.status === "ok").length;
    const quotaRow = mine.find((r) => r.status === "quota");
    const limit = mine.find((r) => r.quota_limit)?.quota_limit ?? DEFAULT_DAILY_LIMIT;
    const lastUsed = mine.map((r) => r.created_at).sort().pop() ?? null;
    const { name, hint } = labelFor(model);
    return { model, name, hint, order: i + 1, used, limit, remaining: Math.max(0, limit - used), exhausted: !!quotaRow || used >= limit, lastUsedAt: lastUsed };
  });
  const reset = new Date(since.getTime() + 24 * 3600 * 1000);
  return { models, resetAt: reset.toISOString(), totalToday: rows.filter((r) => r.status === "ok").length };
}
