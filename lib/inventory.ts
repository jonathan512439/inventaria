import type { Category, Product, ProductSummary } from "@/types/database";
import { getDescendantIds } from "./categories";
import { normalizeFieldName } from "./fields";

/** Lee un número de `data` por cualquiera de los nombres dados (sin importar mayúsculas). */
function num(p: Product, names: string[]): number | null {
  const keys = Object.keys(p.data);
  for (const n of names) {
    const k = keys.find((x) => normalizeFieldName(x) === n);
    if (!k) continue;
    const v = p.data[k];
    if (v === null || v === undefined || v === "") continue;
    const x = typeof v === "number" ? v : Number(String(v).replace(",", "."));
    if (Number.isFinite(x)) return x;
  }
  return null;
}

/** Convierte una fila de `product_summaries` en un Product mínimo (data con nombre/precio/stock) para reutilizar los cálculos. */
/** Columnas ligeras de la vista (sin `search`, que puede ser largo). */
export const SUMMARY_COLS = "id,user_id,category_id,status,image_url,created_at,updated_at,nombre,marca,precio,precio_compra,stock,codigo_barras,min_stock,expires_at,precio_mayorista,unidades_por_paquete";

export function fromSummary(s: ProductSummary): Product {
  return {
    id: s.id,
    user_id: s.user_id,
    category_id: s.category_id,
    status: s.status,
    image_url: s.image_url,
    created_at: s.created_at,
    updated_at: s.updated_at,
    ai_meta: {},
    min_stock: s.min_stock ?? null,
    expires_at: s.expires_at ?? null,
    data: {
      nombre: s.nombre ?? "",
      marca: s.marca ?? "",
      precio: s.precio,
      precio_compra: s.precio_compra,
      stock: s.stock,
      codigo_barras: s.codigo_barras ?? "",
      precio_mayorista: s.precio_mayorista ?? null,
      unidades_por_paquete: s.unidades_por_paquete ?? null,
    },
  };
}

export const priceOf = (p: Product) => num(p, ["precio", "precio_venta", "price"]);
export const costOf = (p: Product) => num(p, ["precio_compra", "costo", "cost"]);
export const stockOf = (p: Product) => num(p, ["stock", "cantidad", "existencias"]);

export interface Alerts {
  agotados: number;
  sinPrecio: number;
  sinFoto: number;
  pendientes: number;
  /** Variantes (talla/color…) en 0 dentro de productos que aún tienen stock */
  variantesAgotadas: number;
  /** Con stock por debajo del mínimo (incluye agotados) */
  porReponer: number;
  /** Vencen en ≤ 30 días o ya vencieron */
  porVencer: number;
}

type VariantsOf = Map<string, { stock: number }[]>;

export interface CategoryStats {
  category: Category;
  products: number; // en la categoría y sus subcategorías
  units: number;
  saleValue: number;
  costValue: number;
  alerts: Alerts;
  lowStock: number;
  children: { category: Category; products: number; units: number }[];
  /** Producto que más valor de venta acumula (precio × stock) */
  topProduct: { product: Product; value: number } | null;
  /** Fecha del último producto agregado */
  lastAdded: string | null;
}

export interface Summary {
  products: number;
  units: number;
  saleValue: number;
  costValue: number;
  alerts: Alerts;
  /** Productos con 1–LOW_STOCK_MAX unidades: conviene reponer */
  lowStock: number;
}

/** Mínimo por defecto cuando ni el producto ni su categoría lo definen. */
export const LOW_STOCK_MAX = 3;
export const DEFAULT_MIN_STOCK = LOW_STOCK_MAX;
/** Días de anticipación para «por vencer». */
export const EXPIRY_SOON_DAYS = 30;

/** Stock mínimo efectivo: el del producto, si no el de su categoría principal, si no el general. */
export function minStockOf(p: Product, categories?: Category[]): number {
  if (typeof p.min_stock === "number") return p.min_stock;
  if (categories && p.category_id) {
    const cat = categories.find((c) => c.id === p.category_id);
    const top = cat?.parent_id ? categories.find((c) => c.id === cat.parent_id) : cat;
    if (typeof top?.min_stock_default === "number") return top.min_stock_default;
  }
  return DEFAULT_MIN_STOCK;
}
/** Hay que reponer: stock 0 o por debajo del mínimo (el mínimo 0 desactiva la alerta salvo agotado). */
export function needsRestock(p: Product, categories?: Category[]): boolean {
  const s = stockOf(p) ?? 0;
  return s <= 0 || s <= minStockOf(p, categories);
}
/** Días hasta el vencimiento (negativo = vencido); null si no tiene fecha. */
export function daysToExpiry(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}
export function expiringSoon(p: Product): boolean {
  const d = daysToExpiry(p.expires_at);
  return d !== null && d <= EXPIRY_SOON_DAYS;
}

