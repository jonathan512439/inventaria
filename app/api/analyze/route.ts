import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  analyzeImage,
  buildPrompt,
  buildResponseSchema,
  GeminiError,
  META_KEYS,
  NEW_CATEGORY_OPTION,
  UNKNOWN_OPTION,
} from "@/lib/gemini";
import { getEffectiveFields, coerceValue, applyDefaults } from "@/lib/fields";
import { categoryPath } from "@/lib/categories";
import type { AiMeta, Category, FieldTemplate, ProductData } from "@/types/database";

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

/** Unión de campos IA de todas las secciones (sin repetir nombre) para una sola llamada a Gemini. */
function unionAiFields(templates: FieldTemplate[], categories: Category[]): FieldTemplate[] {
  const seen = new Map<string, FieldTemplate>();
  const scopes: (string | null)[] = [null, ...categories.map((c) => c.id)];
  scopes.forEach((scope) => {
    getEffectiveFields(templates, categories, scope)
      .filter((f) => f.is_ai_fillable)
      .forEach((f) => {
        const k = f.name.toLowerCase();
        if (!seen.has(k)) seen.set(k, f);
      });
  });
  return Array.from(seen.values());
}

/**
 * POST /api/analyze  (multipart/form-data: image, category_id?)
 * 1. Verifica el usuario · 2. Sube la imagen · 3. Gemini elige sección + rellena campos + lee etiqueta
 * 4. Aplica valores por defecto · 5. Crea el producto como pendiente de revisar
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
  const fixedCategoryId = String(form.get("category_id") ?? "") || null;
  if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
    return NextResponse.json({ error: "Falta la imagen" }, { status: 400 });
  }
  if (!ALLOWED.includes(file.type)) return NextResponse.json({ error: "Formato no soportado (usa JPG, PNG o WebP)" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "La imagen supera 2 MB" }, { status: 413 });

  const [{ data: categories, error: catErr }, { data: templates, error: tplErr }] = await Promise.all([
    supabase.from("categories").select("*"),
    supabase.from("field_templates").select("*").order("sort_order"),
  ]);
  if (catErr || tplErr) return NextResponse.json({ error: catErr?.message ?? tplErr?.message }, { status: 500 });
  const cats = categories ?? [];
  const tpls = templates ?? [];
  if (fixedCategoryId && !cats.some((c) => c.id === fixedCategoryId)) {
    return NextResponse.json({ error: "Sección no encontrada" }, { status: 404 });
  }

  // 2. Subir imagen
  const admin = createAdminClient();
  const productId = crypto.randomUUID();
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${user.id}/${productId}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: upErr } = await admin.storage.from("product-images").upload(path, bytes, { contentType: file.type, upsert: false });
  if (upErr) return NextResponse.json({ error: `Error subiendo imagen: ${upErr.message}` }, { status: 500 });
  const {
    data: { publicUrl },
  } = admin.storage.from("product-images").getPublicUrl(path);

  // 3. IA
  const pathById = new Map(cats.map((c) => [c.id, categoryPath(cats, c.id)]));
  const idByPath = new Map(cats.map((c) => [categoryPath(cats, c.id), c.id]));
  const aiFields = fixedCategoryId
    ? getEffectiveFields(tpls, cats, fixedCategoryId).filter((f) => f.is_ai_fillable)
    : unionAiFields(tpls, cats);
  const ctx = { categoryPaths: Array.from(idByPath.keys()), fixedCategoryPath: fixedCategoryId ? pathById.get(fixedCategoryId) : null };

  let categoryId: string | null = fixedCategoryId;
  const aiMeta: AiMeta = { modelo: process.env.GEMINI_MODEL || null };
  let result: Record<string, unknown> = {};
  let aiWarning: string | null = null;

  try {
    result = await analyzeImage({
      imageBase64: bytesToBase64(bytes),
      mimeType: file.type,
      prompt: buildPrompt(aiFields, ctx),
      schema: buildResponseSchema(aiFields, ctx),
    });
  } catch (e) {
    if (e instanceof GeminiError && e.status === 429) {
      // Límite de la IA: avisamos al cliente para que espere y reintente (no creamos nada).
      await admin.storage.from("product-images").remove([path]);
      return NextResponse.json({ error: e.message, retry_after: 30 }, { status: 429 });
    }
    await admin.storage.from("product-images").remove([path]);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error analizando la imagen" }, { status: e instanceof GeminiError ? e.status : 500 });
  }

  // Sección elegida por la IA
  if (!categoryId) {
    const chosen = String(result[META_KEYS.categoria] ?? "");
    if (chosen && chosen !== NEW_CATEGORY_OPTION && idByPath.has(chosen)) {
      categoryId = idByPath.get(chosen)!;
      aiMeta.categoria_sugerida = chosen;
    }
  }
  const nueva = String(result[META_KEYS.categoriaNueva] ?? "").trim();
  if (!categoryId && nueva) aiMeta.categoria_nueva = nueva.slice(0, 60);
  const etiqueta = String(result[META_KEYS.etiqueta] ?? "").trim();
  if (etiqueta) aiMeta.etiqueta = etiqueta.slice(0, 500);

  // 4. Datos según los campos efectivos de la sección final (+ defaults)
  const effective = getEffectiveFields(tpls, cats, categoryId);
  const data: ProductData = {};
  effective.forEach((f) => {
    const v = f.is_ai_fillable ? result[f.name] : undefined;
    data[f.name] = coerceValue(f, v === UNKNOWN_OPTION ? "" : v);
  });
  applyDefaults(effective, data);

  // 5. Crear pendiente
  const { data: product, error: insErr } = await admin
    .from("products")
    .insert({ id: productId, user_id: user.id, category_id: categoryId, status: "draft", data, ai_meta: aiMeta, image_url: publicUrl })
    .select()
    .single();
  if (insErr) {
    await admin.storage.from("product-images").remove([path]);
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json(
    { product, ai_fields: effective.filter((f) => f.is_ai_fillable).map((f) => f.name), warning: aiWarning },
    { status: 201 }
  );
}
