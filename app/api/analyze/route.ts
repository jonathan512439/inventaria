import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { analyzeImage, buildPrompt, buildResponseSchema, GeminiError, UNKNOWN_OPTION } from "@/lib/gemini";
import { getEffectiveFields, coerceValue } from "@/lib/fields";
import { categoryPath } from "@/lib/categories";
import type { ProductData } from "@/types/database";

export const runtime = "edge";

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB (el cliente ya redimensiona a ~800px)
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * POST /api/analyze  (multipart/form-data: image, category_id)
 * 1. Verifica el usuario (cookies de sesión)
 * 2. Sube la imagen a Supabase Storage ({user_id}/{uuid}.jpg)
 * 3. Arma prompt + schema con los campos is_ai_fillable de la categoría
 * 4. Llama a Gemini (structured output)
 * 5. Crea el producto en estado draft
 */
export async function POST(request: Request) {
  // 1. Usuario autenticado
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  // Entrada
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Formulario inválido" }, { status: 400 });
  }
  const file = form.get("image") as Blob | string | null;
  const categoryId = String(form.get("category_id") ?? "");
  // No usamos `instanceof File`: en edge/dev el archivo puede ser otra implementación de Blob
  if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
    return NextResponse.json({ error: "Falta la imagen" }, { status: 400 });
  }
  if (!categoryId) return NextResponse.json({ error: "Falta la categoría" }, { status: 400 });
  if (!ALLOWED.includes(file.type)) return NextResponse.json({ error: "Formato no soportado (usa JPG, PNG o WebP)" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "La imagen supera 2 MB" }, { status: 413 });

  // Campos y categorías del usuario (respeta RLS con el cliente del usuario)
  const [{ data: categories, error: catErr }, { data: templates, error: tplErr }] = await Promise.all([
    supabase.from("categories").select("*"),
    supabase.from("field_templates").select("*").order("sort_order"),
  ]);
  if (catErr || tplErr) return NextResponse.json({ error: catErr?.message ?? tplErr?.message }, { status: 500 });
  if (!categories?.some((c) => c.id === categoryId)) return NextResponse.json({ error: "Categoría no encontrada" }, { status: 404 });

  const effective = getEffectiveFields(templates ?? [], categories, categoryId);
  const aiFields = effective.filter((f) => f.is_ai_fillable);

  // 2. Subir imagen (service role; ruta con user_id para trazabilidad)
  const admin = createAdminClient();
  const productId = crypto.randomUUID();
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${user.id}/${productId}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error: upErr } = await admin.storage.from("product-images").upload(path, bytes, {
    contentType: file.type,
    upsert: false,
  });
  if (upErr) return NextResponse.json({ error: `Error subiendo imagen: ${upErr.message}` }, { status: 500 });
  const {
    data: { publicUrl },
  } = admin.storage.from("product-images").getPublicUrl(path);

  // 3+4. IA (solo si hay campos marcados para IA)
  const data: ProductData = {};
  effective.forEach((f) => (data[f.name] = f.field_type === "number" ? null : ""));
  let aiWarning: string | null = null;

  if (aiFields.length > 0) {
    const schema = buildResponseSchema(aiFields);
    const prompt = buildPrompt(aiFields, {
      categoryPath: categoryPath(categories, categoryId),
      categoryOptions: categories.map((c) => c.name),
    });
    try {
      const result = await analyzeImage({ imageBase64: bytesToBase64(bytes), mimeType: file.type, prompt, schema });
      aiFields.forEach((f) => {
        const v = result[f.name];
        data[f.name] = coerceValue(f, v === UNKNOWN_OPTION ? "" : v);
      });
    } catch (e) {
      // Si la IA falla (p. ej. 429), igual creamos el borrador vacío para no perder la foto.
      if (e instanceof GeminiError && e.status === 429) {
        aiWarning = e.message;
      } else {
        // Limpieza: borramos la imagen subida y devolvemos el error.
        await admin.storage.from("product-images").remove([path]);
        const status = e instanceof GeminiError ? e.status : 500;
        return NextResponse.json({ error: e instanceof Error ? e.message : "Error analizando la imagen" }, { status });
      }
    }
  }

  // 5. Crear borrador
  const { data: product, error: insErr } = await admin
    .from("products")
    .insert({ id: productId, user_id: user.id, category_id: categoryId, status: "draft", data, image_url: publicUrl })
    .select()
    .single();
  if (insErr) {
    await admin.storage.from("product-images").remove([path]);
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ product, ai_fields: aiFields.map((f) => f.name), warning: aiWarning }, { status: 201 });
}
