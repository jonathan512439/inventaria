/**
 * Prueba de extremo a extremo: registro → categoría → foto → producto analizado → subcategoría → alta manual
 *   → variantes (ejes del catálogo, stock derivado) → escáner por variante → venta por variante
 *   → duplicado detectado → foto de estante (detect) → clave de IA propia (BYOK)
 *   → control de stock (mínimo, papelera, compra, conteo) → ventas (tickets, ganancia, caja)
 *   → clientes (fiado, abono, consignación).
 *   npm run test:e2e                 (contra http://localhost:3000)
 *   BASE_URL=https://inventaria.pages.dev npm run test:e2e
 * Crea un usuario temporal y lo elimina al terminar. Consume 1-2 peticiones de IA.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal, requireEnv } from "./env.mjs";
loadEnvLocal();
requireEnv("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "GEMINI_API_KEY");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const email = `e2e-${Date.now()}@example.com`, password = "Test123456!";
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "✓" : "✗"} ${msg}`); if (!ok) failed++; };

const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (cErr) { console.error(cErr.message); process.exit(1); }
const uid = created.user.id;
try {
  const { data: sess } = await createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.signInWithPassword({ email, password });
  const ref = new URL(url).hostname.split(".")[0];
  const b64 = Buffer.from(JSON.stringify(sess.session)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const H = { cookie: `sb-${ref}-auth-token=base64-${b64}`, "Content-Type": "application/json" };

  // 1. Categoría preconfigurada + nombre rápido
  let r = await fetch(`${BASE}/api/setup`, { method: "POST", headers: H, body: JSON.stringify({ presets: ["limpieza"], plain_names: ["Regalos"], business_name: "E2E" }) });
  check(r.status === 200, `setup: ${r.status}`);
  const { data: cats } = await admin.from("categories").select("id,name,parent_id").eq("user_id", uid);
  check(cats.some((c) => c.name === "Limpieza y hogar" && !c.parent_id), "categoría 'Limpieza y hogar' creada con subcategorías: " + cats.filter((c) => c.parent_id).length);
  check(cats.some((c) => c.name === "Regalos"), "categoría rápida 'Regalos' creada");

  // 2. Foto → producto
  const form = new FormData();
  const id = crypto.randomUUID();
  form.append("image", new Blob([fs.readFileSync(path.join("scripts", "fixtures", "producto.jpg"))], { type: "image/jpeg" }), "p.jpg");
  form.append("product_id", id);
  r = await fetch(`${BASE}/api/analyze`, { method: "POST", body: form, headers: { cookie: H.cookie } });
  const j = await r.json();
  check(r.status === 201, `analyze: ${r.status} ${j.error ?? ""} (modelo ${j.product?.ai_meta?.modelo ?? "-"})`);
  check(!!j.product?.data?.nombre, `nombre reconocido: ${j.product?.data?.nombre ?? "(vacío)"}`);
  check(typeof j.product?.ai_meta?.etiqueta === "string" && j.product.ai_meta.etiqueta.length > 5, "etiqueta leída");
  // El valor por defecto se aplica cuando el producto tiene categoría (si la IA no la asignó, se aplica al abrirlo en Revisar)
  if (j.product?.category_id) check(j.product?.data?.stock === 1, "stock por defecto = 1 (categoría asignada por la IA)");
  else check(true, "sin categoría asignada por la IA: el stock por defecto se aplicará al elegirla en Revisar");

  // 3. Idempotencia
  r = await fetch(`${BASE}/api/analyze`, { method: "POST", body: form, headers: { cookie: H.cookie } });
  check(r.status === 200, "reenvío del mismo id devuelve el producto existente sin duplicar");

  // 4. Subcategoría automática dentro de Limpieza
  const top = cats.find((c) => c.name === "Limpieza y hogar");
  r = await fetch(`${BASE}/api/classify`, { method: "POST", headers: H, body: JSON.stringify({ product_id: id, category_id: top.id }) });
  const cl = await r.json();
  check(r.status === 200, `classify: ${r.status} → ${cl.subcategory ?? "categoría general"}`);

  // 5. Alta manual (inserción directa como hace la pantalla)
  const { error: insErr } = await admin.from("products").insert({ user_id: uid, category_id: cats.find((c) => c.name === "Regalos").id, status: "confirmed", data: { nombre: "Taza", precio: 12.5, stock: 3 }, ai_meta: {} });
  check(!insErr, "alta manual guardada con decimales (12.5)");

  // 6. Variantes: catálogo Ropa trae ejes; producto con variantes; stock derivado
  r = await fetch(`${BASE}/api/setup`, { method: "POST", headers: H, body: JSON.stringify({ presets: ["ropa"] }) });
  check(r.status === 200, `setup ropa: ${r.status}`);
  const { data: cats2 } = await admin.from("categories").select("id,name,parent_id").eq("user_id", uid);
  const ropa = cats2.find((c) => c.name === "Ropa" && !c.parent_id);
  const { data: axes } = await admin.from("variant_axes").select("key,label,options").eq("category_id", ropa.id).order("sort_order");
  check(axes?.length === 2 && axes[0].key === "talla" && axes[1].key === "color", `ejes de Ropa: ${axes?.map((a) => a.label).join(" + ")}`);
  const dama = cats2.find((c) => c.parent_id === ropa.id && c.name === "Dama");
  const { data: polera } = await admin.from("products").insert({ user_id: uid, category_id: dama.id, status: "confirmed", data: { nombre: "Polera básica", precio: 35, stock: 1 }, ai_meta: {} }).select().single();
  const { error: vErr } = await admin.from("product_variants").insert([
    { user_id: uid, product_id: polera.id, values: { talla: "S", color: "Rojo" }, label: "S · Rojo", stock: 3 },
    { user_id: uid, product_id: polera.id, values: { talla: "M", color: "Rojo" }, label: "M · Rojo", stock: 5, codigo_barras: "E2E-7791234567890" },
    { user_id: uid, product_id: polera.id, values: { talla: "L", color: "Azul" }, label: "L · Azul", stock: 0 },
  ]);
  check(!vErr, `variantes creadas ${vErr?.message ?? ""}`);
  const { data: p1 } = await admin.from("products").select("data").eq("id", polera.id).single();
  check(p1.data.stock === 8, `stock del producto = suma de variantes (8) → ${p1.data.stock}`);

  // 7. Escáner por variante: el código de la M roja encuentra producto + variante
  r = await fetch(`${BASE}/api/barcode?code=E2E-7791234567890`, { headers: H });
  const bc = await r.json();
  check(r.status === 200 && bc.found === "own" && bc.variant?.label === "M · Rojo" && bc.variants?.length === 3, `barcode variante: ${bc.found} → ${bc.variant?.label ?? "-"} (${bc.variants?.length ?? 0} variantes)`);
  // Código del producto (no de una variante) con variantes → devuelve la lista para elegir
  await admin.from("products").update({ data: { ...p1.data, codigo_barras: "E2E-PROD-1" } }).eq("id", polera.id);
  r = await fetch(`${BASE}/api/barcode?code=E2E-PROD-1`, { headers: H });
  const bc2 = await r.json();
  check(r.status === 200 && bc2.found === "own" && bc2.variant === null && bc2.variants?.length === 3, "barcode del producto con variantes → pide elegir variante");
  // Código desconocido → catálogos públicos o nada, nunca error
  r = await fetch(`${BASE}/api/barcode?code=0000000000000`, { headers: H });
  const bc3 = await r.json();
  check(r.status === 200 && (bc3.found === "none" || bc3.found === "public"), `barcode desconocido: ${bc3.found}`);

  // 8. Venta por variante (como hace +/− Stock): stock de la variante baja, el total también, movimiento con variante
  const { data: mRoja } = await admin.from("product_variants").select("*").eq("product_id", polera.id).eq("label", "M · Rojo").single();
  await admin.from("product_variants").update({ stock: mRoja.stock - 2 }).eq("id", mRoja.id);
  await admin.from("stock_movements").insert({ user_id: uid, product_id: polera.id, product_name: "Polera básica", variant_id: mRoja.id, variant_label: mRoja.label, tipo: "venta", cantidad: 2, precio_unitario: 35, total: 70, stock_resultante: mRoja.stock - 2 });
  const { data: p2 } = await admin.from("products").select("data").eq("id", polera.id).single();
  check(p2.data.stock === 6, `venta de 2 M rojas → stock total 6 → ${p2.data.stock}`);
  const { data: mv } = await admin.from("stock_movements").select("variant_label,total").eq("product_id", polera.id);
  check(mv?.length === 1 && mv[0].variant_label === "M · Rojo" && Number(mv[0].total) === 70, "movimiento registrado con la variante y el total");
  // Escribir el stock a mano no pisa la suma
  await admin.from("products").update({ data: { ...p2.data, stock: 99 } }).eq("id", polera.id);
  const { data: p3 } = await admin.from("products").select("data").eq("id", polera.id).single();
  check(p3.data.stock === 6, "el stock manual no pisa la suma de variantes");
  // Producto sin variantes sigue editable a mano
  const { data: taza } = await admin.from("products").select("id,data").eq("user_id", uid).eq("data->>nombre", "Taza").single();
  await admin.from("products").update({ data: { ...taza.data, stock: 7 } }).eq("id", taza.id);
  const { data: taza2 } = await admin.from("products").select("data").eq("id", taza.id).single();
  check(taza2.data.stock === 7, "producto sin variantes: el stock se edita a mano como siempre");

  // 9. Duplicados: la misma foto con otro id → aviso "posible duplicado" (mismo nombre)
  const form2 = new FormData();
  const id2 = crypto.randomUUID();
  form2.append("image", new Blob([fs.readFileSync(path.join("scripts", "fixtures", "producto.jpg"))], { type: "image/jpeg" }), "p2.jpg");
  form2.append("product_id", id2);
  r = await fetch(`${BASE}/api/analyze`, { method: "POST", body: form2, headers: { cookie: H.cookie } });
  const j2 = await r.json();
  check(r.status === 201, `analyze (2.ª vez): ${r.status} ${j2.error ?? ""}`);
  check(!!j2.product?.ai_meta?.posible_duplicado?.product_id, `posible duplicado detectado: ${j2.product?.ai_meta?.posible_duplicado?.motivo ?? "(no)"} → «${j2.product?.ai_meta?.posible_duplicado?.nombre ?? ""}»`);

  // 10. Foto de estante: detección de productos (1 análisis, no crea nada)
  const form3 = new FormData();
  form3.append("image", new Blob([fs.readFileSync(path.join("scripts", "fixtures", "producto.jpg"))], { type: "image/jpeg" }), "estante.jpg");
  r = await fetch(`${BASE}/api/detect`, { method: "POST", body: form3, headers: { cookie: H.cookie } });
  const det = await r.json();
  check(r.status === 200 && Array.isArray(det.items), `detect: ${r.status} → ${det.items?.length ?? 0} producto(s) (${det.items?.[0]?.nombre_visible ?? "-"})`);
  const { count: nProducts } = await admin.from("products").select("id", { count: "exact", head: true }).eq("user_id", uid);
  check(nProducts === 4, `detect no crea productos (siguen ${nProducts})`);

  // 11. Clave de IA propia (BYOK): inválida → 400; válida → guardada cifrada; análisis marcado con own_key; quitar
  r = await fetch(`${BASE}/api/ai-key`, { method: "POST", headers: H, body: JSON.stringify({ key: "CLAVE_NO_VALIDA_0000000000000000000" }) });
  check(r.status === 400, `clave inválida rechazada: ${r.status}`);
  r = await fetch(`${BASE}/api/ai-key`, { method: "POST", headers: H, body: JSON.stringify({ key: process.env.GEMINI_API_KEY }) });
  const k1 = await r.json();
  check(r.status === 200 && k1.last4, `clave válida guardada (…${k1.last4})`);
  const { data: krow } = await admin.from("ai_keys").select("key_ciphertext,last4").eq("user_id", uid).maybeSingle();
  check(!!krow && krow.key_ciphertext !== process.env.GEMINI_API_KEY && !krow.key_ciphertext.includes(krow.last4), "la clave se guarda cifrada (no en claro)");
  r = await fetch(`${BASE}/api/usage`, { headers: H });
  const u1 = await r.json();
  check(u1.ownKey === true && u1.totalToday === 0, `medidor con clave propia: ${u1.totalToday} análisis hoy (cupo propio)`);
  r = await fetch(`${BASE}/api/classify`, { method: "POST", headers: H, body: JSON.stringify({ product_id: id2, category_id: top.id }) });
  const { data: own } = await admin.from("ai_usage").select("own_key").eq("user_id", uid).eq("purpose", "classify").order("created_at", { ascending: false }).limit(1);
  check(r.status === 200 && (own?.length === 0 || own?.[0]?.own_key === true), "el consumo con clave propia no cuenta contra el cupo compartido");
  r = await fetch(`${BASE}/api/ai-key`, { method: "DELETE", headers: H });
  check(r.status === 200, "clave quitada");

  // 12. Control de stock: mínimo, papelera, compra
  await admin.from("products").update({ min_stock: 5 }).eq("id", taza.id); // stock 7 → no por reponer
  let { data: sTaza } = await admin.from("product_summaries").select("stock,min_stock").eq("id", taza.id).single();
  check(sTaza.min_stock === 5 && sTaza.stock === 7, `mínimo guardado (5) y stock 7 en la vista`);
  await admin.from("products").update({ deleted_at: new Date().toISOString() }).eq("id", taza.id);
  ({ data: sTaza } = await admin.from("product_summaries").select("id").eq("id", taza.id).maybeSingle());
  check(sTaza === null, "producto en la papelera desaparece del inventario (vista)");
  r = await fetch(`${BASE}/api/cleanup`, { headers: H });
  const cl2 = await r.json();
  check(r.status === 200 && cl2.counts?.trash === 1, `Ordenar y limpiar cuenta la papelera: ${cl2.counts?.trash}`);
  await admin.from("products").update({ deleted_at: null }).eq("id", taza.id);
  ({ data: sTaza } = await admin.from("product_summaries").select("id").eq("id", taza.id).maybeSingle());
  check(!!sTaza, "recuperado de la papelera vuelve al inventario");
  // Compra: proveedor + ítem → stock sube, costo se guarda, movimiento enlazado
  const { data: sup } = await admin.from("suppliers").insert({ user_id: uid, name: "Distribuidora E2E", phone: "70000000" }).select().single();
  const { data: pur } = await admin.from("purchases").insert({ user_id: uid, supplier_id: sup.id, supplier_name: sup.name, total: 30, items: 1 }).select().single();
  await admin.from("purchase_items").insert({ purchase_id: pur.id, user_id: uid, product_id: taza.id, product_name: "Taza", qty: 3, unit_cost: 10, expires_at: "2027-01-31" });
  const { data: tz } = await admin.from("products").select("data").eq("id", taza.id).single();
  await admin.from("products").update({ data: { ...tz.data, stock: 10, precio_compra: 10 }, expires_at: "2027-01-31" }).eq("id", taza.id);
  await admin.from("stock_movements").insert({ user_id: uid, product_id: taza.id, product_name: "Taza", tipo: "entrada", cantidad: 3, precio_unitario: 10, motivo: "compra · Distribuidora E2E", stock_resultante: 10, purchase_id: pur.id });
  const { data: mv2 } = await admin.from("stock_movements").select("purchase_id").eq("product_id", taza.id).eq("tipo", "entrada");
  ({ data: sTaza } = await admin.from("product_summaries").select("stock,precio_compra,expires_at").eq("id", taza.id).single());
  check(mv2?.[0]?.purchase_id === pur.id && sTaza.stock === 10 && Number(sTaza.precio_compra) === 10 && sTaza.expires_at === "2027-01-31", `compra registrada: stock 10, costo 10, vence 2027-01-31`);
  const { data: cnt } = await admin.from("stock_counts").insert({ user_id: uid, category_name: "Regalos", items: 1, differences: 1, diff_units: 2, closed_at: new Date().toISOString() }).select().single();
  const { error: cie } = await admin.from("stock_count_items").insert({ count_id: cnt.id, user_id: uid, product_id: taza.id, product_name: "Taza", expected: 10, counted: 8, reason: "Merma o rotura" });
  check(!cie, "acta de conteo con diferencia guardada");

  // 13. Ventas: ticket con número correlativo, líneas, ganancia real y cierre de caja
  const { data: v1 } = await admin.from("sales").insert({ user_id: uid, method: "efectivo", status: "pagado", subtotal: 25, discount: 0, total: 25, paid: 25, cost_total: 20, items: 1 }).select().single();
  const { data: v2 } = await admin.from("sales").insert({ user_id: uid, method: "qr", status: "parcial", customer_name: "Juanito", subtotal: 12.5, discount: 0, total: 12.5, paid: 5, cost_total: 0, items: 1 }).select().single();
  check(v1.number === 1 && v2.number === 2, `tickets numerados: N.º ${v1.number} y N.º ${v2.number}`);
  await admin.from("sale_items").insert([
    { sale_id: v1.id, user_id: uid, product_id: taza.id, product_name: "Taza", qty: 2, unit_price: 12.5, unit_cost: 10, line_total: 25 },
    { sale_id: v2.id, user_id: uid, product_id: taza.id, product_name: "Taza", qty: 1, unit_price: 12.5, unit_cost: null, line_total: 12.5 },
  ]);
  const { data: sold } = await admin.from("sales").select("total,cost_total,paid,status").eq("user_id", uid);
  const vendido = sold.reduce((x, y) => x + Number(y.total), 0);
  const ganancia = sold.reduce((x, y) => x + Number(y.total) - Number(y.cost_total), 0);
  const porCobrar = sold.filter((y) => y.status !== "pagado").reduce((x, y) => x + Number(y.total) - Number(y.paid), 0);
  check(vendido === 37.5 && ganancia === 17.5 && porCobrar === 7.5, `vendido Bs ${vendido} · ganancia real Bs ${ganancia} · por cobrar Bs ${porCobrar}`);
  await admin.from("stock_movements").insert({ user_id: uid, product_id: taza.id, product_name: "Taza", tipo: "venta", cantidad: 2, precio_unitario: 12.5, total: 25, stock_resultante: 8, sale_id: v1.id });
  const { data: mvs } = await admin.from("stock_movements").select("sale_id").eq("product_id", taza.id).eq("tipo", "venta");
  check(mvs.some((m) => m.sale_id === v1.id), "movimiento de stock enlazado al ticket");
  const today = new Date(); const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  await admin.from("cash_movements").insert({ user_id: uid, tipo: "retiro", amount: 5, note: "bolsas" });
  const { error: ce1 } = await admin.from("cash_closings").upsert({ user_id: uid, day, sales_count: 2, total_sales: 37.5, by_method: { efectivo: 25, qr: 5 }, cash_out: 5, expected_cash: 20, counted_cash: 20, difference: 0, profit: 17.5 }, { onConflict: "user_id,day" });
  const { error: ce2 } = await admin.from("cash_closings").upsert({ user_id: uid, day, sales_count: 2, total_sales: 37.5, by_method: { efectivo: 25, qr: 5 }, cash_out: 5, expected_cash: 20, counted_cash: 18, difference: -2, profit: 17.5 }, { onConflict: "user_id,day" });
  const { data: cls } = await admin.from("cash_closings").select("difference").eq("user_id", uid);
  check(!ce1 && !ce2 && cls.length === 1 && Number(cls[0].difference) === -2, "cierre de caja: uno por día, se actualiza al volver a cerrar");
  for (const path of ["/sell", "/cash", "/movements"]) {
    const rp = await fetch(`${BASE}${path}`, { headers: { cookie: H.cookie } });
    check(rp.status === 200, `${path} → ${rp.status}`);
  }

  // 14. Clientes: fiado ligado al cliente, abono FIFO, entrega en consignación
  const { data: cli } = await admin.from("customers").insert({ user_id: uid, name: "Juanito Pérez", phone: "70011122", credit_limit: 100 }).select().single();
  await admin.from("sales").update({ customer_id: cli.id, customer_name: cli.name }).eq("id", v2.id); // la venta parcial pasa a su nombre
  const { data: v3 } = await admin.from("sales").insert({ user_id: uid, customer_id: cli.id, customer_name: cli.name, method: "efectivo", status: "fiado", subtotal: 20, discount: 0, total: 20, paid: 0, cost_total: 10, items: 1 }).select().single();
  let { data: deudas } = await admin.from("sales").select("total,paid,status,created_at").eq("customer_id", cli.id).neq("status", "pagado").order("created_at");
  const deuda = deudas.reduce((x, y) => x + Number(y.total) - Number(y.paid), 0);
  check(deuda === 27.5, `Juanito debe Bs ${deuda} en ${deudas.length} tickets`);
  // Abono de 10 aplicado a lo más antiguo (v2 debía 7,5 → pagado; v3 recibe 2,5)
  let left = 10;
  for (const d of deudas) {
    const due = Number(d.total) - Number(d.paid);
    const pay = Math.min(due, left);
    const paid = Number(d.paid) + pay;
    await admin.from("sales").update({ paid, status: paid >= Number(d.total) ? "pagado" : "parcial" }).eq("customer_id", cli.id).eq("created_at", d.created_at);
    left -= pay;
    if (left <= 0) break;
  }
  await admin.from("payments").insert({ user_id: uid, customer_id: cli.id, amount: 10, method: "efectivo" });
  ({ data: deudas } = await admin.from("sales").select("id,total,paid,status").eq("customer_id", cli.id));
  const s2 = deudas.find((x) => x.id === v2.id), s3 = deudas.find((x) => x.id === v3.id);
  check(s2.status === "pagado" && Number(s3.paid) === 2.5 && s3.status === "parcial", `abono FIFO: N.º ${v2.number} pagado, N.º ${v3.number} cobrado 2,5 → debe ${Number(s3.total) - Number(s3.paid)}`);
  // Consignación: entregar 5 (stock baja), rendir 3 vendidas + 1 devuelta → 1 afuera
  const { data: con } = await admin.from("consignments").insert({ user_id: uid, customer_id: cli.id, customer_name: cli.name }).select().single();
  const { data: ci } = await admin.from("consignment_items").insert({ consignment_id: con.id, user_id: uid, product_id: taza.id, product_name: "Taza", qty_out: 5, unit_price: 12.5 }).select().single();
  await admin.from("consignment_items").update({ qty_sold: 3, qty_returned: 1 }).eq("id", ci.id);
  const { data: ci2 } = await admin.from("consignment_items").select("*").eq("id", ci.id).single();
  check(ci2.qty_out - ci2.qty_sold - ci2.qty_returned === 1, `consignación: entregó 5, vendió 3, devolvió 1 → ${ci2.qty_out - ci2.qty_sold - ci2.qty_returned} afuera`);
  await admin.from("stock_movements").insert({ user_id: uid, product_id: taza.id, product_name: "Taza", tipo: "salida", cantidad: 5, motivo: "entregado a Juanito Pérez", stock_resultante: 3, consignment_id: con.id });
  const { data: cm } = await admin.from("stock_movements").select("consignment_id").eq("consignment_id", con.id);
  check(cm.length === 1, "movimiento de stock enlazado a la entrega");
  for (const path of ["/customers", `/customers/detail?id=${cli.id}`, "/consign"]) {
    const rp = await fetch(`${BASE}${path}`, { headers: { cookie: H.cookie } });
    check(rp.status === 200, `${path.split("?")[0]} → ${rp.status}`);
  }

  // 15. Medidor
  r = await fetch(`${BASE}/api/usage`, { headers: H });
  const u = await r.json();
  check(r.status === 200 && Array.isArray(u.models) && u.models.length >= 3, `usage: ${u.models?.length} modelos, ${u.totalToday} análisis hoy`);
} catch (e) {
  console.error(e);
  failed++;
} finally {
  const { data } = await admin.storage.from("product-images").list(uid);
  if (data?.length) await admin.storage.from("product-images").remove(data.map((f) => `${uid}/${f.name}`));
  await admin.auth.admin.deleteUser(uid);
  console.log(failed ? `\n${failed} comprobación(es) fallida(s)` : "\nTodo OK");
  process.exit(failed ? 1 : 0);
}
