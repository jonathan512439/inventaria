import type { SupabaseClient } from "@supabase/supabase-js";
import type { Category, Database } from "@/types/database";
import { categoryPath } from "./categories";

/**
 * Ejemplos de estilo para la IA: los últimos productos confirmados del usuario, con su ubicación.
 * Sin entrenamiento: se añaden al prompt en cada análisis (máx. `limit`).
 */
export async function userExamples(supabase: SupabaseClient<Database>, categories: Category[], limit = 8): Promise<string[]> {
  const { data } = await supabase
    .from("product_summaries")
    .select("nombre,marca,category_id,updated_at")
    .eq("status", "confirmed")
    .not("nombre", "is", null)
    .order("updated_at", { ascending: false })
    .limit(40);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of data ?? []) {
    if (!r.nombre) continue;
    // Variedad: como mucho 2 ejemplos por subcategoría
    const key = r.category_id ?? "none";
    const n = Array.from(seen).filter((k) => k.startsWith(key + "#")).length;
    if (n >= 2) continue;
    seen.add(`${key}#${out.length}`);
    const where = r.category_id ? categoryPath(categories, r.category_id) : "Sin categoría";
    out.push(`${where} → «${r.nombre.slice(0, 60)}»${r.marca ? ` (marca ${r.marca.slice(0, 30)})` : ""}`);
    if (out.length >= limit) break;
  }
  return out;
}
