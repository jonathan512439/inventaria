import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { usageToday } from "@/lib/aiUsage";

export const runtime = "edge";

/** GET /api/usage → consumo de IA de hoy por modelo (el cupo gratuito lo comparte toda la app). */
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const data = await usageToday(createAdminClient());
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
