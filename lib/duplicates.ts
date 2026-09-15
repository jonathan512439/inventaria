import { nameKey } from "./categories";

export interface DupCandidate {
  id: string;
  nombre: string | null;
  marca?: string | null;
  codigo_barras?: string | null;
  status?: string;
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

/**
 * Busca en el inventario un producto que parezca el mismo que `probe`.
 * Prioridad: mismo código de barras → mismo nombre → nombre muy parecido (misma marca si ambas existen).
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
    const score = nameSimilarity(name, c.nombre);
    if (score >= 0.6 && (!best || score > best.score || (score === best.score && rank(c) < rank(best.c)))) best = { c, score };
  }
  if (best) return { product_id: best.c.id, nombre: best.c.nombre ?? "", motivo: "nombre muy parecido", status: best.c.status };
  return null;
}
