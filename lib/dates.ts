/**
 * Fechas en la zona horaria del NEGOCIO, no la del celular (Fase 6.9 · C4 · hallazgo N5).
 * Antes cada pantalla cortaba «hoy» con el reloj del teléfono (o en UTC): en Bolivia (UTC−4) una venta a las 21:00
 * podía caer en otro día según la pantalla. FlowProvider fija la zona con `setBusinessTz` desde `session_context()`.
 * Sin pantalla (scripts, servidor) vale la zona por defecto.
 */

export const DEFAULT_TZ = "America/La_Paz";
let TZ = DEFAULT_TZ;

/** Fija la zona del negocio (si no es válida, se conserva la anterior). */
export function setBusinessTz(tz: string | null | undefined) {
  if (!tz) return;
  try {
    new Intl.DateTimeFormat("es", { timeZone: tz }).format(0);
    TZ = tz;
  } catch {
    /* zona inválida: se ignora */
  }
}
export const businessTz = () => TZ;

type Parts = { y: number; m: number; d: number; h: number; mi: number; s: number };
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsOf(date: Date, tz: string): Parts {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    fmtCache.set(tz, f);
  }
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(date)) if (x.type !== "literal") p[x.type] = Number(x.value);
  return { y: p.year, m: p.month, d: p.day, h: p.hour === 24 ? 0 : p.hour, mi: p.minute, s: p.second };
}
/** Cuánto adelanta (ms) la hora del negocio respecto a UTC en ese instante (negativo en América). */
function offsetMs(date: Date, tz: string): number {
  const p = partsOf(date, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(date.getTime() / 1000) * 1000;
}
const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** «AAAA-MM-DD» del día del negocio en ese instante (por defecto, ahora). */
export function businessDayKey(when: Date | string = new Date(), tz = TZ): string {
  const p = partsOf(typeof when === "string" ? new Date(when) : when, tz);
  return keyOf(p.y, p.m, p.d);
}

/** Suma (o resta) días a una clave «AAAA-MM-DD». */
export function addDaysKey(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return keyOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Instante en que empieza el día «AAAA-MM-DD» en la zona del negocio. */
export function businessDayStartOf(key: string, tz = TZ): Date {
  const [y, m, d] = key.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const off = offsetMs(new Date(guess), tz);
  let t = guess - off;
  const off2 = offsetMs(new Date(t), tz); // cambio de horario entre medio
  if (off2 !== off) t = guess - off2;
  return new Date(t);
}

/** Inicio de hoy en la zona del negocio (o de hace `daysAgo` días). */
export function businessDayStart(daysAgo = 0, tz = TZ): Date {
  return businessDayStartOf(addDaysKey(businessDayKey(new Date(), tz), -daysAgo), tz);
}

/** Inicio del mes actual en la zona del negocio (o de hace `monthsAgo` meses). */
export function businessMonthStart(monthsAgo = 0, tz = TZ): Date {
  const p = partsOf(new Date(), tz);
  const t = new Date(Date.UTC(p.y, p.m - 1 - monthsAgo, 1));
  return businessDayStartOf(keyOf(t.getUTCFullYear(), t.getUTCMonth() + 1, 1), tz);
}
