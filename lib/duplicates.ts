import { nameKey } from "./categories";

export interface DupCandidate {
  id: string;
  nombre: string | null;
  marca?: string | null;
  codigo_barras?: string | null;
  status?: string;
  /** Parecido de texto calculado en la base (pg_trgm, `similar_products`, 031): todo el nombre */
  sim?: number | null;
  /** …y qué tanto el nombre buscado está contenido en el del candidato */
  wsim?: number | null;
}

export interface DupMatch {
  product_id: string;
  nombre: string;
  motivo: string; // "mismo código de barras" | "mismo nombre" | "nombre muy parecido"
  status?: string;
}

const STOP = new Set(["de", "del", "la", "el", "los", "las", "con", "para", "por", "en", "y", "un", "una", "the", "of"]);
const tokens = (s: string) => new Set(nameKey(s).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t)));

/** Parecido entre dos nombres: proporción de palabras compartidas (Jaccard) sobre palabras significativas. */
export function nameSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  ta.forEach((t) => tb.has(t) && shared++);
  return shared / (ta.size + tb.size - shared);
}

/** Unidades de tamaño → unidad base (ml o g) y su factor. */
const UNITS: Record<string, [string, number]> = {
  ml: ["ml", 1], cc: ["ml", 1], l: ["ml", 1000], lt: ["ml", 1000], lts: ["ml", 1000], litro: ["ml", 1000], litros: ["ml", 1000],
  g: ["g", 1], gr: ["g", 1], grs: ["g", 1], gramos: ["g", 1], kg: ["g", 1000], kilo: ["g", 1000], kilos: ["g", 1000],
  oz: ["oz", 1], u: ["u", 1], un: ["u", 1], und: ["u", 1], unid: ["u", 1], unidades: ["u", 1], unds: ["u", 1],
};
/**
 * Tamaños escritos en el nombre, normalizados («2L» y «2 litros» → 2000ml; «500 g» → 500g). Sirve para no avisar
 * «posible duplicado» entre presentaciones distintas del mismo producto (Arroz 1kg ≠ Arroz 5kg).
 */
export function sizesOf(name: string): Set<string> {
  const out = new Set<string>();
  const re = /(\d+(?:[.,]\d+)?)\s*(ml|cc|lts|lt|litros|litro|l|kg|kilos|kilo|grs|gr|gramos|g|oz|unidades|unds|unid|und|un|u)\b/g;
  for (const m of Array.from(nameKey(name).matchAll(re))) {
    const [base, f] = UNITS[m[2]];
    out.add(`${Math.round(parseFloat(m[1].replace(",", ".")) * f * 100) / 100}${base}`);
  }
  return out;
}
/** ¿Los dos nombres dicen tamaños distintos? (si solo uno dice tamaño, no se sabe: no hay conflicto) */
function sizeConflict(a: string, b: string): boolean {
  const sa = sizesOf(a);
  const sb = sizesOf(b);
  if (!sa.size || !sb.size) return false;
  return !Array.from(sa).some((s) => sb.has(s));
}

/** Umbrales del parecido (calibrados con pares reales: P4 · 2026-11-19) */
const JACCARD_MIN = 0.6;
const TRGM_MIN = 0.5;
const CONTAINED_MIN = 0.75;

/**
 * Busca en el inventario un producto que parezca el mismo que `probe`.
 * Prioridad: mismo código de barras → mismo nombre → nombre muy parecido (palabras compartidas, o parecido de texto
 * de la base si viene en el candidato). No es el mismo si las marcas o los tamaños escritos son distintos.
 * Prefiere los productos en inventario sobre los pendientes.
 */
export function findDuplicate(candidates: DupCandidate[], probe: { nombre?: string | null; marca?: string | null; codigo?: string | null }, excludeId?: string): DupMatch | null {
  const list = candidates.filter((c) => c.id !== excludeId);
  const rank = (c: DupCandidate) => (c.status === "confirmed" ? 0 : 1);
  const code = (probe.codigo ?? "").trim().toUpperCase();
  if (code.length >= 6) {
    const hit = list.filter((c) => (c.codigo_barras ?? "").trim().toUpperCase() === code).sort((a, b) => rank(a) - rank(b))[0];
    if (hit) return { product_id: hit.id, nombre: hit.nombre ?? "Sin nombre", motivo: "mismo código de barras", status: hit.status };
  }
  const name = (probe.nombre ?? "").trim();
  if (name.length < 3) return null;
  const key = nameKey(name);
  const exact = list.filter((c) => c.nombre && nameKey(c.nombre) === key).sort((a, b) => rank(a) - rank(b))[0];
  if (exact) return { product_id: exact.id, nombre: exact.nombre ?? "", motivo: "mismo nombre", status: exact.status };
  const brand = nameKey(probe.marca ?? "");
  let best: { c: DupCandidate; score: number } | null = null;
  for (const c of list) {
    if (!c.nombre) continue;
    const cb = nameKey(c.marca ?? "");
    if (brand && cb && brand !== cb) continue; // marcas distintas → otro producto
    if (sizeConflict(name, c.nombre)) continue; // 1 kg ≠ 5 kg
    const jac = nameSimilarity(name, c.nombre);
    const sim = c.sim ?? 0;
    const wsim = c.wsim ?? 0;
    const ok = jac >= JACCARD_MIN || sim >= TRGM_MIN || wsim >= CONTAINED_MIN;
    if (!ok) continue;
    const score = Math.max(jac, sim, wsim);
    if (!best || score > best.score || (score === best.score && rank(c) < rank(best.c))) best = { c, score };
  }
  if (best) return { product_id: best.c.id, nombre: best.c.nombre ?? "", motivo: "nombre muy parecido", status: best.c.status };
  return null;
}
