import type { Category, Product, ProductData } from "@/types/database";
import { findSibling, nameKey } from "./categories";
import { findDuplicate } from "./duplicates";
import { normalizeFieldName } from "./fields";
import { parseExpiry } from "./inventory";

/**
 * Importar Excel: a qué dato del producto va cada columna de la planilla.
 * "otro" guarda la columna tal cual (con su nombre) dentro de `data`; "ignorar" la salta.
 */
export type Target = "nombre" | "categoria" | "subcategoria" | "marca" | "precio" | "precio_compra" | "stock" | "codigo_barras" | "min_stock" | "expires_at" | "precio_mayorista" | "unidades_por_paquete" | "descripcion" | "otro" | "ignorar";

export const TARGETS: { key: Target; label: string; numeric?: boolean }[] = [
  { key: "nombre", label: "Nombre del producto" },
  { key: "categoria", label: "Categoría" },
  { key: "subcategoria", label: "Subcategoría" },
  { key: "marca", label: "Marca" },
  { key: "precio", label: "Precio de venta", numeric: true },
  { key: "precio_compra", label: "Precio de compra", numeric: true },
  { key: "stock", label: "Stock (cuántos hay)", numeric: true },
  { key: "codigo_barras", label: "Código de barras" },
  { key: "min_stock", label: "Avisar desde (stock mínimo)", numeric: true },
  { key: "expires_at", label: "Vence el" },
  { key: "precio_mayorista", label: "Precio por mayor", numeric: true },
  { key: "unidades_por_paquete", label: "Unidades por paquete", numeric: true },
  { key: "descripcion", label: "Descripción" },
  { key: "otro", label: "Otro dato (se guarda con el nombre de la columna)" },
  { key: "ignorar", label: "No importar" },
];

const SYNONYMS: Record<Target, string[]> = {
  nombre: ["nombre", "producto", "articulo", "item", "descripcion_del_producto", "name", "title", "titulo", "nombre_del_producto"],
  categoria: ["categoria", "category", "rubro", "tipo", "familia", "linea", "grupo"],
  subcategoria: ["subcategoria", "subcategory", "subrubro", "subtipo", "seccion", "subfamilia"],
  marca: ["marca", "brand", "fabricante"],
  precio: ["precio", "precio_venta", "precio_de_venta", "pvp", "price", "venta", "p_venta", "precio_unitario"],
  precio_compra: ["precio_compra", "precio_de_compra", "costo", "cost", "coste", "compra", "p_compra", "precio_costo"],
  stock: ["stock", "cantidad", "existencias", "qty", "quantity", "unidades", "inventario", "cant"],
  codigo_barras: ["codigo_barras", "codigo_de_barras", "codigo", "barcode", "ean", "sku", "upc", "cod", "code"],
  min_stock: ["min_stock", "stock_minimo", "minimo", "avisar_desde", "reponer_desde", "stock_min"],
  expires_at: ["expires_at", "vence", "vence_el", "vencimiento", "fecha_de_vencimiento", "caduca", "caducidad", "expira"],
  precio_mayorista: ["precio_mayorista", "mayorista", "precio_por_mayor", "por_mayor", "precio_mayor"],
  unidades_por_paquete: ["unidades_por_paquete", "unidades_paquete", "pack", "paquete", "por_paquete"],
  descripcion: ["descripcion", "description", "detalle", "observaciones", "notas"],
  otro: [],
  ignorar: ["estado", "etiqueta_leida", "modelo_ia", "foto", "creado", "id", "variante", "fecha_de_creacion"],
};

/** Adivina el destino de una columna por su encabezado ("Precio de venta" → precio). */
export function guessTarget(header: string): Target {
  const h = normalizeFieldName(header);
  if (!h) return "ignorar";
  for (const [target, list] of Object.entries(SYNONYMS) as [Target, string[]][]) if (list.includes(h)) return target;
  return "otro";
}

/** Mapeo inicial: cada encabezado va a su destino adivinado; un mismo destino no se repite (gana la primera columna). */
export function initialMapping(headers: string[]): Record<string, Target> {
  const out: Record<string, Target> = {};
  const taken = new Set<Target>();
  headers.forEach((h) => {
    let t = guessTarget(h);
    if (t !== "otro" && t !== "ignorar" && taken.has(t)) t = "otro";
    if (t !== "otro" && t !== "ignorar") taken.add(t);
    out[h] = t;
  });
  return out;
}

export type ImportRow = {
  n: number; // número de fila en la planilla (1 = primera con datos)
  nombre: string;
  categoria: string;
  subcategoria: string;
  data: ProductData;
  min_stock: number | null;
  expires_at: string | null;
  error: string | null;
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[^\d,.-]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());
const isoDate = (v: unknown): string | null => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  // Fecha de Excel sin formato: días desde 1899-12-30
  if (typeof v === "number" && v > 30000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
  return parseExpiry(str(v));
};

