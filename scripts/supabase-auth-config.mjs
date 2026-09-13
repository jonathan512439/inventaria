/**
 * Aplica la configuración de Auth del proyecto Supabase (Site URL y URLs de redirección permitidas).
 * Nota: las plantillas de correo no se pueden cambiar por API en el plan Free sin SMTP propio.
 *
 *   node scripts/supabase-auth-config.mjs
 *
 * Requiere en .env.local: SUPABASE_ACCESS_TOKEN, NEXT_PUBLIC_SUPABASE_URL
 * Opcional: APP_URL (por defecto https://inventaria.pages.dev)
 */
import { loadEnvLocal, requireEnv } from "./env.mjs";

loadEnvLocal();
requireEnv("SUPABASE_ACCESS_TOKEN", "NEXT_PUBLIC_SUPABASE_URL");

const APP_URL = process.env.APP_URL || "https://inventaria.pages.dev";
const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];

const body = {
  site_url: APP_URL,
  uri_allow_list: [
    `${APP_URL}/auth/callback`,
    `${APP_URL}/auth/confirm`,
    "http://localhost:3000/auth/callback",
    "http://localhost:3000/auth/confirm",
  ].join(","),
};

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  method: "PATCH",
  headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const json = await res.json();
if (!res.ok) {
  console.error(`Error ${res.status}:`, JSON.stringify(json, null, 2));
  process.exit(1);
}
console.log(`OK (${ref}): site_url=${json.site_url}`);
console.log(`redirects: ${json.uri_allow_list}`);
