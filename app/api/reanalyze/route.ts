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
import { resolveAiKey } from "@/lib/aiKey";
import { applyDefaults, coerceValue, getEffectiveFields } from "@/lib/fields";
import { categoryPath } from "@/lib/categories";
import { parseProposals } from "@/lib/variants";
import { parseExpiry } from "@/lib/inventory";
import { userExamples } from "@/lib/aiExamples";
import type { AiMeta, Category, FieldTemplate, ProductData } from "@/types/database";

export const runtime = "edge";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

/** Unión de campos IA de todas las categorías (para poder reubicar el producto en cualquiera). */
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
 * POST /api/reanalyze { product_id, keep_category?: boolean }
 * Vuelve a analizar la foto ya guardada de un producto (1 petición de IA).
 * - Actualiza solo los campos que llena la IA; precio, stock y demás datos manuales se conservan.
 * - Con keep_category: mantiene la categoría actual. Sin él: la IA puede reubicarlo y sugerir una nueva.
 */
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { product_id, keep_category } = (await request.json().catch(() => ({}))) as { product_id?: string; keep_category?: boolean };
  if (!product_id) return NextResponse.json({ error: "Falta el producto" }, { status: 400 });

  const [{ data: product }, { data: categories }, { data: templates }] = await Promise.all([
    supabase.from("products").select("*").eq("id", product_id).maybeSingle(),
    supabase.from("categories").select("*"),
    supabase.from("field_templates").select("*").order("sort_order"),
  ]);
  if (!product) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
  if (!product.image_url) return NextResponse.json({ error: "Este producto no tiene foto para analizar" }, { status: 400 });

  const cats = categories ?? [];
  const tpls = templates ?? [];
  const admin = createAdminClient();

  // Descargar la foto guardada
  const path = product.image_url.split("/product-images/")[1];
  if (!path) return NextResponse.json({ error: "No se encontró la foto" }, { status: 400 });
  const { data: blob, error: dlErr } = await admin.storage.from("product-images").download(path);
  if (dlErr || !blob) return NextResponse.json({ error: "No se pudo leer la foto guardada" }, { status: 500 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const mime = blob.type && blob.type.startsWith("image/") ? blob.type : "image/jpeg";

  // Contexto: fija la categoría si el usuario quiere conservarla
  const fixedCategoryId = keep_category ? product.category_id : null;
  const pathById = new Map(cats.map((c) => [c.id, categoryPath(cats, c.id)]));
  const idByPath = new Map(cats.map((c) => [categoryPath(cats, c.id), c.id]));
  const aiFields = fixedCategoryId ? getEffectiveFields(tpls, cats, fixedCategoryId).filter((f) => f.is_ai_fillable) : unionAiFields(tpls, cats);
  const topNames = new Set(cats.filter((c) => !c.parent_id).map((c) => c.name.toLowerCase()));
  const catalogs = PRESETS.filter((p) => !topNames.has(p.name.toLowerCase())).map((p) => ({ name: p.name, description: p.description }));
  const examples = await userExamples(supabase, cats);
  const ctx = { categoryPaths: Array.from(idByPath.keys()), fixedCategoryPath: fixedCategoryId ? pathById.get(fixedCategoryId) : null, catalogs, examples };

  let result: Record<string, unknown>;
  const aiMeta: AiMeta = {};
  const key = await resolveAiKey(admin, user.id);
  try {
    const out = await analyzeImage(
      {
        imageBase64: bytesToBase64(bytes),
        mimeType: mime,
        prompt: buildPrompt(aiFields, ctx),
        schema: buildResponseSchema(aiFields, ctx),
      },
      key
    );
    result = out.result;
    aiMeta.modelo = out.model;
  } catch (e) {
    await logUsage(admin, user.id, "reanalyze", key.own);
    if (e instanceof QuotaError) return NextResponse.json({ error: e.message, retry_after: e.retryAfterSec, daily: true }, { status: 429 });
    const status = e instanceof GeminiError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error analizando la imagen" }, { status });
  }
  await logUsage(admin, user.id, "reanalyze", key.own);

  // Categoría
  let categoryId: string | null = fixedCategoryId;
  if (!keep_category) {
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
  const proposals = parseProposals(String(result[META_KEYS.variantes] ?? ""));
  if (Object.keys(proposals).length) aiMeta.variantes_propuestas = proposals;

  // Datos: se respetan los manuales (precio, stock…) y se reemplazan los de la IA
  const NA = /^(no aplica|n\/a|na|no determinado|desconocido|ninguno|ninguna|-|—)$/i;
  const effective = getEffectiveFields(tpls, cats, categoryId);
  const data: ProductData = { ...product.data };
  const manualNames = new Set(effective.filter((f) => !f.is_ai_fillable).map((f) => f.name));
  const changed: string[] = [];
  aiFields.forEach((f) => {
    if (manualNames.has(f.name)) return; // nunca pisar lo que llena el usuario
    const v = result[f.name];
    const clean = v === UNKNOWN_OPTION || (typeof v === "string" && NA.test(v.trim())) ? "" : v;
    const val = coerceValue(f, clean);
    if (val !== "" && val !== null && val !== data[f.name]) {
      data[f.name] = val;
      changed.push(f.name);
    }
  });
  effective.forEach((f) => {
    if (!(f.name in data)) data[f.name] = f.field_type === "number" ? null : "";
  });
  applyDefaults(effective, data);

  // Vencimiento leído de la foto: solo se pone si el producto aún no tenía fecha (no pisa lo escrito a mano)
  const expiresAt = product.expires_at ? null : parseExpiry(String(result[META_KEYS.vencimiento] ?? ""));
  if (expiresAt) changed.push("vencimiento");

  const { data: updated, error } = await admin
    .from("products")
    .update({ data, category_id: categoryId, ai_meta: { ...(product.ai_meta ?? {}), ...aiMeta }, ...(expiresAt ? { expires_at: expiresAt } : {}) })
    .eq("id", product_id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ product: updated, changed, model: aiMeta.modelo ?? null });
}
