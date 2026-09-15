/**
 * Respaldo automático: un .xlsx completo por negocio, subido al bucket privado `backups`
 * ({business_id}/{fecha}-auto.xlsx). Conserva los últimos 8 archivos de cada negocio.
 * Lo ejecuta GitHub Actions cada semana (.github/workflows/backup.yml) o a mano:
 *   npx tsx scripts/backup.mts            (todos los negocios)
 *   npx tsx scripts/backup.mts <business_id>
 */
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { loadEnvLocal, requireEnv } from "./env.mjs";
import { backupFileName, buildBackupWorkbook, type Fetcher } from "../lib/backup";

loadEnvLocal();
requireEnv("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const KEEP = 8;
const PAGE = 1000;

/** Todas las filas de una tabla del negocio, de 1000 en 1000. */
const fetcherFor =
  (bid: string): Fetcher =>
  async (table) => {
    const out: Record<string, unknown>[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin.from(table).select("*").eq("business_id", bid).range(from, from + PAGE - 1);
      if (error) throw new Error(`${table}: ${error.message}`);
      out.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
    return out;
  };

async function backupBusiness(bid: string, name: string) {
  const { wb, counts } = await buildBackupWorkbook(XLSX, fetcherFor(bid), name);
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const path = `${bid}/${backupFileName("auto")}`;
  const { error } = await admin.storage.from("backups").upload(path, buf, { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", upsert: true });
  if (error) throw new Error(`subida: ${error.message}`);
  // Conservar solo los últimos KEEP
  const { data: files } = await admin.storage.from("backups").list(bid, { limit: 200, sortBy: { column: "name", order: "desc" } });
  const old = (files ?? []).slice(KEEP).map((f) => `${bid}/${f.name}`);
  if (old.length) await admin.storage.from("backups").remove(old);
  console.log(`OK  ${name} (${bid}) → ${path} · ${counts.products} productos, ${counts.sales} ventas · ${Math.round(buf.length / 1024)} KB${old.length ? ` · borrados ${old.length} antiguos` : ""}`);
}

const only = process.argv[2];
const { data: businesses, error } = only ? await admin.from("businesses").select("id,name").eq("id", only) : await admin.from("businesses").select("id,name").order("created_at");
if (error) {
  console.error(error.message);
  process.exit(1);
}
let failed = 0;
for (const b of businesses ?? []) {
  try {
    await backupBusiness(b.id, b.name);
  } catch (e) {
    failed++;
    console.error(`FAIL ${b.name} (${b.id}): ${e instanceof Error ? e.message : e}`);
  }
}
console.log(failed ? `\n${failed} negocio(s) sin respaldo` : `\nTodo OK · ${businesses?.length ?? 0} negocio(s)`);
process.exit(failed ? 1 : 0);
