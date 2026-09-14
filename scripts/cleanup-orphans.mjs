/**
 * Borra fotos del bucket que no pertenecen a ningún producto (restos de cancelaciones/pruebas).
 *   npm run storage:clean
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal, requireEnv } from "./env.mjs";
loadEnvLocal();
requireEnv("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: prods } = await admin.from("products").select("image_url");
const referenced = new Set((prods ?? []).map((p) => p.image_url?.split("/product-images/")[1]).filter(Boolean));
const { data: folders } = await admin.storage.from("product-images").list("", { limit: 1000 });
const orphans = [];
for (const f of folders ?? []) {
  if (f.id) continue;
  const { data: inner } = await admin.storage.from("product-images").list(f.name, { limit: 1000 });
  for (const x of inner ?? []) {
    const path = `${f.name}/${x.name}`;
    // margen de 10 minutos: una foto recién subida puede estar aún analizándose
    const age = Date.now() - new Date(x.created_at ?? 0).getTime();
    if (!referenced.has(path) && age > 10 * 60 * 1000) orphans.push(path);
  }
}
if (orphans.length) await admin.storage.from("product-images").remove(orphans);
console.log(`fotos huérfanas eliminadas: ${orphans.length}`);
