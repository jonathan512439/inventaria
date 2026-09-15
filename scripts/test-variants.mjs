/**
 * Prueba de las reglas de variantes en la base de datos (stock derivado, códigos únicos, borrado en cascada).
 *   npm run test:variants
 * Crea un usuario temporal y lo elimina al terminar. No consume IA.
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal, requireEnv } from "./env.mjs";
loadEnvLocal();
requireEnv("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "OK " : "FAIL"} ${msg}`); if (!ok) failed++; };
const { data: u, error: ue } = await admin.auth.admin.createUser({ email: `var-${Date.now()}@example.com`, password: "Test123456!", email_confirm: true });
if (ue) { console.error(ue.message); process.exit(1); }
const uid = u.user.id;
try {
  const { data: cat } = await admin.from("categories").insert({ user_id: uid, name: "Ropa", parent_id: null }).select().single();
  const { data: axes, error: ae } = await admin.from("variant_axes").insert([
    { user_id: uid, category_id: cat.id, key: "talla", label: "Talla", options: ["S", "M", "L"], sort_order: 0 },
    { user_id: uid, category_id: cat.id, key: "color", label: "Color", options: ["Rojo", "Azul"], sort_order: 1 },
  ]).select();
  check(!ae && axes.length === 2, "ejes creados");
  const { data: p } = await admin.from("products").insert({ user_id: uid, category_id: cat.id, status: "confirmed", data: { nombre: "Polera", precio: 35, stock: 1 } }).select().single();
  const { error: ve } = await admin.from("product_variants").insert([
    { user_id: uid, product_id: p.id, values: { talla: "S", color: "Rojo" }, label: "S · Rojo", stock: 3 },
    { user_id: uid, product_id: p.id, values: { talla: "M", color: "Rojo" }, label: "M · Rojo", stock: 5, codigo_barras: "7791234567890" },
  ]);
  check(!ve, `variantes creadas ${ve?.message ?? ""}`);
  let { data: p2 } = await admin.from("products").select("data").eq("id", p.id).single();
  check(p2.data.stock === 8, `stock del producto = suma (8) → ${p2.data.stock}`);
  await admin.from("products").update({ data: { ...p2.data, stock: 100 } }).eq("id", p.id);
  ({ data: p2 } = await admin.from("products").select("data").eq("id", p.id).single());
  check(p2.data.stock === 8, `escribir stock a mano no pisa la suma → ${p2.data.stock}`);
  const { data: v } = await admin.from("product_variants").select("*").eq("product_id", p.id).eq("label", "M · Rojo").single();
  await admin.from("product_variants").update({ stock: 0 }).eq("id", v.id);
  ({ data: p2 } = await admin.from("products").select("data").eq("id", p.id).single());
  check(p2.data.stock === 3, `venta de la M roja → stock 3 → ${p2.data.stock}`);
  const { error: dupe } = await admin.from("product_variants").insert({ user_id: uid, product_id: p.id, values: { talla: "L", color: "Rojo" }, label: "L · Rojo", stock: 1, codigo_barras: "7791234567890" });
  check(!!dupe, "código de barras repetido entre variantes se rechaza");
  const { error: dupv } = await admin.from("product_variants").insert({ user_id: uid, product_id: p.id, values: { color: "Rojo", talla: "S" }, label: "S · Rojo", stock: 1 });
  check(!!dupv, "misma combinación (otro orden de claves) se rechaza");
  await admin.from("product_variants").delete().eq("id", v.id);
  ({ data: p2 } = await admin.from("products").select("data").eq("id", p.id).single());
  check(p2.data.stock === 3, `borrar variante recalcula → ${p2.data.stock}`);
  const { error: me } = await admin.from("stock_movements").insert({ user_id: uid, product_id: p.id, variant_id: null, variant_label: "S · Rojo", tipo: "venta", cantidad: 1, total: 35, stock_resultante: 2 });
  check(!me, `movimiento con variante ${me?.message ?? ""}`);
  await admin.from("categories").delete().eq("id", cat.id);
  const { data: axesLeft } = await admin.from("variant_axes").select("id").eq("user_id", uid);
  check(axesLeft.length === 0, "borrar categoría borra sus ejes");
} finally {
  await admin.auth.admin.deleteUser(uid);
}
console.log(failed ? `\n${failed} fallos` : "\nTodo OK");
process.exit(failed ? 1 : 0);
