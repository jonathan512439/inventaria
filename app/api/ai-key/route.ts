import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptKey, validateGeminiKey } from "@/lib/aiKey";

export const runtime = "edge";

/** GET /api/ai-key → { configured, last4 } (nunca devuelve la clave). */
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { data } = await createAdminClient().from("ai_keys").select("last4,created_at").eq("user_id", user.id).maybeSingle();
  return NextResponse.json({ configured: !!data, last4: data?.last4 ?? null, since: data?.created_at ?? null });
}

/** POST /api/ai-key { key } → valida contra Google, cifra y guarda. */
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  let key = "";
  try {
    key = String(((await request.json()) as { key?: string }).key ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  if (!/^[A-Za-z0-9_-]{20,120}$/.test(key)) return NextResponse.json({ error: "Eso no parece una clave de Gemini (empieza por «AIza…»)." }, { status: 400 });
  const check = await validateGeminiKey(key);
  if (!check.ok) return NextResponse.json({ error: check.message }, { status: 400 });
  const { ciphertext, iv } = await encryptKey(key);
  const { error } = await createAdminClient().from("ai_keys").upsert({ user_id: user.id, key_ciphertext: ciphertext, iv, last4: key.slice(-4) });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, last4: key.slice(-4) });
}

/** DELETE /api/ai-key → vuelve a la clave del servicio. */
export async function DELETE() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { error } = await createAdminClient().from("ai_keys").delete().eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
