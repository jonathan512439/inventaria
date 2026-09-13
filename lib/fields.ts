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
  const v = data.nombre ?? data.name ?? data.producto ?? data.titulo;
  return v ? String(v) : "";
}
