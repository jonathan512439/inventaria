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
}

export interface CategoryStats {
  category: Category;
  products: number; // en la categoría y sus subcategorías
  units: number;
  saleValue: number;
  costValue: number;
  alerts: Alerts;
  children: { category: Category; products: number }[];
}

export interface Summary {
  products: number;
  units: number;
  saleValue: number;
  costValue: number;
  alerts: Alerts;
}

function alertsOf(list: Product[]): Alerts {
  return {
    agotados: list.filter((p) => (stockOf(p) ?? 0) <= 0).length,
    sinPrecio: list.filter((p) => priceOf(p) === null).length,
    sinFoto: list.filter((p) => !p.image_url).length,
    pendientes: list.filter((p) => p.status === "draft").length,
  };
}

function summarize(list: Product[]): Summary {
  let units = 0, saleValue = 0, costValue = 0;
  for (const p of list) {
    const s = stockOf(p) ?? 0;
    units += s;
    saleValue += (priceOf(p) ?? 0) * s;
    costValue += (costOf(p) ?? 0) * s;
  }
  return { products: list.length, units, saleValue, costValue, alerts: alertsOf(list) };
}

/** Estadísticas por categoría principal (incluye sus subcategorías) + productos sin categoría. */
export function computeShelves(products: Product[], categories: Category[]) {
  const roots = categories.filter((c) => !c.parent_id).sort((a, b) => a.name.localeCompare(b.name, "es"));
  const shelves: CategoryStats[] = roots.map((root) => {
    const ids = new Set(getDescendantIds(categories, root.id));
    const list = products.filter((p) => p.category_id && ids.has(p.category_id));
    const s = summarize(list);
    const children = categories
      .filter((c) => c.parent_id === root.id)
      .sort((a, b) => a.name.localeCompare(b.name, "es"))
      .map((c) => {
        const cids = new Set(getDescendantIds(categories, c.id));
        return { category: c, products: products.filter((p) => p.category_id && cids.has(p.category_id)).length };
      });
    return { category: root, ...s, children };
  });
  const orphan = products.filter((p) => !p.category_id || !categories.some((c) => c.id === p.category_id));
  return { shelves, orphan: summarize(orphan), orphanList: orphan, total: summarize(products) };
}

export function fmtMoney(n: number): string {
  return n.toLocaleString("es", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export type Filter = "agotados" | "sinPrecio" | "sinFoto" | "hoy" | "pendientes";

export function applyFilters(list: Product[], filters: Set<Filter>): Product[] {
  if (!filters.size) return list;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return list.filter((p) => {
    if (filters.has("agotados") && (stockOf(p) ?? 0) > 0) return false;
    if (filters.has("sinPrecio") && priceOf(p) !== null) return false;
    if (filters.has("sinFoto") && p.image_url) return false;
    if (filters.has("hoy") && new Date(p.created_at) < today) return false;
    if (filters.has("pendientes") && p.status !== "draft") return false;
    return true;
  });
}
