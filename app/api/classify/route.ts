import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { pickSubcategory } from "@/lib/gemini";
import { productTitle } from "@/lib/fields";
import { createAdminClient } from "@/lib/supabase/admin";
import { logUsage } from "@/lib/aiUsage";

export const runtime = "edge";

/**
 * POST /api/classify { product_id, category_id }
 * Elige automáticamente la subcategoría (dentro de la categoría dada) para un producto ya analizado
 * y la asigna. Primero intenta por coincidencia de texto; si no, pregunta a la IA (solo texto, rápido).
 */
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { product_id, category_id } = (await request.json().catch(() => ({}))) as { product_id?: string; category_id?: string };
  if (!product_id || !category_id) return NextResponse.json({ error: "Faltan datos" }, { status: 400 });

  const [{ data: product }, { data: subs }] = await Promise.all([
    supabase.from("products").select("*").eq("id", product_id).maybeSingle(),
    supabase.from("categories").select("id,name").eq("parent_id", category_id),
  ]);
  if (!product) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
  if (!subs?.length) {
    await supabase.from("products").update({ category_id }).eq("id", product_id);
    return NextResponse.json({ category_id, subcategory: null });
  }

  const title = productTitle(product.data);
  const desc = String(product.data.descripcion ?? "");
  const hint = product.ai_meta?.categoria_nueva ?? "";
  const text = `${hint} ${title} ${desc} ${product.ai_meta?.etiqueta ?? ""}`.toLowerCase();

  // 1) coincidencia directa por nombre de subcategoría (nombre exacto o palabra completa, sin acentos)
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const words = new Set(norm(text).split(/[^a-z0-9]+/).filter((w) => w.length >= 3));
  let chosen =
    subs.find((s) => norm(s.name) === norm(hint)) ??
    subs.find((s) => {
      const parts = norm(s.name).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !["para", "con", "sin"].includes(w));
      return parts.length > 0 && parts.every((w) => words.has(w));
    });

  // 2) IA (solo texto)
  if (!chosen) {
    try {
      const name = await pickSubcategory(`${title}. ${desc}. Etiqueta: ${product.ai_meta?.etiqueta ?? ""}`, subs.map((s) => s.name));
      chosen = subs.find((s) => s.name === name);
    } catch {
      /* si la IA falla, queda en la categoría general */
    }
    await logUsage(createAdminClient(), user.id, "classify");
  }

  const target = chosen?.id ?? category_id;
  const { error } = await supabase.from("products").update({ category_id: target }).eq("id", product_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ category_id: target, subcategory: chosen?.name ?? null });
}
