/**
 * Matriz de permisos (migración 024 · Fase 6.9 · C5.1): qué puede leer, crear, cambiar y borrar cada rol,
 * directamente contra Supabase con la clave anónima (como haría alguien con la app modificada).
 *   npm run test:access                      (solo base de datos)
 *   BASE_URL=https://… npm run test:access   (además, rutas API protegidas)
 * Crea usuarios temporales (dueño, vendedor, otro negocio y alguien con dos negocios) y los elimina al terminar.
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal, requireEnv } from "./env.mjs";
loadEnvLocal();
requireEnv("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY");
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const BASE = process.env.BASE_URL || null;
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
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
  const c = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email: u.email, password: PASS });
  if (error) throw error;
  u.session = data.session;
  return c;
}
const exists = async (table, id) => !!(await admin.from(table).select("id").eq("id", id).maybeSingle()).data;

const users = [];
try {
  const A = await tempUser("acc-dueno");
  const V = await tempUser("acc-vend");
  const B = await tempUser("acc-otro");
  const M = await tempUser("acc-multi");
  users.push(A, V, B, M);
  for (const u of [V, M]) await admin.from("business_members").insert({ business_id: A.bid, user_id: u.id, role: "vendedor", display_name: "Vend" });
  await admin.from("profiles").update({ current_business_id: A.bid }).eq("id", V.id);
  await admin.from("profiles").update({ current_business_id: A.bid }).eq("id", M.id);

  const ins = async (row) => (await admin.from("products").insert({ status: "confirmed", ...row }).select().single()).data;
  const P = await ins({ user_id: A.id, business_id: A.bid, data: { nombre: "Confirmado", precio: 10, stock: 5 } });
  const D = await ins({ user_id: A.id, business_id: A.bid, status: "draft", data: { nombre: "Pendiente" } });
  const PB = await ins({ user_id: B.id, business_id: B.bid, data: { nombre: "De otro negocio" } });
  const PM = await ins({ user_id: M.id, business_id: M.bid, data: { nombre: "Del negocio propio de M" } });
  const { data: sup } = await admin.from("suppliers").insert({ user_id: A.id, business_id: A.bid, name: "Proveedor" }).select().single();
  await admin.from("purchases").insert({ user_id: A.id, business_id: A.bid, supplier_id: sup.id, total: 10, items: 1 });
  const { data: cat } = await admin.from("categories").insert({ user_id: A.id, business_id: A.bid, name: "Bebidas" }).select().single();
  const { data: cust } = await admin.from("customers").insert({ user_id: A.id, business_id: A.bid, name: "Cliente" }).select().single();

  const a = await signIn(A);
  const v = await signIn(V);
  const m = await signIn(M);
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });

  // --- Lectura ---
  const { data: seen } = await v.from("products").select("id");
  const ids = new Set((seen ?? []).map((r) => r.id));
  check(ids.has(P.id) && ids.has(D.id) && !ids.has(PB.id), "el vendedor ve su negocio y no el de otro");
  const { data: anonSeen } = await anon.from("products").select("id").limit(1);
  check((anonSeen ?? []).length === 0, "sin sesión no se ve nada");
  const { data: vSup } = await v.from("suppliers").select("id");
  const { data: vPur } = await v.from("purchases").select("id");
  const { data: aPur } = await a.from("purchases").select("id");
  check((vSup ?? []).length === 0 && (vPur ?? []).length === 0 && (aPur ?? []).length === 1, "proveedores y compras: solo el dueño los ve");
  const { data: ctxV } = await v.rpc("session_context");
  check(ctxV?.role === "vendedor" && ctxV?.acting_role === "vendedor", `session_context del vendedor → ${ctxV?.role}/${ctxV?.acting_role}`);

  // --- Productos ---
  await v.from("products").delete().eq("id", P.id);
  check(await exists("products", P.id), "el vendedor no puede borrar un producto confirmado");
  await v.from("products").delete().eq("id", D.id);
  check(!(await exists("products", D.id)), "el vendedor sí puede descartar un pendiente");
  const { error: trash } = await v.from("products").update({ deleted_at: new Date().toISOString() }).eq("id", P.id);
  check(!!trash, "el vendedor no puede mandar a la papelera");
  const { error: stockCol } = await v.from("products").update({ stock: 99 }).eq("id", P.id);
  const { error: stockData } = await v.from("products").update({ data: { nombre: "Confirmado", precio: 10, stock: 99 } }).eq("id", P.id);
  const { error: stockOwner } = await a.from("products").update({ stock: 99 }).eq("id", P.id);
  check(!!stockCol && !!stockData && !!stockOwner, "nadie cambia el stock de un confirmado sin una operación (ni el dueño)");
  const { error: rename } = await v.from("products").update({ data: { nombre: "Confirmado 2", precio: 10 } }).eq("id", P.id);
  const { data: pAfter } = await admin.from("products").select("nombre,stock").eq("id", P.id).single();
  check(!rename && pAfter.nombre === "Confirmado 2" && Number(pAfter.stock) === 5, `el vendedor edita datos sin tocar el stock → ${pAfter.nombre} · ${pAfter.stock}`);
  const { error: vStock } = await v.from("product_variants").insert({ user_id: V.id, product_id: P.id, values: { talla: "S" }, label: "S", stock: 3 });
  check(!!vStock, "no se crea una variante con stock en un confirmado sin operación");
  const adj = await v.rpc("adjust_stock", { p_id: uuid(), p_product: P.id, p_variant: null, p_delta: 2, p_tipo: "entrada", p_motivo: "prueba" });
  check(!adj.error && Number(adj.data?.stock) === 7, `con la operación sí: entrada +2 → ${adj.data?.stock} ${adj.error?.message ?? ""}`);

  // --- Firma inmutable y negocio inmutable ---
  await a.from("products").update({ user_id: V.id, business_id: B.bid }).eq("id", P.id);
  const { data: pSig } = await admin.from("products").select("user_id,business_id").eq("id", P.id).single();
  check(pSig.user_id === A.id && pSig.business_id === A.bid, "no se cambia quién creó una fila ni a qué negocio pertenece");
  const { data: cV } = await v.from("customers").insert({ user_id: A.id, name: "Nuevo" }).select().single();
  check(cV?.user_id === V.id && cV?.business_id === A.bid, "al crear, la firma la pone la base (no lo que manda la app)");

  // --- Ventas, cobros y movimientos: solo por funciones ---
  const sale = await a.rpc("register_sale", { p_id: uuid(), p_lines: [{ product_id: P.id, variant_id: null, qty: 1, unit_price: 10 }] });
  const { error: sIns } = await v.from("sales").insert({ total: 1, paid: 1, items: 1, method: "efectivo", status: "pagado" });
  await v.from("sales").update({ total: 0 }).eq("id", sale.data.sale.id);
  await a.from("sales").delete().eq("id", sale.data.sale.id);
  const { data: sAfter } = await admin.from("sales").select("total").eq("id", sale.data.sale.id).single();
  check(!!sIns && Number(sAfter?.total) === 10, "ventas: nadie las crea, cambia ni borra fuera de las funciones");
  const { error: mvIns } = await v.from("stock_movements").insert({ product_id: P.id, tipo: "entrada", cantidad: 1 });
  const { error: payIns } = await v.from("payments").insert({ customer_id: cust.id, amount: 5, method: "efectivo" });
  check(!!mvIns && !!payIns, "movimientos y cobros no se escriben directo");
  const pur = await v.rpc("register_purchase", { p_id: uuid(), p_supplier: null, p_doc: null, p_note: null, p_lines: [{ product_id: P.id, variant_id: null, qty: 1, unit_cost: 1, expires_at: null }] });
  const pri = await v.rpc("set_prices", { p_rows: [{ product_id: P.id, field: "precio", value: 1 }], p_source: "masivo" });
  check(!!pur.error && !!pri.error, `compras y precios en lote: solo el dueño → ${pur.error?.message} / ${pri.error?.message}`);

  // --- Catálogo y clientes ---
  const { error: catIns } = await v.from("categories").insert({ name: "Nueva del vendedor" });
  await v.from("categories").update({ name: "Renombrada" }).eq("id", cat.id);
  await v.from("categories").delete().eq("id", cat.id);
  const { data: catAfter } = await admin.from("categories").select("name").eq("id", cat.id).maybeSingle();
  const { error: ftIns } = await v.from("field_templates").insert({ name: "talla_x", field_type: "text" });
  check(!catIns && catAfter?.name === "Bebidas" && !!ftIns, "el vendedor crea categorías pero no las renombra ni borra, ni crea datos");
  const { error: custDel } = await v.from("customers").update({ deleted_at: new Date().toISOString() }).eq("id", cust.id);
  await v.from("customers").delete().eq("id", cust.id);
  check(!!custDel && (await exists("customers", cust.id)), "el vendedor no quita clientes");

  // --- Negocio y equipo ---
  await v.from("businesses").update({ name: "Hackeado" }).eq("id", A.bid);
  const { error: planErr } = await a.from("businesses").update({ plan: "negocio" }).eq("id", A.bid);
  const { data: bz } = await admin.from("businesses").select("name,plan").eq("id", A.bid).single();
  check(bz.name !== "Hackeado" && !!planErr && bz.plan === "gratis", `nadie cambia el plan; el vendedor no renombra → ${bz.name} · ${bz.plan}`);
  const { error: lastOwner } = await a.from("business_members").update({ role: "vendedor" }).eq("business_id", A.bid).eq("user_id", A.id);
  check(!!lastOwner, "el único dueño no puede quitarse el rol");

  // --- Negocio activo (alguien en dos negocios) ---
  const seenIds = async (c) => new Set(((await c.from("products").select("id")).data ?? []).map((r) => r.id));
  let mIds = await seenIds(m);
  check(mIds.has(P.id) && !mIds.has(PM.id), "con el negocio A activo, M no ve los productos de su otro negocio");
  const { data: list } = await m.rpc("my_businesses");
  const sw = await m.rpc("switch_business", { p_business: M.bid });
  mIds = await seenIds(m);
  check((list ?? []).length === 2 && !sw.error && mIds.has(PM.id) && !mIds.has(P.id), "al cambiar de negocio ve solo el nuevo");
  const swBad = await m.rpc("switch_business", { p_business: B.bid });
  check(!!swBad.error, "no puede cambiarse a un negocio ajeno");

  // --- Respaldos: solo el dueño ---
  const path = `${A.bid}/2099-01-01-manual.xlsx`;
  const { error: upErr } = await a.storage.from("backups").upload(path, new Blob([new Uint8Array([80, 75, 3, 4])], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", upsert: true });
  const { data: vDl } = await v.storage.from("backups").download(path);
  const { data: aDl } = await a.storage.from("backups").download(path);
  check(!upErr && !vDl && !!aDl, `respaldos: el dueño descarga, el vendedor no ${upErr?.message ?? ""}`);
  await admin.storage.from("backups").remove([path]);

  // --- Costos (025): el vendedor no los recibe en ninguna lectura ---
  await a.from("products").update({ data: { nombre: "Confirmado 2", precio: 10, precio_compra: 6 } }).eq("id", P.id);
  await v.from("products").update({ data: { nombre: "Confirmado 2", precio: 10, precio_compra: 1 } }).eq("id", P.id);
  const { data: pcost } = await admin.from("product_costs").select("cost").eq("product_id", P.id).is("variant_id", null).maybeSingle();
  const { data: pRaw } = await admin.from("products").select("data").eq("id", P.id).single();
  check(Number(pcost?.cost) === 6 && !("precio_compra" in pRaw.data), `el dueño fija el costo desde el formulario; el del vendedor se descarta; data queda sin costo → ${pcost?.cost}`);
  const { data: vProd } = await v.from("products").select("*").eq("id", P.id).single();
  const { data: vSum } = await v.from("product_summaries").select("precio_compra").eq("id", P.id).single();
  const { data: aSum } = await a.from("product_summaries").select("precio_compra").eq("id", P.id).single();
  check(!("precio_compra" in (vProd?.data ?? {})) && !("precio_compra" in (vProd ?? {})) && vSum?.precio_compra === null && Number(aSum?.precio_compra) === 6, "producto y vista: costo solo para el dueño");
  const vCosts = await Promise.all(["product_costs", "sale_costs", "sale_item_costs", "cash_closing_profits"].map(async (t) => ((await v.from(t).select("*")).data ?? []).length));
  check(vCosts.every((n) => n === 0), `tablas de costos: el vendedor no lee nada → ${vCosts.join(",")}`);
  const { data: vSale } = await v.from("sales_v").select("cost_total").eq("id", sale.data.sale.id).single();
  const { data: aSale } = await a.from("sales_v").select("cost_total").eq("id", sale.data.sale.id).single();
  const { data: vItems } = await v.from("sale_items_v").select("unit_cost").eq("sale_id", sale.data.sale.id);
  const { data: vRawSale } = await v.from("sales").select("*").eq("id", sale.data.sale.id).single();
  check(vSale?.cost_total === null && aSale?.cost_total !== null && (vItems ?? []).every((i) => i.unit_cost === null) && !("cost_total" in (vRawSale ?? {})), "ventas y líneas: costo solo para el dueño");
  const { data: vHist } = await v.from("price_history").select("field").eq("product_id", P.id).eq("field", "precio_compra");
  const { data: aHist } = await a.from("price_history").select("field").eq("product_id", P.id).eq("field", "precio_compra");
  check((vHist ?? []).length === 0 && (aHist ?? []).length >= 1, `historial del costo: solo el dueño (${(aHist ?? []).length})`);
  const cl = await a.rpc("close_cash", { p_id: uuid(), p_day: null, p_counted: null, p_note: null });
  const { data: vCl } = await v.from("cash_closings_v").select("profit").eq("id", cl.data?.id).single();
  const { data: aCl } = await a.from("cash_closings_v").select("profit").eq("id", cl.data?.id).single();
  check(!cl.error && vCl?.profit === null && aCl?.profit !== null, `cierres: la ganancia solo para el dueño ${cl.error?.message ?? ""}`);
  const { data: vMov } = await v.from("stock_movements").select("precio_unitario").eq("product_id", P.id).not("purchase_id", "is", null);
  check((vMov ?? []).every((m) => m.precio_unitario === null), "las entradas por compra no muestran el costo en Movimientos");

  // --- Fotos privadas (026) ---
  const b = await signIn(B);
  const photoPath = `${A.id}/prueba-${Date.now()}.jpg`;
  const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });
  const { error: phUp } = await a.storage.from("product-images").upload(photoPath, jpeg, { contentType: "image/jpeg" });
  const publicUrl = admin.storage.from("product-images").getPublicUrl(photoPath).data.publicUrl;
  const anonFetch = await fetch(publicUrl);
  const { data: vSigned } = await v.storage.from("product-images").createSignedUrl(photoPath, 60);
  const { data: bSigned } = await b.storage.from("product-images").createSignedUrl(photoPath, 60);
  const vFetch = vSigned?.signedUrl ? await fetch(vSigned.signedUrl) : null;
  check(!phUp && !anonFetch.ok && vFetch?.ok === true && !bSigned?.signedUrl, `fotos: sin enlace firmado no se ven; el equipo sí; otro negocio no → público ${anonFetch.status}, equipo ${vFetch?.status}, otro ${bSigned?.signedUrl ? "sí" : "no"} ${phUp?.message ?? ""}`);
  await admin.storage.from("product-images").remove([photoPath]);

  // --- Rutas API protegidas (opcional) ---
  if (BASE) {
    const ref = new URL(URL_).hostname.split(".")[0];
    const cookieOf = (u) => `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(u.session)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
    const H = (u) => ({ cookie: cookieOf(u), "Content-Type": "application/json" });
    const cl = await fetch(`${BASE}/api/cleanup`, { method: "POST", headers: H(V), body: JSON.stringify({ actions: ["emptyTrash"] }) });
    const clGet = await fetch(`${BASE}/api/cleanup`, { headers: H(V) });
    check(cl.status === 403 && clGet.status === 403, `Ordenar y limpiar: el vendedor recibe 403 → ${cl.status}/${clGet.status}`);
    const us = await fetch(`${BASE}/api/usage`, { method: "POST", headers: H(V), body: JSON.stringify({ model: "gemini-3.6-flash", used: 999 }) });
    check(us.status === 403, `ajustar el consumo de IA sin clave propia → ${us.status}`);
    const clA = await fetch(`${BASE}/api/cleanup`, { headers: H(A) });
    check(clA.status === 200, `el dueño sí entra a Ordenar y limpiar → ${clA.status}`);
  }
} catch (e) {
  failed++;
  console.error("ERROR", e);
} finally {
  for (const u of users) await admin.auth.admin.deleteUser(u.id);
}
console.log(failed ? `\n${failed} fallos` : "\nTodo OK");
process.exit(failed ? 1 : 0);
