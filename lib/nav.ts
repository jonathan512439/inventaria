/**
 * A dónde volver después de entrar o registrarse (`?next=`). Solo rutas de la app: nunca otro sitio
 * (evita que un enlace armado mande a la persona fuera de InventarIA). Sirve en el navegador y en el middleware.
 */
export function safeNext(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  return raw;
}

/** Código de invitación que viaja dentro de `next` (/join?code=ABC123), o null. */
export function inviteCodeIn(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/join")) return null;
  const m = /[?&]code=([A-Za-z0-9]{6})\b/.exec(next);
  return m ? m[1].toUpperCase() : null;
}
