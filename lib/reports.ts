import type { Category, Product, Sale, SaleItem } from "@/types/database";
import { costOf, priceOf, stockOf } from "./inventory";

export type Period = "7d" | "mes" | "90d";

export function periodStart(p: Period): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (p === "7d") return new Date(d.getTime() - 6 * 86400000);
  if (p === "mes") return new Date(d.getFullYear(), d.getMonth(), 1);
  return new Date(d.getTime() - 89 * 86400000);
}
/** Periodo anterior del mismo largo (para comparar). */
export function previousRange(p: Period): { start: Date; end: Date } {
  const start = periodStart(p);
  if (p === "mes") return { start: new Date(start.getFullYear(), start.getMonth() - 1, 1), end: start };
  const len = Date.now() - start.getTime();
  return { start: new Date(start.getTime() - len), end: start };
}

export interface ProductSales {
  product_id: string;
  name: string;
  units: number;
  revenue: number;
  profit: number;
  lastSale: string | null;
}

/** Ventas agregadas por producto a partir de las líneas de ticket. */
export function salesByProduct(items: SaleItem[]): ProductSales[] {
  const m = new Map<string, ProductSales>();
  for (const i of items) {
    const key = i.product_id ?? i.product_name ?? "?";
    const cur = m.get(key) ?? { product_id: key, name: i.product_name ?? "Producto", units: 0, revenue: 0, profit: 0, lastSale: null };
    cur.units += i.qty;
    cur.revenue += Number(i.line_total);
    cur.profit += Number(i.line_total) - i.qty * Number(i.unit_cost ?? 0);
    if (!cur.lastSale || i.created_at > cur.lastSale) cur.lastSale = i.created_at;
    m.set(key, cur);
  }
  return Array.from(m.values());
}

export interface CategoryMargin {
  category: Category | null;
  revenue: number;
  cost: number;
  profit: number;
  units: number;
}

/** Margen por categoría principal. */
export function marginByCategory(items: SaleItem[], products: Product[], categories: Category[]): CategoryMargin[] {
  const topOf = (catId: string | null) => {
    const c = categories.find((x) => x.id === catId);
    if (!c) return null;
    return c.parent_id ? categories.find((x) => x.id === c.parent_id) ?? c : c;
  };
  const byProduct = new Map(products.map((p) => [p.id, p]));
  const m = new Map<string, CategoryMargin>();
  for (const i of items) {
    const p = i.product_id ? byProduct.get(i.product_id) : undefined;
    const top = topOf(p?.category_id ?? null);
    const key = top?.id ?? "none";
    const cur = m.get(key) ?? { category: top, revenue: 0, cost: 0, profit: 0, units: 0 };
    const cost = i.qty * Number(i.unit_cost ?? 0);
    cur.revenue += Number(i.line_total);
    cur.cost += cost;
    cur.profit += Number(i.line_total) - cost;
    cur.units += i.qty;
    m.set(key, cur);
  }
  return Array.from(m.values()).sort((a, b) => b.revenue - a.revenue);
}

/** Productos con stock que no se han vendido en `days` días (stock muerto) y el dinero inmovilizado. */
export function deadStock(products: Product[], items: SaleItem[], days = 60): { product: Product; value: number; lastSale: string | null }[] {
  const limit = Date.now() - days * 86400000;
  const last = new Map<string, string>();
  items.forEach((i) => i.product_id && (!last.get(i.product_id) || i.created_at > last.get(i.product_id)!) && last.set(i.product_id, i.created_at));
  return products
    .filter((p) => (stockOf(p) ?? 0) > 0)
    .map((p) => ({ product: p, value: (stockOf(p) ?? 0) * (priceOf(p) ?? 0), lastSale: last.get(p.id) ?? null }))
    .filter((r) => !r.lastSale || new Date(r.lastSale).getTime() < limit)
    .sort((a, b) => b.value - a.value);
}

/** Ventas por día (para la gráfica de barras). */
export function salesPerDay(sales: Sale[], days: number): { day: string; label: string; total: number; count: number }[] {
  const out: { day: string; label: string; total: number; count: number }[] = [];
  for (let k = days - 1; k >= 0; k--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - k);
    const key = d.toISOString().slice(0, 10);
    out.push({ day: key, label: d.toLocaleDateString("es", { weekday: "short" }).slice(0, 2), total: 0, count: 0 });
  }
  const idx = new Map(out.map((o, i) => [o.day, i]));
  for (const s of sales) {
    const local = new Date(s.created_at);
    local.setHours(0, 0, 0, 0);
    const i = idx.get(local.toISOString().slice(0, 10));
    if (i !== undefined) {
      out[i].total += Number(s.total);
      out[i].count++;
    }
  }
  return out;
}

export function inventoryValue(products: Product[]): { sale: number; cost: number; units: number } {
  return products.reduce(
    (a, p) => {
      const s = stockOf(p) ?? 0;
      return { sale: a.sale + s * (priceOf(p) ?? 0), cost: a.cost + s * (costOf(p) ?? 0), units: a.units + s };
    },
    { sale: 0, cost: 0, units: 0 }
  );
}
