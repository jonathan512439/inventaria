/**
 * Prueba de extremo a extremo: registro → categoría → foto → producto analizado → subcategoría → alta manual
 *   → variantes (ejes del catálogo, stock derivado) → escáner por variante → venta por variante.
 *   npm run test:e2e                 (contra http://localhost:3000)
 *   BASE_URL=https://inventaria.pages.dev npm run test:e2e
 * Crea un usuario temporal y lo elimina al terminar. Consume 1-2 peticiones de IA.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal, requireEnv } from "./env.mjs";
loadEnvLocal();
requireEnv("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY");
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

  // 9. Medidor
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