/** Convierte las filas crudas de la planilla en productos listos, según el mapeo. Marca las filas sin nombre. */
export function buildRows(raw: Record<string, unknown>[], mapping: Record<string, Target>): ImportRow[] {
  return raw.map((r, i) => {
    const row: ImportRow = { n: i + 1, nombre: "", categoria: "", subcategoria: "", data: {}, min_stock: null, expires_at: null, error: null };
    for (const [col, target] of Object.entries(mapping)) {
      const v = r[col];
      if (target === "ignorar") continue;
      if (target === "nombre") row.nombre = str(v);
      else if (target === "categoria") row.categoria = str(v);
      else if (target === "subcategoria") row.subcategoria = str(v);
      else if (target === "min_stock") row.min_stock = num(v) === null ? null : Math.max(0, Math.round(num(v)!));
      else if (target === "expires_at") row.expires_at = isoDate(v);
      else if (target === "otro") {
        const key = normalizeFieldName(col);
        if (key && str(v) !== "") row.data[key] = typeof v === "number" ? v : str(v);
      } else {
        const def = TARGETS.find((t) => t.key === target)!;
        if (def.numeric) {
          const n = num(v);
          if (n !== null) row.data[target] = target === "stock" || target === "unidades_por_paquete" ? Math.round(n) : n;
        } else if (str(v) !== "") row.data[target] = str(v);
      }
    }
    if (row.nombre) row.data.nombre = row.nombre;
    else row.error = "Sin nombre";
    if (row.data.codigo_barras !== undefined) row.data.codigo_barras = String(row.data.codigo_barras).replace(/\.0+$/, "");
    return row;
  });
}

export type ImportPlan = {
  creates: ImportRow[];
  updates: { row: ImportRow; product: Product; motivo: string }[];
  skipped: ImportRow[];
  /** Categorías que habrá que crear: principal y (opcional) subcategoría */
  newCategories: { top: string; sub: string | null }[];
};

/**
 * Qué pasaría al importar: qué filas crean productos nuevos, cuáles coinciden con uno existente
 * (mismo código de barras o mismo nombre) y qué categorías faltan.
 */
export function planImport(rows: ImportRow[], products: Product[], categories: Category[]): ImportPlan {
  const candidates = products.map((p) => ({ id: p.id, nombre: String(p.data.nombre ?? ""), marca: String(p.data.marca ?? ""), codigo_barras: String(p.data.codigo_barras ?? ""), status: p.status }));
  const byId = new Map(products.map((p) => [p.id, p]));
  const plan: ImportPlan = { creates: [], updates: [], skipped: [], newCategories: [] };
  const seenCats = new Set<string>();
  const seenInFile = new Map<string, ImportRow>();
  for (const r of rows) {
    if (r.error) {
      plan.skipped.push(r);
      continue;
    }
    // Dentro de la misma planilla, dos filas iguales (mismo código o mismo nombre) se quedan con la primera
    const fileKey = r.data.codigo_barras ? `c:${String(r.data.codigo_barras).toUpperCase()}` : `n:${nameKey(r.nombre)}|${nameKey(r.categoria)}|${nameKey(r.subcategoria)}`;
    if (seenInFile.has(fileKey)) {
      r.error = `Repetida en la planilla (igual que la fila ${seenInFile.get(fileKey)!.n})`;
      plan.skipped.push(r);
      continue;
    }
    seenInFile.set(fileKey, r);
    const match = findDuplicate(candidates, { nombre: r.nombre, marca: String(r.data.marca ?? ""), codigo: String(r.data.codigo_barras ?? "") });
    if (match && match.motivo !== "nombre muy parecido") plan.updates.push({ row: r, product: byId.get(match.product_id)!, motivo: match.motivo });
    else plan.creates.push(r);
    if (r.categoria) {
      const top = findSibling(categories, null, r.categoria);
      const key = `${nameKey(r.categoria)}>${nameKey(r.subcategoria)}`;
      if (!top) {
        if (!seenCats.has(key)) plan.newCategories.push({ top: r.categoria, sub: r.subcategoria || null });
        seenCats.add(key);
      } else if (r.subcategoria && !findSibling(categories, top.id, r.subcategoria)) {
        if (!seenCats.has(key)) plan.newCategories.push({ top: top.name, sub: r.subcategoria });
        seenCats.add(key);
      }
    }
  }
  return plan;
}

/** Categoría (o subcategoría) destino de una fila, si ya existe. */
export function categoryFor(categories: Category[], r: ImportRow): Category | null {
  if (!r.categoria) return null;
  const top = findSibling(categories, null, r.categoria);
  if (!top) return null;
  if (!r.subcategoria) return top;
  return findSibling(categories, top.id, r.subcategoria) ?? top;
}
