import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Números calculados en la base (027 · C7.7 · E3): el navegador ya no carga todos los productos ni miles de
 * ventas para sumar. Ver supabase/027_numeros.sql.
 */
type DB = SupabaseClient<Database>;
type Rpc = (f: string, a?: unknown) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;

async function rpc<T>(db: DB, fn: string, args?: unknown): Promise<T> {
  const { data, error } = await (db.rpc as unknown as Rpc)(fn, args);
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data as T;
}

export type Period = "7d" | "mes" | "90d";
export const PERIOD_LABEL: Record<Period, string> = { "7d": "últimos 7 días", mes: "este mes", "90d": "últimos 90 días" };
export const PREV_LABEL: Record<Period, string> = { "7d": "7 días anteriores", mes: "mes anterior", "90d": "90 días anteriores" };

interface DayTotals {
  total: number;
  count: number;
  /** null para el vendedor */
  profit: number | null;
}

export interface TodaySummary {
  day: string;
  is_owner: boolean;
  today: DayTotals;
  yesterday: DayTotals;
  sales_ever: boolean;
  closed_today: boolean;
  /** Misma regla que la lista de pedido: productos (y cuántos agotados) bajo su mínimo */
  restock: { products: number; out: number; lines: number };
  out: { count: number; names: string[] };
  expiring: { count: number; list: { id: string; name: string; days: number }[] };
  no_price: number;
  debts: { total: number; customers: number; old: number; old_list: { name: string; customer_id: string | null; amount: number; days: number }[] };
}

export const todaySummary = (db: DB) => rpc<TodaySummary>(db, "today_summary");

interface Totals {
  total: number;
  profit: number;
  count: number;
}
export interface InsightsReport {
  period: Period;
  now: Totals;
  prev: Totals;
  per_day: { day: string; total: number; count: number }[];
  top_units: { product_id: string | null; name: string; units: number; revenue: number; stock: number | null }[];
  top_profit: { product_id: string | null; name: string; units: number; profit: number }[];
  top_customers: { id: string; name: string; total: number; count: number }[];
  margins: { id: string | null; name: string; icon: string | null; revenue: number; cost: number; profit: number; units: number }[];
  dead: { count: number; value: number; list: { id: string; name: string; stock: number; value: number; last_sale: string | null }[] };
  inventory: { sale: number; cost: number; units: number };
  by_category: { id: string | null; name: string; icon: string | null; units: number; sale: number }[];
}

/** Solo el dueño (la base lo rechaza para el vendedor). */
export const insightsReport = (db: DB, period: Period) => rpc<InsightsReport>(db, "insights_report", { p_period: period });

/** Lo que está bajo su mínimo (misma regla que la lista de pedido). */
export const restockLines = (db: DB) => rpc<{ product_id: string; variant_id: string | null; stock: number; min_stock: number }[]>(db, "restock_lines");
