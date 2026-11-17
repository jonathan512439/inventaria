/**
 * Prueba de las operaciones atómicas (migración 021 · Fase 6.9 · C2).
 *   npm run test:ops
 * Crea usuarios temporales (dueño, vendedor y otro negocio) y los elimina al terminar. No consume IA.
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
const stockOf = async (id) => Number((await admin.from("products").select("stock").eq("id", id).single()).data.stock);
const variantStock = async (id) => (await admin.from("product_variants").select("stock").eq("id", id).single()).data.stock;
const line = (product_id, qty, unit_price, variant_id = null) => ({ product_id, variant_id, qty, unit_price });

const users = [];
try {
  const A = await tempUser("ops-dueno");
  users.push(A);
  const V = await tempUser("ops-vendedor");
  users.push(V);
  const B = await tempUser("ops-otro");
  users.push(B);
  // El vendedor se une al negocio de A
  await admin.from("business_members").insert({ business_id: A.bid, user_id: V.id, role: "vendedor", display_name: "Vendedor" });
  await admin.from("profiles").update({ current_business_id: A.bid }).eq("id", V.id);

  const ins = async (row) => (await admin.from("products").insert({ user_id: A.id, business_id: A.bid, status: "confirmed", ...row }).select().single()).data;
  const P1 = await ins({ data: { nombre: "Gaseosa 2L", precio: 5, precio_compra: 3, stock: 10 } });
  const P2 = await ins({ data: { nombre: "Polera", precio: 35, stock: 0 } });
  const { data: vars } = await admin.from("product_variants").insert([
    { user_id: A.id, business_id: A.bid, product_id: P2.id, values: { talla: "S" }, label: "S", stock: 4, costo: 7 },
    { user_id: A.id, business_id: A.bid, product_id: P2.id, values: { talla: "M" }, label: "M", stock: 2 },
  ]).select();
  const S = vars.find((v) => v.label === "S");

  const a = await signIn(A);
  const v = await signIn(V);
  const b = await signIn(B);

  // 1) 10 ventas simultáneas de 1 unidad sobre stock 10
  const results = await Promise.all(Array.from({ length: 10 }, () => a.rpc("register_sale", { p_id: uuid(), p_lines: [line(P1.id, 1, 5)] })));
  const errs = results.filter((r) => r.error);
  check(!errs.length, `10 ventas simultáneas sin error ${errs[0]?.error?.message ?? ""}`);
  check((await stockOf(P1.id)) === 0, `stock 10 − 10 = 0 → ${await stockOf(P1.id)}`);
  const nums = results.map((r) => r.data?.sale?.number).filter(Boolean).sort((x, y) => x - y);
  check(new Set(nums).size === 10 && nums[0] === 1 && nums[9] === 10, `números 1…10 sin repetir → ${nums.join(",")}`);
  check(results.every((r) => Number(r.data?.sale?.cost_total) === 3), "costo de cada venta leído en el servidor (3)");

  // 2) La misma venta dos veces → una sola
  const sid = uuid();
  const r1 = await a.rpc("register_sale", { p_id: sid, p_lines: [line(P1.id, 1, 5)] });
  const r2 = await a.rpc("register_sale", { p_id: sid, p_lines: [line(P1.id, 1, 5)] });
  const { count: nSale } = await admin.from("sales").select("id", { count: "exact", head: true }).eq("id", sid);
  check(!r1.error && r2.data?.repeated === true && nSale === 1, `venta repetida no se duplica ${r1.error?.message ?? ""}`);

  // 3) Vender sin stock: queda en 0 y se anota el faltante
  const r3 = await a.rpc("register_sale", { p_id: uuid(), p_lines: [line(P1.id, 3, 5)] });
  const { data: mv3 } = await admin.from("stock_movements").select("faltante,stock_resultante").eq("sale_id", r3.data?.sale?.id).single();
  check((await stockOf(P1.id)) === 0 && mv3?.faltante === 3, `vender 3 sin stock → stock 0 y faltante ${mv3?.faltante}`);

  // 4) Variantes
  const r4 = await a.rpc("register_sale", { p_id: uuid(), p_lines: [line(P2.id, 1, 35)] });
  check(!!r4.error && /variante/i.test(r4.error.message), `producto con tallas sin elegir talla se rechaza → ${r4.error?.message}`);
  const r5 = await a.rpc("register_sale", { p_id: uuid(), p_lines: [line(P2.id, 1, 35, S.id)] });
  check(!r5.error && (await variantStock(S.id)) === 3 && (await stockOf(P2.id)) === 5, `venta de la S → S 3, total 5 → ${await stockOf(P2.id)}`);
  check(Number(r5.data?.items?.[0]?.unit_cost) === 7, "costo de la variante en la línea (7)");

  // 5) El vendedor vende: el costo se guarda igual (antes quedaba en 0)
  await admin.from("products").update({ stock: 5 }).eq("id", P1.id);
  const r6 = await v.rpc("register_sale", { p_id: uuid(), p_lines: [line(P1.id, 2, 5)] });
  check(!r6.error && Number(r6.data?.sale?.cost_total) === 6, `venta del vendedor con costo real 6 → ${r6.data?.sale?.cost_total} ${r6.error?.message ?? ""}`);
  check(r6.data?.sale?.user_id === V.id, "la venta queda firmada por el vendedor");

  // 6) Otro negocio no puede vender mis productos
  const r7 = await b.rpc("register_sale", { p_id: uuid(), p_lines: [line(P1.id, 1, 5)] });
  check(!!r7.error, `otro negocio no vende mis productos → ${r7.error?.message}`);
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const r8 = await anon.rpc("register_sale", { p_id: uuid(), p_lines: [line(P1.id, 1, 5)] });
  check(!!r8.error, "sin sesión no se puede vender");

  // 7) Ajustes de stock idempotentes
  const mid = uuid();
  const e1 = await a.rpc("adjust_stock", { p_id: mid, p_product: P1.id, p_variant: null, p_delta: 5, p_tipo: "entrada", p_motivo: "escáner" });
  const e2 = await a.rpc("adjust_stock", { p_id: mid, p_product: P1.id, p_variant: null, p_delta: 5, p_tipo: "entrada", p_motivo: "escáner" });
  check(!e1.error && e2.data?.repeated && (await stockOf(P1.id)) === 8, `entrada +5 repetida cuenta una vez → ${await stockOf(P1.id)} ${e1.error?.message ?? ""}`);
  const e3 = await a.rpc("adjust_stock", { p_id: uuid(), p_product: P1.id, p_variant: null, p_delta: 2, p_tipo: "salida" });
  check(!!e3.error, "un retiro con cantidad positiva se rechaza");
  const e4 = await a.rpc("adjust_stock", { p_id: uuid(), p_product: P1.id, p_variant: null, p_delta: 1, p_tipo: "venta" });
  check(!!e4.error, "una venta no entra por adjust_stock");

  // 8) Fijar stock a mano
  const s1 = await a.rpc("set_stock", { p_id: uuid(), p_product: P1.id, p_variant: null, p_value: 2, p_motivo: "corrección" });
  const { data: mvs } = await admin.from("stock_movements").select("tipo,cantidad,motivo").eq("id", s1.data?.movement_id ?? -1).maybeSingle();
  check(!s1.error && (await stockOf(P1.id)) === 2 && s1.data?.changed === true, `fijar stock en 2 → ${await stockOf(P1.id)} ${s1.error?.message ?? ""}`);
  check(mvs?.tipo === "ajuste" && mvs?.cantidad === 6 && mvs?.motivo === "−6 · corrección", `ajuste anotado (8 → 2) → ${mvs?.tipo} ${mvs?.motivo}`);

  // 9) Compra: stock, costo e historial de precios automático
  const pu = await a.rpc("register_purchase", { p_id: uuid(), p_supplier: null, p_doc: "F-1", p_note: null, p_lines: [{ product_id: P1.id, variant_id: null, qty: 10, unit_cost: 4, expires_at: "2027-01-31" }] });
  const { data: p1 } = await admin.from("products").select("stock,precio_compra,expires_at,data").eq("id", P1.id).single();
  check(!pu.error && Number(p1.stock) === 12 && Number(p1.precio_compra) === 4 && p1.expires_at === "2027-01-31", `compra: stock 12, costo 4, vence → ${p1.stock}/${p1.precio_compra}/${p1.expires_at} ${pu.error?.message ?? ""}`);
  check(p1.data.precio_compra === 4, `el costo también queda en data → ${p1.data.precio_compra}`);
  const { data: ph } = await admin.from("price_history").select("field,old_value,new_value,source").eq("product_id", P1.id).order("created_at");
  check(ph?.some((h) => h.field === "precio_compra" && Number(h.new_value) === 4 && h.source === "compra"), "historial: costo 3 → 4 por compra");

  // 10) Precios en lote
  const sp = await a.rpc("set_prices", { p_rows: [{ product_id: P1.id, field: "precio", value: 6 }], p_source: "masivo" });
  const { data: ph2 } = await admin.from("price_history").select("source").eq("product_id", P1.id).eq("field", "precio");
  check(sp.data === 1 && ph2?.some((h) => h.source === "masivo"), `precio 5 → 6 con historial «masivo» (${sp.data}) ${sp.error?.message ?? ""}`);

  // 11) Guardar el formulario sin la clave de stock no pisa el stock
  const { error: fe } = await a.from("products").update({ data: { nombre: "Gaseosa 2 litros", precio: 6, precio_compra: 4 } }).eq("id", P1.id);
  const { data: p1b } = await admin.from("products").select("stock,data,nombre").eq("id", P1.id).single();
  check(!fe && Number(p1b.stock) === 12 && p1b.data.stock === 12 && p1b.nombre === "Gaseosa 2 litros", `formulario sin stock conserva 12 → ${p1b.stock}/${p1b.data.stock} ${fe?.message ?? ""}`);

  // 12) Consignación: entregar 5, rendir 3 vendidas + 1 devuelta
  const { data: cust } = await a.from("customers").insert({ user_id: A.id, name: "Juanito" }).select().single();
  const co = await a.rpc("consign_out", { p_id: uuid(), p_customer: cust.id, p_lines: [line(P1.id, 5, 6)] });
  check(!co.error && (await stockOf(P1.id)) === 7, `entregar 5 → stock 7 ${co.error?.message ?? ""}`);
  const { data: citem } = await admin.from("consignment_items").select("id").eq("consignment_id", co.data.consignment.id).single();
  const setId = uuid();
  const st = await a.rpc("consign_settle", { p_id: setId, p_consignment: co.data.consignment.id, p_rows: [{ item_id: citem.id, sold: 3, returned: 1 }], p_pay: "fiado", p_method: "efectivo" });
  check(!st.error && (await stockOf(P1.id)) === 8 && st.data?.remaining === 1, `rendir 3 vendidas + 1 devuelta → stock 8, quedan 1 ${st.error?.message ?? ""}`);
  check(Number(st.data?.sale?.total) === 18 && st.data?.sale?.status === "fiado", `venta de la consignación Bs 18 fiada → ${st.data?.sale?.total}`);
  const { count: ventaMovs } = await admin.from("stock_movements").select("id", { count: "exact", head: true }).eq("sale_id", st.data?.sale?.id);
  check(ventaMovs === 0, `sin doble salida: la venta de la consignación no mueve stock (${ventaMovs} movimientos)`);
  const st2 = await a.rpc("consign_settle", { p_id: setId, p_consignment: co.data.consignment.id, p_rows: [{ item_id: citem.id, sold: 3, returned: 1 }], p_pay: "fiado", p_method: "efectivo" });
  check(st2.data?.repeated === true && (await stockOf(P1.id)) === 8, "rendir cuentas repetido no se aplica dos veces");
  const st3 = await a.rpc("consign_settle", { p_id: uuid(), p_consignment: co.data.consignment.id, p_rows: [{ item_id: citem.id, sold: 2, returned: 0 }], p_pay: "pagado", p_method: "efectivo" });
  check(!!st3.error, "no se puede rendir más de lo pendiente");

  // 13) Conteo físico: deja el stock en lo contado
  const cid = uuid();
  const ac = await a.rpc("apply_count", { p_id: cid, p_category: null, p_category_name: "Bebidas", p_rows: [{ product_id: P1.id, variant_id: null, expected: 8, counted: 20, reason: "llegó sin anotar" }] });
  const ac2 = await a.rpc("apply_count", { p_id: cid, p_category: null, p_category_name: "Bebidas", p_rows: [{ product_id: P1.id, variant_id: null, expected: 8, counted: 20 }] });
  const { data: adj } = await admin.from("stock_movements").select("motivo").eq("count_id", cid);
  check(!ac.error && (await stockOf(P1.id)) === 20 && ac2.data?.repeated && adj?.length === 1 && adj[0].motivo.startsWith("+12"), `conteo 20 (+12), repetido una vez → ${await stockOf(P1.id)} · ${adj?.[0]?.motivo} ${ac.error?.message ?? ""}`);
} catch (e) {
  failed++;
  console.error("ERROR", e);
} finally {
  for (const u of users) await admin.auth.admin.deleteUser(u.id);
}
console.log(failed ? `\n${failed} fallos` : "\nTodo OK");
process.exit(failed ? 1 : 0);
