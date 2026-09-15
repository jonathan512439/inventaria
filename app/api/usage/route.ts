import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { usageToday } from "@/lib/aiUsage";

export const runtime = "edge";

/** ¿El usuario configuró su propia clave? (el medidor muestra entonces su cupo, no el del servicio) */
async function hasOwnKey(admin: ReturnType<typeof createAdminClient>, userId: string) {
  const { data } = await admin.from("ai_keys").select("user_id").eq("user_id", userId).maybeSingle();
  return !!data;
}

/**
 * POST /api/usage { model, used } → ajusta el consumo de hoy de un modelo (p. ej. llamadas hechas fuera de la app).
 * Registra filas "ok" con purpose "adjust" hasta alcanzar el valor indicado.
 */
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { model, used } = (await request.json().catch(() => ({}))) as { model?: string; used?: number };
  const admin = createAdminClient();
  const own = await hasOwnKey(admin, user.id);
  const current = await usageToday(admin, own ? { userId: user.id } : undefined);
  const m = current.models.find((x) => x.model === model);
  if (!m || typeof used !== "number" || used < 0 || used > 1000) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const delta = Math.round(used) - m.used;
  if (delta > 0) {
    await admin.from("ai_usage").insert(Array.from({ length: delta }, () => ({ user_id: user.id, model: m.model, purpose: "adjust", status: "ok", own_key: own })));
  } else if (delta < 0) {
    // quitar ajustes previos de hoy (solo los manuales) para no borrar consumo real
    const { data: adj } = await admin.from("ai_usage").select("id").eq("model", m.model).eq("purpose", "adjust").eq("own_key", own).gte("created_at", new Date(new Date(current.resetAt).getTime() - 86400000).toISOString()).limit(-delta);
    if (adj?.length) await admin.from("ai_usage").delete().in("id", adj.map((r) => r.id));
  }
  return NextResponse.json({ ...(await usageToday(admin, own ? { userId: user.id } : undefined)), ownKey: own }, { headers: { "Cache-Control": "no-store" } });
}

/** GET /api/usage → consumo de IA de hoy por modelo (el cupo gratuito lo comparte toda la app). */
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const admin = createAdminClient();
  const own = await hasOwnKey(admin, user.id);
  const data = await usageToday(admin, own ? { userId: user.id } : undefined);
  return NextResponse.json({ ...data, ownKey: own }, { headers: { "Cache-Control": "no-store" } });
}
