import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generatePreset, GeminiError } from "@/lib/gemini";
import { getPreset, type PresetField } from "@/lib/presets";
import { nameKey } from "@/lib/categories";
import { createAdminClient } from "@/lib/supabase/admin";
import { logUsage } from "@/lib/aiUsage";

export const runtime = "edge";

interface Body {
  presets?: string[]; // ids de lib/presets
  description?: string; // "vendo repuestos de moto" → la IA genera la categoría
  ensure_section?: string; // subcategoría que debe existir en la categoría generada (la que sugirió la IA para el producto)
  plain_names?: string[]; // categorías "solo con nombre": traen los datos básicos, sin subcategorías
  business_name?: string;
  onboarded?: boolean;
}

const BASE_FIELDS: PresetField[] = [
  { name: "nombre", field_type: "text", is_ai_fillable: true },
  { name: "marca", field_type: "text", is_ai_fillable: true },
  { name: "descripcion", field_type: "text", is_ai_fillable: true },
  { name: "color", field_type: "text", is_ai_fillable: true },
  { name: "precio", field_type: "number", is_ai_fillable: false },
  { name: "precio_compra", field_type: "number", is_ai_fillable: false },
  { name: "stock", field_type: "number", is_ai_fillable: false, default_value: "1" },
];

interface TypeSpec {
  name: string;
  icon: string;
  sections: string[];
  fields: PresetField[];
}

/**
 * POST /api/setup
 * Crea tipos de producto (categoría de nivel superior + subcategorías hijas + datos asociados)
 * a partir de categorías preconfiguradas y/o una descripción en texto. Idempotente por nombre.
 */
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const specs: TypeSpec[] = [];
  for (const raw of body.plain_names ?? []) {
    const name = String(raw).trim().slice(0, 60);
    if (name) specs.push({ name, icon: "🏷️", sections: [], fields: BASE_FIELDS });
  }
  for (const id of body.presets ?? []) {
    const p = getPreset(id);
    if (p) specs.push({ name: p.name, icon: p.icon, sections: p.sections, fields: p.fields });
  }

  if (body.description?.trim()) {
    try {
      const g = await generatePreset(body.description.trim());
      await logUsage(createAdminClient(), user.id, "setup");
      specs.push({
        name: g.name,
        icon: g.icon || "🏪",
        sections: (() => {
          const secs = g.sections.slice(0, 10);
          const want = body.ensure_section?.trim();
          if (want && !secs.some((s) => nameKey(s) === nameKey(want))) secs.unshift(want.slice(0, 40));
          return secs;
        })(),
        fields: [
          { name: "nombre", field_type: "text", is_ai_fillable: true },
          { name: "marca", field_type: "text", is_ai_fillable: true },
          { name: "descripcion", field_type: "text", is_ai_fillable: true },
          ...g.fields.slice(0, 4).map((f) => ({
            name: f.name.toLowerCase().replace(/[^a-z0-9áéíóúñ]+/g, "_").replace(/^_|_$/g, "").slice(0, 40),
            field_type: f.field_type,
            is_ai_fillable: f.is_ai_fillable,
            options: f.field_type === "select" ? f.options?.slice(0, 8) : undefined,
          })),
          { name: "precio", field_type: "number", is_ai_fillable: false },
          { name: "precio_compra", field_type: "number", is_ai_fillable: false },
          { name: "stock", field_type: "number", is_ai_fillable: false, default_value: "1" },
        ],
      });
    } catch (e) {
      await logUsage(createAdminClient(), user.id, "setup");
      const status = e instanceof GeminiError ? e.status : 500;
      return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo generar la categoría" }, { status });
    }
  }

  // Estado actual (RLS: solo lo del usuario)
  const [{ data: cats }, { data: tpls }] = await Promise.all([
    supabase.from("categories").select("*"),
    supabase.from("field_templates").select("*"),
  ]);
  const existingTop = new Map((cats ?? []).filter((c) => !c.parent_id).map((c) => [nameKey(c.name), c]));
  const created: string[] = [];

  for (const spec of specs) {
    let top = existingTop.get(nameKey(spec.name));
    if (!top) {
      const { data, error } = await supabase
        .from("categories")
        .insert({ user_id: user.id, name: spec.name, parent_id: null, icon: spec.icon })
        .select()
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      top = data;
      existingTop.set(nameKey(spec.name), data);
      created.push(spec.name);
    }

    // Subcategorías hijas que falten
    const existingChildren = new Set((cats ?? []).filter((c) => c.parent_id === top!.id).map((c) => nameKey(c.name)));
    const newSections = spec.sections.filter((s) => !existingChildren.has(nameKey(s)));
    if (newSections.length) {
      const { error } = await supabase
        .from("categories")
        .insert(newSections.map((name) => ({ user_id: user.id, name, parent_id: top!.id })));
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Datos del tipo (se heredan a sus subcategorías). No duplicar los que ya existen globales o en el tipo.
    const existingNames = new Set(
      (tpls ?? []).filter((t) => t.category_id === null || t.category_id === top!.id).map((t) => t.name.toLowerCase())
    );
    const newFields = spec.fields.filter((f) => !existingNames.has(f.name.toLowerCase()));
    if (newFields.length) {
      const { error } = await supabase.from("field_templates").insert(
        newFields.map((f, i) => ({
          user_id: user.id,
          category_id: top!.id,
          name: f.name,
          field_type: f.field_type,
          options: f.options ?? null,
          is_ai_fillable: f.is_ai_fillable,
          default_value: f.default_value ?? null,
          sort_order: i,
        }))
      );
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // Perfil
  const profilePatch: Record<string, unknown> = { id: user.id };
  if (body.business_name !== undefined) profilePatch.business_name = body.business_name.trim() || null;
  if (body.onboarded) profilePatch.onboarded_at = new Date().toISOString();
  if (Object.keys(profilePatch).length > 1) {
    const { error } = await supabase.from("profiles").upsert(profilePatch as { id: string });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, created, types: specs.map((s) => s.name) });
}
