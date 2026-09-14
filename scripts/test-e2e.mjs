/**
 * Prueba de extremo a extremo: registro → categoría → foto → producto analizado → subcategoría → alta manual.
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

  // 6. Medidor
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
