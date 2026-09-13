/**
 * Ejecuta un archivo SQL en el proyecto de Supabase vía Management API.
 *
 *   node scripts/supabase-sql.mjs supabase/migrations.sql
 *
 * Requiere en .env.local: SUPABASE_ACCESS_TOKEN (token personal de tu cuenta Supabase)
 * y NEXT_PUBLIC_SUPABASE_URL (de ahí se saca el project ref).
 */
import fs from "node:fs";
import { loadEnvLocal, requireEnv } from "./env.mjs";

loadEnvLocal();
requireEnv("SUPABASE_ACCESS_TOKEN", "NEXT_PUBLIC_SUPABASE_URL");

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error("Uso: node scripts/supabase-sql.mjs <archivo.sql>");
  process.exit(1);
}
const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const query = fs.readFileSync(file, "utf8");

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
});
const text = await res.text();
if (!res.ok) {
  console.error(`Error ${res.status}: ${text}`);
  process.exit(1);
}
console.log(`OK (${ref}) → ${file}`);
if (text && text !== "[]") console.log(text.slice(0, 2000));
