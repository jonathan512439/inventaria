/**
 * Prueba de los números en SQL (migración 027 · Fase 6.9 · C7.7 · E3).
 *   npm run test:numbers
 * Crea un dueño y un vendedor temporales y los elimina al terminar. No consume IA.
 * Comprueba que «por reponer» sigue la MISMA regla que la lista de pedido (RestockSheet.restockLines):
 * por variante, mínimo de variante › producto › categoría principal › negocio, avisos silenciados fuera.
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal, requireEnv } from "./env.mjs";
loadEnvLocal();
requireEnv("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY");
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const PASS = "Test123456!";
let failed = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "OK " : "FAIL"} ${msg}`);
  if (!ok) failed++;
};
const uuid = () => crypto.randomUUID();
async function tempUser(tag) {
  const { data, error } = await admin.auth.admin.createUser({ email: `${tag}-${Date.now()}@example.com`, password: PASS, email_confirm: true });
  if (error) throw error;
  const { data: m } = await admin.from("business_members").select("business_id").eq("user_id", data.user.id).single();
  return { id: data.user.id, email: data.user.email, bid: m.business_id };
}
async function signIn(u) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email: u.email, password: PASS });
  if (error) throw error;
  return c;
}

const users = [];
try {
  const A = await tempUser("num-dueno");
  users.push(A);
  const V = await tempUser("num-vendedor");
  users.push(V);
  await admin.from("business_members").insert({ business_id: A.bid, user_id: V.id, role: "vendedor", display_name: "Vendedor" });
  await admin.from("profiles").update({ current_business_id: A.bid }).eq("id", V.id);
  await admin.from("businesses").update({ min_stock_default: 3, expiry_days: 30 }).eq("id", A.bid);

  const cat = async (row) => (await admin.from("categories").insert({ user_id: A.id, business_id: A.bid, ...row }).select().single()).data;
  const quiet = await cat({ name: "Silenciada", alerts_off: true });
  const top = await cat({ name: "Bebidas", min_stock_default: 10 });
  const sub = await cat({ name: "Gaseosas", parent_id: top.id });
  const ins = async (data, extra = {}) => (await admin.from("products").insert({ user_id: A.id, business_id: A.bid, status: "confirmed", data, ...extra }).select().single()).data;
  const today = new Date();
  const inDays = (n) => new Date(today.getTime() + n * 86400000).toISOString().slice(0, 10);

  const R1 = await ins({ nombre: "Bajo el mínimo del negocio", precio: 5, stock: 2 });
  const R2 = await ins({ nombre: "Con stock", precio: 10, stock: 10 }, { expires_at: inDays(5) });
  await ins({ nombre: "Producto silenciado", precio: 5, stock: 1 }, { alerts_off: true });
  await ins({ nombre: "Categoría silenciada", precio: 5, stock: 1 }, { category_id: quiet.id });
  const R5 = await ins({ nombre: "Mínimo de la categoría principal", precio: 5, stock: 8 }, { category_id: sub.id });
  const R6 = await ins({ nombre: "Polera", precio: 30, stock: 0 });
  await admin.from("product_variants").insert([
    { user_id: A.id, business_id: A.bid, product_id: R6.id, values: { talla: "S" }, label: "S", stock: 5 },
    { user_id: A.id, business_id: A.bid, product_id: R6.id, values: { talla: "M" }, label: "M", stock: 1 },
  ]);
  const R7 = await ins({ nombre: "Agotado con mínimo 0", precio: 5, stock: 0 }, { min_stock: 0 });
  await ins({ nombre: "Sin precio", stock: 9 });
  await admin.from("product_costs").insert({ business_id: A.bid, product_id: R2.id, cost: 4 });

  const a = await signIn(A);
  const v = await signIn(V);

  // --- Por reponer ---
  const { data: lines, error: rlErr } = await v.rpc("restock_lines");
  const ids = new Set((lines ?? []).map((l) => l.product_id));
  const expected = [R1.id, R5.id, R6.id, R7.id];
  check(!rlErr && ids.size === 4 && expected.every((id) => ids.has(id)), `por reponer = misma regla que la lista de pedido (4 productos) → ${ids.size} ${rlErr?.message ?? ""}`);
  const r6 = (lines ?? []).filter((l) => l.product_id === R6.id);
  check(r6.length === 1 && Number(r6[0].stock) === 1 && r6[0].min_stock === 3, `con variantes cuenta por variante (solo M, 1 ≤ 3) aunque el total sea 6 → ${JSON.stringify(r6)}`);
  check((lines ?? []).some((l) => l.product_id === R5.id && l.min_stock === 10), "una subcategoría usa el mínimo de su categoría principal (10)");

  // --- Ventas y resumen de hoy ---
  const cust = (await admin.from("customers").insert({ user_id: A.id, business_id: A.bid, name: "Juanito" }).select().single()).data;
  const s1 = await a.rpc("register_sale", { p_id: uuid(), p_lines: [{ product_id: R2.id, variant_id: null, qty: 1, unit_price: 10 }] });
  const s2 = await a.rpc("register_sale", { p_id: uuid(), p_lines: [{ product_id: R2.id, variant_id: null, qty: 1, unit_price: 10 }], p_status: "fiado", p_paid: 0, p_customer: cust.id });
  check(!s1.error && !s2.error, `dos ventas registradas ${s1.error?.message ?? ""} ${s2.error?.message ?? ""}`);

  const { data: tO, error: tErr } = await a.rpc("today_summary");
  const { data: tV } = await v.rpc("today_summary");
  check(!tErr && Number(tO?.today?.total) === 20 && Number(tO?.today?.count) === 2, `hoy: 2 ventas por 20 → ${tO?.today?.count} / ${tO?.today?.total} ${tErr?.message ?? ""}`);
  check(Number(tO?.today?.profit) === 12 && tV?.today?.profit === null && Number(tV?.today?.total) === 20, `ganancia de hoy solo para el dueño → dueño ${tO?.today?.profit}, vendedor ${tV?.today?.profit}`);
  check(Number(tO?.restock?.products) === 4 && Number(tO?.restock?.out) === 1, `Inicio cuenta por reponer igual que la lista → ${tO?.restock?.products} (agotados ${tO?.restock?.out})`);
  check(Number(tO?.expiring?.count) === 1 && tO?.expiring?.list?.[0]?.id === R2.id, `por vencer en 5 días → ${tO?.expiring?.count}`);
  check(Number(tO?.no_price) === 1, `sin precio → ${tO?.no_price}`);
  check(Number(tO?.debts?.total) === 10 && Number(tO?.debts?.customers) === 1, `te deben 10 (1 cliente) → ${tO?.debts?.total} / ${tO?.debts?.customers}`);
  check(tO?.sales_ever === true && tO?.closed_today === false, "hubo ventas y la caja de hoy no se cerró");

  // --- Números del dueño ---
  const { error: vRep } = await v.rpc("insights_report", { p_period: "mes" });
  check(!!vRep, `el vendedor no ve los números del negocio → ${vRep?.message}`);
  const { data: rep, error: repErr } = await a.rpc("insights_report", { p_period: "7d" });
  check(!repErr && Number(rep?.now?.total) === 20 && Number(rep?.now?.profit) === 12 && Number(rep?.now?.count) === 2, `7 días: vendido 20, ganancia 12 → ${rep?.now?.total} / ${rep?.now?.profit} ${repErr?.message ?? ""}`);
  check(Array.isArray(rep?.per_day) && rep.per_day.length === 14 && Number(rep.per_day[13].total) === 20, `ventas por día: 14 días y hoy 20 → ${rep?.per_day?.length} / ${rep?.per_day?.[13]?.total}`);
  check(rep?.top_units?.[0]?.product_id === R2.id && Number(rep.top_units[0].units) === 2, "el más vendido es el producto vendido (2 unid.)");
  check(rep?.top_customers?.[0]?.name === "Juanito" && Number(rep.top_customers[0].total) === 10, "mejores clientes: Juanito 10");
  check(Number(rep?.dead?.count) >= 1 && !rep.dead.list.some((d) => d.id === R2.id), `parados 60 días: no incluye lo que se vendió → ${rep?.dead?.count}`);
  check(Number(rep?.inventory?.cost) === 32 && Number(rep?.inventory?.units) > 0, `valor del inventario con costo (8 unid. × 4 = 32) → ${rep?.inventory?.cost}`);
  const bev = (rep?.by_category ?? []).find((c) => c.id === top.id);
  check(Number(bev?.units) === 8, `valor por categoría principal incluye sus subcategorías → ${bev?.units}`);
} catch (e) {
  failed++;
  console.error("ERROR", e);
} finally {
  for (const u of users) await admin.auth.admin.deleteUser(u.id);
}
console.log(failed ? `\n${failed} fallos` : "\nTodo OK");
process.exit(failed ? 1 : 0);
