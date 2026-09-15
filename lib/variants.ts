import type { Category, ProductVariant, VariantAxis } from "@/types/database";

/** Máximo de ejes por categoría (talla × color × edad ya es una cuadrícula grande). */
export const MAX_AXES = 3;

/** Ejes típicos que se ofrecen al crear un eje a mano o al instalar un catálogo. */
export const AXIS_LIBRARY: { key: string; label: string; options: string[] }[] = [
  { key: "talla", label: "Talla", options: ["XS", "S", "M", "L", "XL", "XXL"] },
  { key: "talla_numerica", label: "Talla (número)", options: ["35", "36", "37", "38", "39", "40", "41", "42", "43", "44"] },
  { key: "color", label: "Color", options: ["Negro", "Blanco", "Rojo", "Azul", "Verde", "Amarillo", "Gris", "Rosado", "Beige", "Café"] },
  { key: "edad", label: "Edad", options: ["0-6 meses", "6-12 meses", "1-2 años", "3-5 años", "6-8 años", "9-12 años", "+12 años"] },
  { key: "sabor", label: "Sabor", options: [] },
  { key: "tamano", label: "Tamaño", options: ["Pequeño", "Mediano", "Grande"] },
  { key: "volumen", label: "Volumen", options: ["250 ml", "500 ml", "1 L", "1,5 L", "2 L", "3 L"] },
  { key: "material", label: "Material", options: [] },
  { key: "modelo", label: "Modelo", options: [] },
];

/** Clave estable a partir de una etiqueta ("Talla (número)" → "talla_numero"). */
export function axisKey(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30);
}

/** Ejes de la categoría principal a la que pertenece `categoryId` (los ejes se definen por categoría principal). */
export function axesFor(axes: VariantAxis[], categories: Category[], categoryId: string | null): VariantAxis[] {
  if (!categoryId) return [];
  const cat = categories.find((c) => c.id === categoryId);
  const topId = cat?.parent_id ?? cat?.id ?? null;
  if (!topId) return [];
  return axes.filter((a) => a.category_id === topId).sort((a, b) => a.sort_order - b.sort_order);
}

/** "M · Rojo" en el orden de los ejes. */
export function variantLabel(values: Record<string, string>, axes: VariantAxis[]): string {
  const ordered = axes.map((a) => values[a.key]).filter(Boolean);
  const extra = Object.entries(values)
    .filter(([k]) => !axes.some((a) => a.key === k))
    .map(([, v]) => v);
  return [...ordered, ...extra].join(" · ") || "Única";
}

/** Combinaciones de las opciones elegidas por eje (producto cartesiano, en orden de ejes). */
export function combos(axes: VariantAxis[], chosen: Record<string, string[]>): Record<string, string>[] {
  const active = axes.filter((a) => (chosen[a.key] ?? []).length > 0);
  if (!active.length) return [];
  return active.reduce<Record<string, string>[]>(
    (acc, a) => acc.flatMap((c) => chosen[a.key].map((v) => ({ ...c, [a.key]: v }))),
    [{}]
  );
}

/** Igualdad de combinaciones (sin importar el orden de claves). */
export function sameValues(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}

/** Resumen corto para tarjetas: "Tallas S, M, L · 3 colores · 2 agotadas". */
export function summarizeVariants(variants: ProductVariant[], axes: VariantAxis[]): { text: string; agotadas: number } | null {
  if (!variants.length) return null;
  const parts: string[] = [];
  const keys = axes.length ? axes.map((a) => a.key) : Array.from(new Set(variants.flatMap((v) => Object.keys(v.values))));
  keys.forEach((k) => {
    const vals = Array.from(new Set(variants.map((v) => v.values[k]).filter(Boolean)));
    if (!vals.length) return;
    const label = axes.find((a) => a.key === k)?.label ?? k;
    parts.push(vals.length <= 4 ? `${label}: ${vals.join(", ")}` : `${vals.length} ${label.toLowerCase()}s`);
  });
  const agotadas = variants.filter((v) => v.stock <= 0).length;
  return { text: parts.join(" · ") || `${variants.length} variantes`, agotadas };
}

/** Normaliza el texto de variantes que devuelve la IA ("talla: S, M, L; color: rojo, azul") a {talla:[…], color:[…]}. */
export function parseProposals(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  text
    .split(/;|\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((part) => {
      const m = part.match(/^([^:]{1,30}):\s*(.+)$/);
      if (!m) return;
      const key = axisKey(m[1]);
      const vals = m[2]
        .split(/,|\/|\|/)
        .map((v) => v.trim().replace(/\.$/, ""))
        .filter((v) => v && v.length <= 30)
        .map((v) => (v.length <= 3 ? v.toUpperCase() : v[0].toUpperCase() + v.slice(1)));
      if (key && vals.length) out[key] = Array.from(new Set(vals)).slice(0, 12);
    });
  return out;
}

/** Empareja las propuestas de la IA con los ejes de la categoría (por clave o por etiqueta parecida). */
export function matchProposals(proposals: Record<string, string[]> | null | undefined, axes: VariantAxis[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!proposals) return out;
  axes.forEach((a) => {
    const candidates = [a.key, axisKey(a.label), a.key.replace(/_.*$/, "")];
    const hit = Object.keys(proposals).find((k) => candidates.includes(k) || candidates.some((c) => k.startsWith(c) || c.startsWith(k)));
    if (hit) {
      // Si el eje tiene opciones fijas, mapeamos por texto (sin acentos / mayúsculas)
      const norm = (s: string) => axisKey(s);
      out[a.key] = proposals[hit]
        .map((v) => (a.options.length ? a.options.find((o) => norm(o) === norm(v)) ?? v : v))
        .filter((v, i, arr) => arr.indexOf(v) === i);
    }
  });
  return out;
}

/** Stock total y agotadas de un conjunto de variantes. */
export function variantTotals(variants: ProductVariant[]) {
  return { stock: variants.reduce((s, v) => s + v.stock, 0), agotadas: variants.filter((v) => v.stock <= 0).length };
}
