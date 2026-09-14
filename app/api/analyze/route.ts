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
  NO_CATALOG_OPTION,
  QuotaError,
  UNKNOWN_OPTION,
} from "@/lib/gemini";
import { PRESETS } from "@/lib/presets";
import { logUsage } from "@/lib/aiUsage";
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

/** Unión de campos IA de todas las subcategorías (sin repetir nombre) para una sola llamada a Gemini. */
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
 * 1. Verifica el usuario · 2. Sube la imagen · 3. Gemini elige subcategoría + rellena campos + lee etiqueta
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
    return NextResponse.json({ error: "Subcategoría no encontrada" }, { status: 404 });
  }

  // 2. Subir imagen
  const admin = createAdminClient();
  // El cliente puede fijar el id (uuid) para poder cancelar/limpiar; si no, se genera.
  const requested = String(form.get("product_id") ?? "");
  const productId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requested) ? requested : crypto.randomUUID();
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${user.id}/${productId}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  // Idempotencia: si la cola reenvía una foto ya procesada (recarga a mitad), devolvemos el producto existente.
  if (requested === productId) {
    const { data: existing } = await supabase.from("products").select("*").eq("id", productId).maybeSingle();
    if (existing) {
      const eff = getEffectiveFields(tpls, cats, existing.category_id);
      return NextResponse.json({ product: existing, ai_fields: eff.filter((f) => f.is_ai_fillable).map((f) => f.name), warning: null }, { status: 200 });
    }
  }

  const { error: upErr } = await admin.storage.from("product-images").upload(path, bytes, { contentType: file.type, upsert: true });
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
  const topNames = new Set(cats.filter((c) => !c.parent_id).map((c) => c.name.toLowerCase()));
  const catalogs = PRESETS.filter((p) => !topNames.has(p.name.toLowerCase())).map((p) => ({ name: p.name, description: p.description }));
  const ctx = { categoryPaths: Array.from(idByPath.keys()), fixedCategoryPath: fixedCategoryId ? pathById.get(fixedCategoryId) : null, catalogs };

  let categoryId: string | null = fixedCategoryId;
  const aiMeta: AiMeta = {};
  let result: Record<string, unknown> = {};
  let aiWarning: string | null = null;

  try {
    const out = await analyzeImage({
      imageBase64: bytesToBase64(bytes),
      mimeType: file.type,
      prompt: buildPrompt(aiFields, ctx),
      schema: buildResponseSchema(aiFields, ctx),
    });
    result = out.result;
    aiMeta.modelo = out.model;
  } catch (e) {
    await logUsage(admin, user.id, "analyze");
    if (e instanceof QuotaError) {
      // Cupo diario agotado en todos los modelos: el cliente pausa hasta el reinicio.
      await admin.storage.from("product-images").remove([path]);
      return NextResponse.json({ error: e.message, retry_after: e.retryAfterSec, daily: true }, { status: 429 });
    }
    if (e instanceof GeminiError && e.status === 429) {
      // Saturación momentánea: el cliente reintenta en breve (no creamos nada).
      await admin.storage.from("product-images").remove([path]);
      return NextResponse.json({ error: e.message, retry_after: 20 }, { status: 429 });
    }
    await admin.storage.from("product-images").remove([path]);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error analizando la imagen" }, { status: e instanceof GeminiError ? e.status : 500 });
  }

  await logUsage(admin, user.id, "analyze");

  // Subcategoría elegida por la IA
  if (!categoryId) {
    const chosen = String(result[META_KEYS.categoria] ?? "");
    if (chosen && chosen !== NEW_CATEGORY_OPTION && idByPath.has(chosen)) {
      categoryId = idByPath.get(chosen)!;
      aiMeta.categoria_sugerida = chosen;
    }
  }
  const nueva = String(result[META_KEYS.categoriaNueva] ?? "").trim();
  const chosenIsTop = categoryId ? !cats.find((c) => c.id === categoryId)?.parent_id : true;
  if (nueva && chosenIsTop) aiMeta.categoria_nueva = nueva.slice(0, 60);
  if (!categoryId) {
    const cat = String(result[META_KEYS.catalogo] ?? "").trim();
    const preset = cat && cat !== NO_CATALOG_OPTION ? PRESETS.find((p) => p.name === cat) : undefined;
    if (preset) aiMeta.catalogo_sugerido = preset.id;
    const general = String(result[META_KEYS.categoriaGeneral] ?? "").trim();
    if (general) aiMeta.categoria_nueva_general = general.slice(0, 60);
  }
  const etiqueta = String(result[META_KEYS.etiqueta] ?? "").trim();
  if (etiqueta) aiMeta.etiqueta = etiqueta.slice(0, 500);

  // 4. Datos: guardamos TODO lo que la IA devolvió (así no se pierde si el usuario cambia la subcategoría)
  //    y completamos los campos de la subcategoría final con sus valores por defecto.
  const data: ProductData = {};
  const NA = /^(no aplica|n\/a|na|no determinado|desconocido|ninguno|ninguna|-|—)$/i;
  aiFields.forEach((f) => {
    const v = result[f.name];
    const clean = v === UNKNOWN_OPTION || (typeof v === "string" && NA.test(v.trim())) ? "" : v;
    const val = coerceValue(f, clean);
    if (val !== "" && val !== null) data[f.name] = val;
  });
  const effective = getEffectiveFields(tpls, cats, categoryId);
  effective.forEach((f) => {
    if (!(f.name in data)) data[f.name] = f.field_type === "number" ? null : "";
  });
  // Respaldo: si no hay nombre pero sí texto de etiqueta, usamos la etiqueta como nombre provisional
  const nameField = effective.find((f) => /^(nombre|name|producto|titulo)$/i.test(f.name));
  if (nameField && !data[nameField.name] && etiqueta) {
    data[nameField.name] = etiqueta.replace(/\s+/g, " ").slice(0, 60);
  }
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
