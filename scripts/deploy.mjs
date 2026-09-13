/**
 * Despliegue a Cloudflare Pages desde Windows (o cualquier SO) usando un API token
 * del proyecto (no depende de `wrangler login`, así no choca con otras cuentas).
 *
 *   node scripts/deploy.mjs            → build + deploy a producción (rama main)
 *
 * Requiere en .env.local: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
 * Opcional: CLOUDFLARE_PAGES_PROJECT (por defecto "inventaria")
 */
import { execSync } from "node:child_process";
import { loadEnvLocal, requireEnv } from "./env.mjs";

loadEnvLocal();
requireEnv("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID");
const project = process.env.CLOUDFLARE_PAGES_PROJECT || "inventaria";

const run = (cmd) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", shell: true, env: process.env });
};

run("npx vercel build --yes");
run("npx @cloudflare/next-on-pages --skip-build");
run(`npx wrangler pages deploy .vercel/output/static --project-name ${project} --branch main --commit-dirty=true`);
