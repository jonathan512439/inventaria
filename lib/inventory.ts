import type { Category, Product } from "@/types/database";
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

export const LOW_STOCK_MAX = 3;

function alertsOf(list: Product[], variantsOf?: VariantsOf): Alerts {
  return {
    agotados: list.filter((p) => (stockOf(p) ?? 0) <= 0).length,
    sinPrecio: list.filter((p) => priceOf(p) === null).length,
    sinFoto: list.filter((p) => !p.image_url).length,
    pendientes: list.filter((p) => p.status === "draft").length,
    variantesAgotadas: list.reduce((n, p) => n + ((stockOf(p) ?? 0) > 0 ? (variantsOf?.get(p.id) ?? []).filter((v) => v.stock <= 0).length : 0), 0),
  };
}

function summarize(list: Product[], variantsOf?: VariantsOf): Summary {
  let units = 0, saleValue = 0, costValue = 0;
  for (const p of list) {
    const s = stockOf(p) ?? 0;
    units += s;
    saleValue += (priceOf(p) ?? 0) * s;
    costValue += (costOf(p) ?? 0) * s;
  }
  const lowStock = list.filter((p) => {
    const s = stockOf(p) ?? 0;
    return s > 0 && s <= LOW_STOCK_MAX;
  }).length;
  return { products: list.length, units, saleValue, costValue, alerts: alertsOf(list, variantsOf), lowStock };
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
    const s = summarize(list, variantsOf);
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
  return { shelves, orphan: summarize(orphan, variantsOf), orphanList: orphan, total: summarize(products, variantsOf) };
}

export function fmtMoney(n: number): string {
  return n.toLocaleString("es", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export type Filter = "agotados" | "sinPrecio" | "sinFoto" | "hoy" | "pendientes";

export function applyFilters(list: Product[], filters: Set<Filter>, variantsOf?: Map<string, { stock: number }[]>): Product[] {
  if (!filters.size) return list;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return list.filter((p) => {
    // Agotado: sin stock total, o alguna de sus variantes en 0
    if (filters.has("agotados") && (stockOf(p) ?? 0) > 0 && !(variantsOf?.get(p.id) ?? []).some((v) => v.stock <= 0)) return false;
    if (filters.has("sinPrecio") && priceOf(p) !== null) return false;
    if (filters.has("sinFoto") && p.image_url) return false;
    if (filters.has("hoy") && new Date(p.created_at) < today) return false;
    if (filters.has("pendientes") && p.status !== "draft") return false;
    return true;
  });
}
