/**
 * Sonda de modelos Gemini: qué modelos de la cadena responden hoy y cuál es su cupo diario.
 *   npm run ai:probe
 */
import { loadEnvLocal, requireEnv } from "./env.mjs";
loadEnvLocal();
requireEnv("GEMINI_API_KEY");
const chain = [process.env.GEMINI_MODEL, ...(process.env.GEMINI_MODELS || "gemini-3.7-flash,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-flash-latest").split(",")]
  .map((m) => m?.trim()).filter(Boolean);
for (const model of Array.from(new Set(chain))) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: "Responde solo: ok" }] }] }),
  });
  const j = await res.json();
  if (res.ok) console.log(`✓ ${model}: disponible (esta sonda consumió 1 petición)`);
  else {
    const v = (j.error?.details ?? []).flatMap((d) => d.violations ?? []).map((x) => `${x.quotaId} = ${x.quotaValue}`).join("; ");
    console.log(`✗ ${model}: ${res.status} ${v || j.error?.message?.slice(0, 90)}`);
  }
}
