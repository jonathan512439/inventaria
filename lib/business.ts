import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Negocio activo de un usuario, para rutas que insertan con service role (el disparador que rellena
 * business_id usa auth.uid(), que con service role es nulo).
 */
export async function businessIdOf(admin: SupabaseClient<Database>, userId: string): Promise<string | null> {
  const { data: prof } = await admin.from("profiles").select("current_business_id").eq("id", userId).maybeSingle();
  if (prof?.current_business_id) {
    const { data: ok } = await admin.from("business_members").select("business_id").eq("business_id", prof.current_business_id).eq("user_id", userId).eq("active", true).maybeSingle();
    if (ok) return ok.business_id;
  }
  const { data: m } = await admin.from("business_members").select("business_id").eq("user_id", userId).eq("active", true).order("created_at").limit(1).maybeSingle();
  return m?.business_id ?? null;
}

/** Ids de todos los negocios del usuario (para rutas con service role que filtraban por user_id). */
export async function businessIdsOf(admin: SupabaseClient<Database>, userId: string): Promise<string[]> {
  const { data } = await admin.from("business_members").select("business_id").eq("user_id", userId).eq("active", true);
  return (data ?? []).map((m) => m.business_id);
}
