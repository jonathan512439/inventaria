/**
 * Prueba de la migración 020 (Fase 6.9 · C1): columnas del sistema sincronizadas con `data` en los dos sentidos,
 * stock con variantes, búsqueda por la vista, código normalizado y código de variante único por negocio.
 *   npm run test:fields
 * Crea dos usuarios temporales (cada uno con su negocio) y los elimina al terminar. No consume IA.
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal, requireEnv } from "./env.mjs";
loadEnvLocal();
requireEnv("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY");
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
let failed = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "OK " : "FAIL"} ${msg}`);
  if (!ok) failed++;
};
const PASS = "Test123456!";
async function tempUser(tag) {
  const { data, error } = await admin.auth.admin.createUser({ email: `${tag}-${Date.now()}@example.com`, password: PASS, email_confirm: true });
  if (error) throw error;
  const { data: m } = await admin.from("business_members").select("business_id").eq("user_id", data.user.id).single();
  return { id: data.user.id, email: data.user.email, bid: m.business_id };
}
const get = async (id) => (await admin.from("products").select("*").eq("id", id).single()).data;

const users = [];
try {
  const a = await tempUser("fields-a");
  users.push(a);
  const b = await tempUser("fields-b");
  users.push(b);

  // 1) Alta solo con data (como hace hoy la app): las columnas se rellenan
  const { data: p, error: pe } = await admin
    .from("products")
    .insert({ user_id: a.id, business_id: a.bid, status: "confirmed", data: { nombre: "Arroz Grano de Oro", Precio: "12,5", cantidad: 7, codigo: " abc-1 ", descripcion: "Bolsa 1 kg" } })
    .select()
    .single();
  check(!pe, `alta con data ${pe?.message ?? ""}`);
  check(p.nombre === "Arroz Grano de Oro" && Number(p.precio) === 12.5 && Number(p.stock) === 7, `columnas desde data → ${p.nombre} · ${p.precio} · ${p.stock}`);
  check(p.codigo_norm === "ABC-1", `código normalizado → ${p.codigo_norm}`);
  check(/arroz/.test(p.search) && /bolsa 1 kg/.test(p.search), "búsqueda incluye nombre y descripción");

  // 2) Cambia data → cambia la columna
  await admin.from("products").update({ data: { ...p.data, cantidad: 4 } }).eq("id", p.id);
  let r = await get(p.id);
  check(Number(r.stock) === 4, `data.cantidad 4 → columna stock ${r.stock}`);

  // 3) Cambia la columna → cambia data con la clave que ya usaba (no crea "stock" ni "precio")
  await admin.from("products").update({ stock: 9, precio: 15.5 }).eq("id", p.id);
  r = await get(p.id);
  check(r.data.cantidad === 9 && !("stock" in r.data), `columna stock 9 → data.cantidad ${r.data.cantidad}`);
  check(r.data.Precio === 15.5 && !("precio" in r.data), `columna precio 15.5 → data.Precio ${r.data.Precio}`);
  check(Number(r.stock) === 9 && Number(r.precio) === 15.5, "las columnas quedan con lo escrito");

  // 4) Alta con columna y sin la clave en data → se crea la clave canónica
  const { data: q } = await admin.from("products").insert({ user_id: a.id, business_id: a.bid, status: "confirmed", data: { nombre: "Fideo" }, stock: 3 }).select().single();
  check(q.data.stock === 3 && Number(q.stock) === 3, `columna stock al crear → data.stock ${q.data.stock}`);

  // 5) Valor raro en data no rompe el guardado
  const { error: odd } = await admin.from("products").update({ data: { ...q.data, precio: "consultar" } }).eq("id", q.id);
  r = await get(q.id);
  check(!odd && r.precio === null, `precio no numérico → columna nula, sin error ${odd?.message ?? ""}`);

  // 6) Con variantes: stock = suma; escribirlo a mano no lo pisa
  const { error: ve } = await admin.from("product_variants").insert([
    { user_id: a.id, business_id: a.bid, product_id: q.id, values: { talla: "S" }, label: "S", stock: 2, codigo_barras: "VAR-1" },
    { user_id: a.id, business_id: a.bid, product_id: q.id, values: { talla: "M" }, label: "M", stock: 5 },
  ]);
  check(!ve, `variantes ${ve?.message ?? ""}`);
  r = await get(q.id);
  check(Number(r.stock) === 7 && r.data.stock === 7, `stock con variantes = 7 → ${r.stock} / data ${r.data.stock}`);
  await admin.from("products").update({ stock: 100 }).eq("id", q.id);
  r = await get(q.id);
  check(Number(r.stock) === 7, `escribir 100 a mano no pisa la suma → ${r.stock}`);

  // 7) Código de variante: repetido en el mismo negocio se rechaza; en otro negocio se permite
  const { error: dupSame } = await admin.from("product_variants").insert({ user_id: a.id, business_id: a.bid, product_id: q.id, values: { talla: "L" }, label: "L", stock: 1, codigo_barras: "VAR-1" });
  check(!!dupSame, "código de variante repetido en el mismo negocio se rechaza");
  const { data: pb } = await admin.from("products").insert({ user_id: b.id, business_id: b.bid, status: "confirmed", data: { nombre: "Polera" } }).select().single();
  const { error: dupOther } = await admin.from("product_variants").insert({ user_id: b.id, business_id: b.bid, product_id: pb.id, values: { talla: "S" }, label: "S", stock: 1, codigo_barras: "VAR-1" });
  check(!dupOther, `el mismo código en otro negocio se permite ${dupOther?.message ?? ""}`);

  // 8) Como el usuario (clave anónima + RLS): vista, búsqueda, costo visible al dueño, código exacto
  const ua = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  await ua.auth.signInWithPassword({ email: a.email, password: PASS });
  await admin.from("product_costs").insert({ business_id: a.bid, product_id: p.id, cost: 8 }); // 025: el costo vive aparte
  const { data: found } = await ua.from("product_summaries").select("id,nombre,precio_compra,stock").ilike("search", "%grano de%");
  check(found?.length === 1 && found[0].id === p.id, `búsqueda en la vista encuentra el producto → ${found?.length}`);
  check(Number(found?.[0]?.precio_compra) === 8, `el dueño ve su costo en la vista → ${found?.[0]?.precio_compra}`);
  const { data: byCode } = await ua.from("products").select("id").eq("codigo_norm", "ABC-1").is("deleted_at", null);
  check(byCode?.length === 1, "búsqueda exacta por código normalizado");
  const { data: foreign } = await ua.from("product_summaries").select("id").eq("id", pb.id);
  check(foreign?.length === 0, "no ve productos de otro negocio");
} catch (e) {
  failed++;
  console.error("ERROR", e);
} finally {
  for (const u of users) await admin.auth.admin.deleteUser(u.id);
}
console.log(failed ? `\n${failed} fallos` : "\nTodo OK");
process.exit(failed ? 1 : 0);
