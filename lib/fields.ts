import type { Category, FieldTemplate, ProductData } from "@/types/database";
import { getAncestorIds } from "./categories";

/**
 * Campos efectivos de una categoría:
 * globales (category_id null) + los de la categoría + los de sus ancestros.
 * Sin duplicar nombres (gana el más específico).
 */
export function getEffectiveFields(
  templates: FieldTemplate[],
  categories: Category[],
  categoryId: string | null
): FieldTemplate[] {
  const chain = categoryId ? getAncestorIds(categories, categoryId) : [];
  const priority = (t: FieldTemplate) => (t.category_id ? chain.indexOf(t.category_id) + 1 : 0);
  const byName = new Map<string, FieldTemplate>();
  templates
    .filter((t) => t.category_id === null || chain.includes(t.category_id))
    .forEach((t) => {
      const key = t.name.trim().toLowerCase();
      const prev = byName.get(key);
      if (!prev || priority(t) >= priority(prev)) byName.set(key, t);
    });
  return Array.from(byName.values()).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "es"));
}

/** Normaliza el valor de un campo según su tipo (para guardar en data jsonb). */
export function coerceValue(field: FieldTemplate, raw: unknown): string | number | null {
  if (raw === null || raw === undefined || raw === "") return field.field_type === "number" ? null : "";
  if (field.field_type === "number") {
    const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return String(raw);
}

/** Nombre de dato normalizado: minúsculas, sin espacios ni acentos raros → clave estable en `data`. */
export function normalizeFieldName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/** Lee un valor de `data` aunque la clave guardada tenga otra capitalización ("Nombre" vs "nombre"). */
export function getValue(data: ProductData, name: string): ProductData[string] {
  if (name in data) return data[name];
  const target = normalizeFieldName(name);
  for (const k of Object.keys(data)) if (normalizeFieldName(k) === target) return data[k];
  return undefined as unknown as ProductData[string];
}

/** Devuelve `data` con las claves reescritas al nombre canónico de cada campo (une "Nombre" y "nombre"). */
export function canonicalizeData(data: ProductData, fields: FieldTemplate[]): ProductData {
  const out: ProductData = { ...data };
  fields.forEach((f) => {
    if (f.name in out) return;
    const v = getValue(data, f.name);
    if (v !== undefined) {
      out[f.name] = v;
      Object.keys(out).forEach((k) => {
        if (k !== f.name && normalizeFieldName(k) === normalizeFieldName(f.name)) delete out[k];
      });
    }
  });
  return out;
}

/** Rellena con el valor por defecto del campo lo que quedó vacío. Muta `data`. */
export function applyDefaults(fields: FieldTemplate[], data: ProductData): ProductData {
  fields.forEach((f) => {
    const v = data[f.name];
    const empty = v === null || v === undefined || v === "";
    if (empty && f.default_value !== null && f.default_value !== undefined && f.default_value !== "") {
      data[f.name] = coerceValue(f, f.default_value);
    }
  });
  return data;
}

/** Vista amigable del valor para tablas/exportación. */
export function displayValue(v: ProductData[string]): string | number {
  if (v === null || v === undefined) return "";
  return v;
}

/** Plantilla básica sugerida para arrancar rápido. */
export const BASIC_TEMPLATE: Array<Pick<FieldTemplate, "name" | "field_type" | "is_ai_fillable" | "options" | "default_value">> = [
  { name: "nombre", field_type: "text", is_ai_fillable: true, options: null, default_value: null },
  { name: "descripcion", field_type: "text", is_ai_fillable: true, options: null, default_value: null },
  { name: "marca", field_type: "text", is_ai_fillable: true, options: null, default_value: null },
  { name: "color", field_type: "text", is_ai_fillable: true, options: null, default_value: null },
  { name: "precio", field_type: "number", is_ai_fillable: false, options: null, default_value: null },
  { name: "precio_compra", field_type: "number", is_ai_fillable: false, options: null, default_value: null },
  { name: "stock", field_type: "number", is_ai_fillable: false, options: null, default_value: "1" },
];

/** Nombre "bonito" de un campo para mostrar en la interfaz: precio_compra → Precio compra */
export function fieldLabel(name: string): string {
  const s = name.replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Campos que se consideran "el nombre" del producto para títulos y búsquedas. */
export function productTitle(data: ProductData): string {
  for (const k of ["nombre", "name", "producto", "titulo"]) {
    const v = getValue(data, k);
    if (v) return String(v);
  }
  return "";
}
