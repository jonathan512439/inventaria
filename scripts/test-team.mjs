/**
 * Prueba del negocio con varios usuarios (Fase 6): negocio automático al registrarse, invitación,
 * acceso compartido por RLS, firma con x-actor, PIN y ocultación de costos al vendedor.
 *   npm run test:team
 * Crea dos usuarios temporales y los elimina al terminar. No consume IA.
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal, requireEnv } from "./env.mjs";
loadEnvLocal();
requireEnv("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "OK  " : "FAIL"} ${msg}`); if (!ok) failed++; };
const mk = async (tag) => {
  const email = `${tag}-${Date.now()}@example.com`, password = "Test123456!";
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const c = createClient(url, anon, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password });
  return { id: data.user.id, c, email };
};
const owner = await mk("duena");
const seller = await mk("vendedor");
try {
  // 1) Negocio automático al registrarse
  const { data: bid } = await owner.c.rpc("current_business_id");
  check(!!bid, "al registrarse se crea un negocio propio");
  const { data: mem } = await owner.c.from("business_members").select("role").eq("business_id", bid).eq("user_id", owner.id).single();
  check(mem.role === "dueno", "el creador es dueño");

  // 2) Datos del dueño (business_id lo rellena la base)
  const { data: cat } = await owner.c.from("categories").insert({ user_id: owner.id, name: "Abarrotes", parent_id: null }).select().single();
  const { data: prod } = await owner.c.from("products").insert({ user_id: owner.id, category_id: cat.id, status: "confirmed", data: { nombre: "Arroz", precio: 8, precio_compra: 6, stock: 10 }, ai_meta: {} }).select().single();
  check(prod.business_id === bid, "el producto queda en el negocio sin que la app lo envíe");

  // 3) El vendedor aún no ve nada
  let { data: before } = await seller.c.from("products").select("id");
  check(before.length === 0, "otro usuario no ve el inventario ajeno");

  // 4) Invitación → aceptar
  const { data: inv } = await owner.c.from("invites").insert({ business_id: bid, code: "TEST" + Math.random().toString(36).slice(2, 4).toUpperCase(), role: "vendedor", created_by: owner.id }).select().single();
  const { data: joined, error: je } = await seller.c.rpc("accept_invite", { p_code: inv.code, p_display_name: "Pedro" });
  check(!je && joined === bid, `vendedor acepta la invitación ${inv.code}`);
  const { error: again } = await seller.c.rpc("accept_invite", { p_code: inv.code });
  check(!!again, "el código no vale dos veces");
  // R1 (029): al unirse, su «Mi negocio» vacío (creado solo al registrarse) desaparece
  const { data: sellerBiz } = await admin.from("business_members").select("business_id,role").eq("user_id", seller.id);
  check(sellerBiz.length === 1 && sellerBiz[0].business_id === bid && sellerBiz[0].role === "vendedor", `al unirse, su negocio propio vacío se quita → ${sellerBiz.length} negocio(s)`);
  // R1 (029): crear la cuenta CON el código (enlace de invitación) → entra directo como vendedor, sin negocio propio
  const { data: inv2 } = await owner.c.from("invites").insert({ business_id: bid, code: "TEST" + Math.random().toString(36).slice(2, 4).toUpperCase(), role: "vendedor", created_by: owner.id }).select().single();
  const { data: nu, error: nue } = await admin.auth.admin.createUser({ email: `invitado-${Date.now()}@example.com`, password: "Test123456!", email_confirm: true, user_metadata: { invite_code: inv2.code } });
  const { data: nuBiz } = await admin.from("business_members").select("business_id,role").eq("user_id", nu?.user?.id);
  const { data: nuOwn } = await admin.from("businesses").select("id").eq("owner_id", nu?.user?.id);
  check(!nue && nuBiz?.length === 1 && nuBiz[0].business_id === bid && nuBiz[0].role === "vendedor" && nuOwn?.length === 0, `registro con código: 1 negocio (vendedor) y ninguno propio → ${nuBiz?.length} / ${nuOwn?.length} ${nue?.message ?? ""}`);
  const { data: nu2 } = await admin.auth.admin.createUser({ email: `codigo-malo-${Date.now()}@example.com`, password: "Test123456!", email_confirm: true, user_metadata: { invite_code: inv2.code } });
  const { data: nu2Own } = await admin.from("businesses").select("id").eq("owner_id", nu2?.user?.id);
  check(nu2Own?.length === 1, "con un código ya usado, la cuenta se crea igual con su negocio propio");
  // Un negocio propio CON datos no se borra al unirse a otro
  const { data: inv3 } = await owner.c.from("invites").insert({ business_id: bid, code: "TEST" + Math.random().toString(36).slice(2, 4).toUpperCase(), role: "vendedor", created_by: owner.id }).select().single();
  const nu2c = createClient(url, anon, { auth: { persistSession: false } });
  await nu2c.auth.signInWithPassword({ email: nu2.user.email, password: "Test123456!" });
  await nu2c.from("customers").insert({ name: "Cliente propio" });
  await nu2c.rpc("accept_invite", { p_code: inv3.code });
  const { data: nu2Still } = await admin.from("businesses").select("id").eq("owner_id", nu2.user.id);
  check(nu2Still?.length === 1, "un negocio propio con datos (un cliente) se conserva al unirse a otro");
  await admin.auth.admin.deleteUser(nu.user.id);
  await admin.auth.admin.deleteUser(nu2.user.id);

  // 5) Ahora comparte el inventario (RLS por negocio) y no ve el costo
  const { data: after } = await seller.c.from("products").select("id,data");
  check(after.length === 1, "el vendedor ve el inventario del negocio");
  const { data: sum } = await seller.c.from("product_summaries").select("precio,precio_compra").eq("id", prod.id).single();
  check(Number(sum.precio) === 8 && sum.precio_compra === null, `en la vista el vendedor ve precio ${sum.precio} y costo ${sum.precio_compra}`);
  const { data: sumO } = await owner.c.from("product_summaries").select("precio_compra").eq("id", prod.id).single();
  check(Number(sumO.precio_compra) === 6, "el dueño sí ve el costo");

  // 6) Venta del vendedor: queda en el negocio y firmada por él
  // Desde 021 la venta entra solo por register_sale; desde 024 la firma la pone la base
  const { data: saleOut, error: saleErr } = await seller.c.rpc("register_sale", { p_id: crypto.randomUUID(), p_lines: [{ product_id: prod.id, variant_id: null, qty: 1, unit_price: 8 }] });
  if (saleErr) console.error(saleErr.message);
  const sale = saleOut?.sale ?? {};
  const { error: directSale } = await seller.c.from("sales").insert({ user_id: seller.id, method: "efectivo", status: "pagado", total: 8, paid: 8, items: 1 });
  check(!!directSale, "una venta no se puede escribir directo en la tabla (solo con register_sale)");
  check(sale.business_id === bid && sale.user_id === seller.id && sale.number === 1, `venta N.º ${sale.number} del negocio, firmada por el vendedor`);
  const { data: ownerSees } = await owner.c.from("sales").select("id").eq("id", sale.id);
  check(ownerSees.length === 1, "el dueño ve la venta del vendedor");

  // 7) PIN: fijar y verificar; firma con cabecera x-actor
  const { error: pe } = await seller.c.rpc("set_pin", { p_business: bid, p_pin: "1234" });
  const { data: mrow } = await owner.c.from("business_members").select("*").eq("business_id", bid).eq("user_id", seller.id).single();
  check(!pe && mrow.has_pin === true && !("pin_hash" in mrow), "vendedor guarda su PIN y el hash no viaja al cliente");
  const { data: pins, error: pinsErr } = await owner.c.from("member_pins").select("*");
  check((pins ?? []).length === 0 || !!pinsErr, "la tabla de PIN no se puede leer desde la app");
  const { data: okPin } = await owner.c.rpc("verify_pin", { p_business: bid, p_user: seller.id, p_pin: "1234" });
  const { data: badPin } = await owner.c.rpc("verify_pin", { p_business: bid, p_user: seller.id, p_pin: "0000" });
  check(okPin === true && badPin === false, "PIN correcto pasa, PIN incorrecto no");
  // 024: en el celular del dueño, el vendedor entra con su PIN → token firmado (x-actor-token)
  const { data: token } = await owner.c.rpc("start_shift", { p_business: bid, p_user: seller.id, p_pin: "1234" });
  const { data: noToken } = await owner.c.rpc("start_shift", { p_business: bid, p_user: seller.id, p_pin: "0000" });
  check(typeof token === "string" && token.split(".").length === 4 && noToken === null, "PIN correcto da un token de turno; PIN incorrecto no");
  const withHeader = async (h) => {
    const c = createClient(url, anon, { auth: { persistSession: false }, global: { headers: h } });
    await c.auth.signInWithPassword({ email: owner.email, password: "Test123456!" });
    return c;
  };
  const asActor = await withHeader({ "x-actor-token": token });
  const { data: signed } = await asActor.from("customers").insert({ user_id: owner.id, name: "Cliente del turno" }).select().single();
  check(signed?.user_id === seller.id, "con el token la fila queda firmada por quien atiende");
  const { error: delAsSeller } = await asActor.from("products").update({ deleted_at: new Date().toISOString() }).eq("id", prod.id);
  check(!!delAsSeller, "con el token el celular del dueño actúa como vendedor (no puede mandar a la papelera)");
  const oldHeader = await withHeader({ "x-actor": seller.id });
  const { data: notSigned } = await oldHeader.from("customers").insert({ user_id: seller.id, name: "Sin token" }).select().single();
  check(notSigned?.user_id === owner.id, "la cabecera antigua x-actor (uuid suelto) se ignora");
  const forged = await withHeader({ "x-actor-token": token.replace(/.$/, (c) => (c === "0" ? "1" : "0")) });
  const { data: forgedRow } = await forged.from("customers").insert({ user_id: seller.id, name: "Token falso" }).select().single();
  check(forgedRow?.user_id === owner.id, "un token alterado se ignora");

  // 8) Solo el dueño administra miembros
  const { error: se } = await seller.c.from("business_members").update({ role: "dueno" }).eq("business_id", bid).eq("user_id", seller.id);
  const { data: still } = await owner.c.from("business_members").select("role").eq("business_id", bid).eq("user_id", seller.id).single();
  check(still.role === "vendedor", `el vendedor no puede hacerse dueño ${se ? "(rechazado)" : "(sin efecto)"}`);
  const { error: de } = await owner.c.from("business_members").update({ active: false }).eq("business_id", bid).eq("user_id", seller.id);
  const { data: gone } = await seller.c.from("products").select("id");
  check(!de && gone.length === 0, "al quitarlo, el vendedor deja de ver el negocio");
} catch (e) {
  console.error(e);
  failed++;
} finally {
  await admin.auth.admin.deleteUser(seller.id);
  await admin.auth.admin.deleteUser(owner.id);
}
console.log(failed ? `\n${failed} fallo(s)` : "\nTodo OK");
process.exit(failed ? 1 : 0);
