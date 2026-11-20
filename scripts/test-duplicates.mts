/**
 * P4 (031): «posible duplicado» con la base (similar_products + reglas de lib/duplicates) y cupo de IA compartido
 * entre servidores (ai_quota_state). Crea un usuario temporal y lo borra al terminar. No consume IA.
 *   npm run test:duplicates
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal, requireEnv } from "./env.mjs";
loadEnvLocal();
requireEnv("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY");
const { findDuplicate, sizesOf } = await import("../lib/duplicates");
const { markExhausted, forgetLocalQuota, isExhaustedNow, loadSharedQuota } = await import("../lib/gemini/index");

let failed = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? "OK  " : "FAIL"} ${msg}`); if (!ok) failed++; };
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// 1) Reglas puras
check(Array.from(sizesOf("Coca Cola 2L")).join() === "2000ml" && Array.from(sizesOf("Coca-Cola 2 litros")).join() === "2000ml", "tamaños: «2L» y «2 litros» son lo mismo");
check(Array.from(sizesOf("Arroz 1kg")).join() === "1000g" && Array.from(sizesOf("Arroz 500 g")).join() === "500g", "tamaños: kg y g");

const email = `dup-${Date.now()}@example.com`, password = "Test123456!";
const { data: u, error: ue } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (ue || !u.user) { console.error(ue?.message); process.exit(1); }
try {
  const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password });
  const names = ["Coca-Cola 2 litros", "Coca Cola 500ml", "Arroz Grano de Oro 1kg", "Leche Gloria 1L", "Jabón Sedal", "Taza ceramica blanca 300 ml", "Galletas Oreo 6 unidades"];
  const { error: ie } = await c.from("products").insert(names.map((n) => ({ user_id: u.user!.id, status: "confirmed", data: { nombre: n, precio: 5, stock: 1 } })));
  check(!ie, `productos de prueba creados ${ie?.message ?? ""}`);
  await c.from("products").insert({ user_id: u.user.id, status: "confirmed", data: { nombre: "Lápiz HB", precio: 1, stock: 1, codigo_barras: "7790001112223" } });

  const probe = async (nombre: string, codigo: string | null = null) => {
    const { data, error } = await c.rpc("similar_products", { p_name: nombre, p_code: codigo, p_exclude: null, p_limit: 8 });
    if (error) throw error;
    return { cands: data ?? [], dup: findDuplicate(data ?? [], { nombre, marca: "", codigo }) };
  };
  const cases: [string, string | null, string | null][] = [
    ["Coca Cola 2L", null, "Coca-Cola 2 litros"],
    ["Taza de cerámica blanca", null, "Taza ceramica blanca 300 ml"],
    ["Galleta Oreo", null, "Galletas Oreo 6 unidades"],
    ["Arroz Grano de Oro 5kg", null, null], // otra presentación
    ["Leche Pil 1L", null, null], // otra marca
    ["Shampoo Sedal", null, null],
    ["Algo cualquiera", "7790001112223", "Lápiz HB"], // mismo código
  ];
  for (const [name, code, want] of cases) {
    const { cands, dup } = await probe(name, code);
    check((dup?.nombre ?? null) === want, `«${name}»${code ? ` (código ${code})` : ""} → ${dup ? `${dup.nombre} (${dup.motivo})` : "sin duplicado"} · ${cands.length} candidato(s)`);
  }
  const { data: many } = await c.rpc("similar_products", { p_name: "a", p_code: null, p_exclude: null, p_limit: 8 });
  check((many ?? []).length === 0, "nombre de menos de 3 letras no trae candidatos");
  // Otro negocio no ve los productos de este
  const email2 = `dup2-${Date.now()}@example.com`;
  const { data: u2 } = await admin.auth.admin.createUser({ email: email2, password, email_confirm: true });
  const c2 = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  await c2.auth.signInWithPassword({ email: email2, password });
  const { data: other } = await c2.rpc("similar_products", { p_name: "Coca Cola 2L", p_code: null, p_exclude: null, p_limit: 8 });
  check((other ?? []).length === 0, "otro negocio no recibe candidatos ajenos");
  await admin.auth.admin.deleteUser(u2!.user!.id);

  // 2) Cupo compartido: lo que una instancia aprende, otra lo sabe al leer la base
  const KEY = `test-p4-${Date.now()}`;
  await markExhausted(KEY, "modelo-x");
  const { data: row } = await admin.from("ai_quota_state").select("exhausted_until").eq("key_id", KEY).eq("model", "modelo-x").maybeSingle();
  check(!!row?.exhausted_until && Date.parse(row.exhausted_until) > Date.now(), `el modelo agotado queda anotado en la base hasta ${row?.exhausted_until ?? "—"}`);
  forgetLocalQuota();
  check(!isExhaustedNow(KEY, "modelo-x"), "otra instancia (memoria vacía) aún no lo sabe…");
  await loadSharedQuota(KEY, true);
  check(isExhaustedNow(KEY, "modelo-x"), "…y al leer la base lo evita sin volver a probarlo");
  const { data: leak, error: leakErr } = await c.from("ai_quota_state").select("*").limit(1);
  check(!!leakErr || (leak ?? []).length === 0, "una sesión de la app no puede leer el estado del cupo");
  await admin.from("ai_quota_state").delete().eq("key_id", KEY);
} catch (e) {
  failed++;
  console.error("ERROR", e);
} finally {
  await admin.auth.admin.deleteUser(u.user.id);
}
console.log(failed ? `\n${failed} fallo(s)` : "\nTodo OK");
process.exit(failed ? 1 : 0);
