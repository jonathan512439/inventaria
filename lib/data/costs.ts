import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Product } from "@/types/database";

/**
 * Costos (025 · Fase 6.9 C5.2): el precio de compra ya NO está en `products.data` (allí lo leía cualquier miembro);
 * vive en `product_costs`, que solo el dueño puede leer. Para las pantallas del dueño que editan o muestran el
 * producto completo (ficha, tabla, Revisar, categoría, exportar), se vuelve a poner como `data.precio_compra`.
 * Al vendedor la consulta le devuelve 0 filas: sus productos quedan sin costo.
 * Guardar funciona igual: si el dueño manda `data.precio_compra`, la base lo pasa a product_costs.
 */
export async function withCosts<T extends Pick<Product, "id" | "data">>(db: SupabaseClient<Database>, products: T[]): Promise<T[]> {
  if (!products.length) return products;
  const costs = new Map<string, number>();
  const ids = products.map((p) => p.id);
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await db.from("product_costs").select("product_id,cost").is("variant_id", null).in("product_id", ids.slice(i, i + 300));
    (data ?? []).forEach((c) => costs.set(c.product_id, Number(c.cost)));
  }
  if (!costs.size) return products;
  return products.map((p) => (costs.has(p.id) ? { ...p, data: { ...p.data, precio_compra: costs.get(p.id)! } } : p));
}
