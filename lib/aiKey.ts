import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { serviceKey, type KeyContext } from "@/lib/gemini";

/**
 * Clave de IA propia del usuario (BYOK): cifrada con AES-GCM y un secreto del servidor.
 * Solo se descifra aquí, dentro de las rutas del servidor que llaman a Gemini.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

async function aesKey(): Promise<CryptoKey> {
  const secret = process.env.KEY_ENCRYPTION_SECRET;
  if (!secret) throw new Error("Falta KEY_ENCRYPTION_SECRET en el entorno del servidor");
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function encryptKey(plain: string): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(), enc.encode(plain));
  return { ciphertext: b64(ct), iv: b64(iv) };
}

export async function decryptKey(ciphertext: string, iv: string): Promise<string> {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(), unb64(ciphertext));
  return dec.decode(pt);
}

/** Clave a usar para este usuario: la propia si la configuró, si no la del servicio. */
export async function resolveAiKey(admin: SupabaseClient<Database>, userId: string): Promise<KeyContext> {
  const { data } = await admin.from("ai_keys").select("key_ciphertext,iv").eq("user_id", userId).maybeSingle();
  if (data) {
    try {
      return { apiKey: await decryptKey(data.key_ciphertext, data.iv), keyId: userId, own: true };
    } catch {
      /* secreto cambiado o dato corrupto: se usa la del servicio */
    }
  }
  return serviceKey();
}

/** Comprueba una clave de Gemini contra Google (lista de modelos). */
export async function validateGeminiKey(apiKey: string): Promise<{ ok: boolean; message?: string }> {
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { headers: { "x-goog-api-key": apiKey } });
  if (res.ok) return { ok: true };
  if (res.status === 400 || res.status === 403) return { ok: false, message: "Google rechazó la clave. Revisa que la copiaste completa y que está habilitada." };
  return { ok: false, message: `No se pudo comprobar la clave (${res.status}). Intenta de nuevo.` };
}