function alertsOf(list: Product[], variantsOf?: VariantsOf, categories?: Category[]): Alerts {
  return {
    porReponer: list.filter((p) => needsRestock(p, categories)).length,
    porVencer: list.filter(expiringSoon).length,
    agotados: list.filter((p) => (stockOf(p) ?? 0) <= 0).length,
    sinPrecio: list.filter((p) => priceOf(p) === null).length,
    sinFoto: list.filter((p) => !p.image_url).length,
    pendientes: list.filter((p) => p.status === "draft").length,
    variantesAgotadas: list.reduce((n, p) => n + ((stockOf(p) ?? 0) > 0 ? (variantsOf?.get(p.id) ?? []).filter((v) => v.stock <= 0).length : 0), 0),
  };
}

function summarize(list: Product[], variantsOf?: VariantsOf, categories?: Category[]): Summary {
  let units = 0, saleValue = 0, costValue = 0;
  for (const p of list) {
    const s = stockOf(p) ?? 0;
    units += s;
    saleValue += (priceOf(p) ?? 0) * s;
    costValue += (costOf(p) ?? 0) * s;
  }
  // Poco stock = por debajo del mínimo pero no agotado
  const lowStock = list.filter((p) => (stockOf(p) ?? 0) > 0 && needsRestock(p, categories)).length;
  return { products: list.length, units, saleValue, costValue, alerts: alertsOf(list, variantsOf, categories), lowStock };
}

/** "hoy", "ayer", "hace 3 días", "hace 2 meses" */
export function timeAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  if (days < 30) return `hace ${days} días`;
  const months = Math.floor(days / 30);
  return months === 1 ? "hace 1 mes" : `hace ${months} meses`;
}

/** Estadísticas por categoría principal (incluye sus subcategorías) + productos sin categoría. */
export function computeShelves(products: Product[], categories: Category[], variantsOf?: VariantsOf) {
  const roots = categories.filter((c) => !c.parent_id).sort((a, b) => a.name.localeCompare(b.name, "es"));
  const shelves: CategoryStats[] = roots.map((root) => {
    const ids = new Set(getDescendantIds(categories, root.id));
    const list = products.filter((p) => p.category_id && ids.has(p.category_id));
    const s = summarize(list, variantsOf, categories);
    const children = categories
      .filter((c) => c.parent_id === root.id)
      .sort((a, b) => a.name.localeCompare(b.name, "es"))
      .map((c) => {
        const cids = new Set(getDescendantIds(categories, c.id));
        const inSub = products.filter((p) => p.category_id && cids.has(p.category_id));
        return { category: c, products: inSub.length, units: inSub.reduce((a, p) => a + (stockOf(p) ?? 0), 0) };
      });
    let topProduct: CategoryStats["topProduct"] = null;
    for (const p of list) {
      const value = (priceOf(p) ?? 0) * (stockOf(p) ?? 0);
      if (value > 0 && (!topProduct || value > topProduct.value)) topProduct = { product: p, value };
    }
    const lastAdded = list.reduce<string | null>((m, p) => (!m || p.created_at > m ? p.created_at : m), null);
    return { category: root, ...s, children, topProduct, lastAdded };
  });
  const orphan = products.filter((p) => !p.category_id || !categories.some((c) => c.id === p.category_id));
  return { shelves, orphan: summarize(orphan, variantsOf, categories), orphanList: orphan, total: summarize(products, variantsOf, categories) };
}

export function fmtMoney(n: number): string {
  return n.toLocaleString("es", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export type Filter = "agotados" | "sinPrecio" | "sinFoto" | "hoy" | "pendientes" | "porReponer" | "porVencer";

export function applyFilters(list: Product[], filters: Set<Filter>, variantsOf?: Map<string, { stock: number }[]>, categories?: Category[]): Product[] {
  if (!filters.size) return list;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return list.filter((p) => {
    if (filters.has("porReponer") && !needsRestock(p, categories)) return false;
    if (filters.has("porVencer") && !expiringSoon(p)) return false;
    // Agotado: sin stock total, o alguna de sus variantes en 0
    if (filters.has("agotados") && (stockOf(p) ?? 0) > 0 && !(variantsOf?.get(p.id) ?? []).some((v) => v.stock <= 0)) return false;
    if (filters.has("sinPrecio") && priceOf(p) !== null) return false;
    if (filters.has("sinFoto") && p.image_url) return false;
    if (filters.has("hoy") && new Date(p.created_at) < today) return false;
    if (filters.has("pendientes") && p.status !== "draft") return false;
    return true;
  });
}
