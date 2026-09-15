/**
 * Prueba del respaldo: genera el respaldo de un negocio (npm run backup), lo descarga del bucket privado
 * y comprueba que las hojas existen con filas. Además verifica que la clave anónima NO puede leer el bucket.
 *   npm run test:backup
 */
import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { loadEnvLocal, requireEnv } from "./env.mjs";
loadEnvLocal();
requireEnv("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "OK  " : "FAIL"} ${msg}`); if (!ok) failed++; };

// El negocio con más productos, para que la prueba tenga datos reales
const { data: bizs } = await admin.from("businesses").select("id,name");
const withCounts = await Promise.all((bizs ?? []).map(async (b) => ({ ...b, n: (await admin.from("products").select("id", { count: "exact", head: true }).eq("business_id", b.id)).count ?? 0 })));
const biz = withCounts.sort((a, b) => b.n - a.n)[0];
execSync(`npx tsx scripts/backup.mts ${biz.id}`, { stdio: "inherit" });
const { data: files } = await admin.storage.from("backups").list(biz.id);
check((files ?? []).length >= 1, `hay ${files?.length ?? 0} respaldo(s) de «${biz.name}»`);
const latest = (files ?? []).map((f) => f.name).sort().at(-1);
const { data: blob, error } = await admin.storage.from("backups").download(`${biz.id}/${latest}`);
check(!error && blob, `se descarga ${latest}`);
const wb = XLSX.read(Buffer.from(await blob.arrayBuffer()));
for (const n of ["Respaldo", "Inventario", "Ventas", "Clientes", "Movimientos", "Equipo"]) check(wb.SheetNames.includes(n), `hoja «${n}»`);
const { count } = await admin.from("products").select("id", { count: "exact", head: true }).eq("business_id", biz.id).is("deleted_at", null);
const inv = XLSX.utils.sheet_to_json(wb.Sheets.Inventario);
check(inv.length >= (count ?? 0) || (count === 0 && inv.length <= 1), `Inventario: ${inv.length} fila(s) para ${count} producto(s)`);
const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: anonList } = await anon.storage.from("backups").list(biz.id);
const { error: anonDl } = await anon.storage.from("backups").download(`${biz.id}/${latest}`);
check((anonList ?? []).length === 0 && !!anonDl, "sin sesión no se ve ni descarga ningún respaldo");
console.log(failed ? `\n${failed} fallo(s)` : "\nTodo OK");
process.exit(failed ? 1 : 0);
