/**
 * Sube las variables de entorno de la app a Cloudflare Pages (producción y preview)
 * leyéndolas de .env.local. Ejecutar una vez, o cuando cambien.
 *
 *   node scripts/cf-env.mjs
 */
import { loadEnvLocal, requireEnv } from "./env.mjs";

loadEnvLocal();
requireEnv("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID");
const project = process.env.CLOUDFLARE_PAGES_PROJECT || "inventaria";
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const headers = { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" };

const APP_VARS = ["NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "GEMINI_API_KEY", "GEMINI_MODEL", "GEMINI_MODELS", "KEY_ENCRYPTION_SECRET"];
const SECRET = new Set(["SUPABASE_SERVICE_ROLE_KEY", "GEMINI_API_KEY", "KEY_ENCRYPTION_SECRET"]);

const envVars = {};
for (const k of APP_VARS) {
  if (!process.env[k]) continue;
  envVars[k] = { value: process.env[k], type: SECRET.has(k) ? "secret_text" : "plain_text" };
}
envVars.NODE_VERSION = { value: "20", type: "plain_text" };

const body = {
  deployment_configs: {
    production: { env_vars: envVars, compatibility_flags: ["nodejs_compat"], compatibility_date: "2024-09-23" },
    preview: { env_vars: envVars, compatibility_flags: ["nodejs_compat"], compatibility_date: "2024-09-23" },
  },
};
const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${project}`, {
  method: "PATCH",
  headers,
  body: JSON.stringify(body),
});
const json = await res.json();
if (!json.success) {
  console.error(JSON.stringify(json.errors, null, 2));
  process.exit(1);
}
console.log(`OK: variables y nodejs_compat aplicados en el proyecto "${project}" (production + preview)`);
console.log("Variables:", Object.keys(envVars).join(", "));
