import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { GeminiError, QuotaError, detectProducts } from "@/lib/gemini";
import { logUsage } from "@/lib/aiUsage";
import { resolveAiKey } from "@/lib/aiKey";

export const runtime = "edge";

const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

/**
 * POST /api/detect (form: image) → { items: [{ nombre_visible, box_2d }], model }
 * Foto de estante: una sola petición de IA para encontrar varios productos. No crea nada:
 * el cliente recorta los que el usuario marque y los encola como fotos individuales.
 */
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Formulario inválido" }, { status: 400 });
  }
  const file = form.get("image") as Blob | string | null;
  if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") return NextResponse.json({ error: "Falta la imagen" }, { status: 400 });
  if (!ALLOWED.includes(file.type)) return NextResponse.json({ error: "Formato no soportado (usa JPG, PNG o WebP)" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "La imagen supera 4 MB" }, { status: 413 });

  const admin = createAdminClient();
  const key = await resolveAiKey(admin, user.id);
  try {
    const out = await detectProducts(bytesToBase64(new Uint8Array(await file.arrayBuffer())), file.type, key);
    await logUsage(admin, user.id, "detect", key.own);
    return NextResponse.json(out);
  } catch (e) {
    await logUsage(admin, user.id, "detect", key.own);
    if (e instanceof QuotaError) return NextResponse.json({ error: e.message, retry_after: e.retryAfterSec, daily: true }, { status: 429 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo analizar la foto" }, { status: e instanceof GeminiError ? e.status : 500 });
  }
}
