/**
 * Convierte errores técnicos (red, Supabase, Postgres, Gemini) en mensajes sencillos para la persona.
 * Uso: toast("error", friendlyError(e)) · setError(friendlyError(error)).
 */

type ErrLike = { message?: unknown; code?: unknown; status?: unknown; name?: unknown };

function parts(e: unknown): { message: string; code: string; status: number | null; name: string } {
  if (typeof e === "string") return { message: e, code: "", status: null, name: "" };
  const x = (e && typeof e === "object" ? e : {}) as ErrLike;
  return {
    message: typeof x.message === "string" ? x.message : e instanceof Error ? e.message : String(e ?? ""),
    code: typeof x.code === "string" ? x.code : "",
    status: typeof x.status === "number" ? x.status : null,
    name: typeof x.name === "string" ? x.name : "",
  };
}

export const NETWORK_MESSAGE = "No pudimos conectar con el servidor. Revisa tu internet o intenta de nuevo en unos minutos.";

/** ¿El error es de conexión (sin red, servidor que no responde, CORS)? */
export function isConnectionError(e: unknown): boolean {
  const { message, name, status } = parts(e);
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (name === "AuthRetryableFetchError") return true;
  if (status === 0 || status === 502 || status === 503 || status === 504 || status === 540) return true;
  return /failed to fetch|fetch failed|networkerror|network request failed|load failed|err_|econn|etimedout|timeout/i.test(message);
}

export function friendlyError(e: unknown, fallback = "Algo salió mal. Intenta de nuevo."): string {
  const { message, code } = parts(e);
  if (isConnectionError(e)) return NETWORK_MESSAGE;
  // Autenticación (Supabase Auth)
  if (/invalid login credentials/i.test(message) || code === "invalid_credentials") return "Correo o contraseña incorrectos.";
  if (/email not confirmed/i.test(message) || code === "email_not_confirmed") return "Debes confirmar tu correo antes de iniciar sesión.";
  if (/user already registered/i.test(message) || code === "user_already_exists") return "Ya existe una cuenta con ese correo. Inicia sesión.";
  if (/password should be at least|weak.?password/i.test(message) || code === "weak_password") return "La contraseña es muy corta: usa al menos 6 caracteres.";
  if (/rate limit|too many requests|over_request_rate_limit|over_email_send_rate_limit/i.test(message) || code === "over_request_rate_limit") return "Demasiados intentos seguidos. Espera un minuto y vuelve a probar.";
  if (/jwt expired|invalid jwt|refresh token/i.test(message)) return "Tu sesión venció. Vuelve a iniciar sesión.";
  // Base de datos (Postgres / PostgREST). P0001 = mensaje escrito por nuestras funciones SQL, ya pensado para la persona.
  if (code === "P0001" && message) return message;
  if (code === "23505" || /duplicate key/i.test(message)) return "Eso ya existe (hay otro registro igual).";
  if (code === "42501" || /row-level security|permission denied/i.test(message)) return "No tienes permiso para hacer esto.";
  if (code === "23503") return "Está relacionado con otros datos y no se puede cambiar así.";
  if (code === "23514" || /violates check constraint/i.test(message)) return "Algún valor no es válido (revisa cantidades y precios).";
  // IA
  if (/cupo|quota|resource_exhausted/i.test(message)) return "Se agotó el cupo de IA por hoy. Vuelve a intentar mañana o usa tu propia clave en Ajustes.";
  // Mensajes ya escritos para la persona (en español) se respetan
  if (message && /[áéíóúñ¿¡]|^(No |El |La |Los |Las |Escribe |Elige |Falta )/.test(message)) return message;
  return fallback;
}
