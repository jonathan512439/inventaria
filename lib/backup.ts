import type { Category, FieldTemplate, Product, ProductVariant, VariantAxis } from "@/types/database";
import { addInventorySheets, type XlsxLib } from "./export";

/**
 * Respaldo completo: un solo .xlsx con todas las tablas del negocio (inventario con sus columnas,
 * ventas, clientes, abonos, entregas, movimientos, compras, conteos, caja, historial de precios, equipo).
 * Sirve en el navegador («Guardar respaldo ahora») y en Node (respaldo automático semanal).
 */

type Row = Record<string, unknown>;
/** Trae TODAS las filas de una tabla (con paginación) ya filtradas por negocio. */
export type Fetcher = (table: string) => Promise<Row[]>;

export const BACKUP_TABLES = [
  "categories",
  "field_templates",
  "products",
  "product_variants",
  "variant_axes",
  "stock_movements",
  "sales",
  "sale_items",
  "customers",
  "payments",
  "consignments",
  "consignment_items",
  "cash_movements",
  "cash_closings",
  "suppliers",
  "purchases",
  "purchase_items",
  "stock_counts",
  "stock_count_items",
  "price_history",
  "member_names",
] as const;

/** Columnas a exportar por tabla, en orden, con su título en español. */
const SHEETS: { table: (typeof BACKUP_TABLES)[number]; name: string; cols: [string, string][] }[] = [
  { table: "sales", name: "Ventas", cols: [["number", "N.º"], ["created_at", "Fecha"], ["customer_name", "Cliente"], ["status", "Estado"], ["method", "Pago"], ["subtotal", "Subtotal"], ["discount", "Descuento"], ["total", "Total"], ["paid", "Pagado"], ["cost_total", "Costo"], ["items", "Productos"], ["note", "Nota"], ["user_id", "Atendió"], ["id", "Id"]] },
  { table: "sale_items", name: "Detalle de ventas", cols: [["sale_id", "Venta"], ["created_at", "Fecha"], ["product_name", "Producto"], ["variant_label", "Variante"], ["qty", "Cantidad"], ["unit_price", "Precio"], ["unit_cost", "Costo"], ["line_total", "Total"], ["product_id", "Id producto"]] },
  { table: "customers", name: "Clientes", cols: [["name", "Nombre"], ["phone", "Teléfono"], ["credit_limit", "Límite de fiado"], ["note", "Nota"], ["created_at", "Desde"], ["deleted_at", "Borrado el"], ["id", "Id"]] },
  { table: "payments", name: "Abonos", cols: [["created_at", "Fecha"], ["customer_id", "Cliente (id)"], ["amount", "Monto"], ["method", "Pago"], ["note", "Nota"], ["user_id", "Atendió"]] },
  { table: "consignments", name: "Entregas", cols: [["created_at", "Fecha"], ["customer_name", "Cliente"], ["status", "Estado"], ["closed_at", "Liquidada el"], ["note", "Nota"], ["id", "Id"]] },
  { table: "consignment_items", name: "Detalle de entregas", cols: [["consignment_id", "Entrega"], ["product_name", "Producto"], ["variant_label", "Variante"], ["qty_out", "Entregado"], ["qty_sold", "Vendido"], ["qty_returned", "Devuelto"], ["unit_price", "Precio"]] },
  { table: "stock_movements", name: "Movimientos", cols: [["created_at", "Fecha"], ["tipo", "Tipo"], ["product_name", "Producto"], ["variant_label", "Variante"], ["cantidad", "Cantidad"], ["precio_unitario", "Precio"], ["total", "Total"], ["motivo", "Motivo"], ["stock_resultante", "Stock después"], ["user_id", "Quién"], ["product_id", "Id producto"]] },
  { table: "purchases", name: "Compras", cols: [["created_at", "Fecha"], ["supplier_name", "Proveedor"], ["doc", "Documento"], ["total", "Total"], ["items", "Productos"], ["note", "Nota"], ["id", "Id"]] },
  { table: "purchase_items", name: "Detalle de compras", cols: [["purchase_id", "Compra"], ["product_name", "Producto"], ["variant_label", "Variante"], ["qty", "Cantidad"], ["unit_cost", "Costo"], ["expires_at", "Vence"]] },
  { table: "suppliers", name: "Proveedores", cols: [["name", "Nombre"], ["phone", "Teléfono"], ["note", "Nota"], ["created_at", "Desde"]] },
  { table: "stock_counts", name: "Conteos", cols: [["started_at", "Inicio"], ["closed_at", "Cierre"], ["category_name", "Categoría"], ["items", "Contados"], ["differences", "Diferencias"], ["diff_units", "Unidades de diferencia"], ["note", "Nota"], ["user_id", "Quién"]] },
  { table: "stock_count_items", name: "Detalle de conteos", cols: [["count_id", "Conteo"], ["product_name", "Producto"], ["variant_label", "Variante"], ["expected", "Había"], ["counted", "Contado"], ["reason", "Motivo"]] },
  { table: "cash_closings", name: "Cierres de caja", cols: [["day", "Día"], ["sales_count", "Ventas"], ["total_sales", "Vendido"], ["by_method", "Por medio de pago"], ["cash_in", "Ingresos"], ["cash_out", "Retiros"], ["expected_cash", "Debía haber"], ["counted_cash", "Contado"], ["difference", "Diferencia"], ["profit", "Ganancia"], ["note", "Nota"], ["closed_at", "Cerrado el"], ["user_id", "Quién"]] },
  { table: "cash_movements", name: "Caja ingresos y retiros", cols: [["created_at", "Fecha"], ["tipo", "Tipo"], ["amount", "Monto"], ["note", "Nota"], ["user_id", "Quién"]] },
  { table: "price_history", name: "Historial de precios", cols: [["created_at", "Fecha"], ["product_id", "Id producto"], ["variant_id", "Id variante"], ["field", "Precio"], ["old_value", "Antes"], ["new_value", "Después"], ["source", "Origen"]] },
  { table: "categories", name: "Categorías", cols: [["name", "Nombre"], ["parent_id", "Pertenece a (id)"], ["icon", "Ícono"], ["alerts_off", "Sin avisos"], ["id", "Id"]] },
  { table: "field_templates", name: "Datos definidos", cols: [["name", "Dato"], ["field_type", "Tipo"], ["category_id", "Categoría (id)"], ["is_ai_fillable", "Lo llena la IA"], ["options", "Opciones"], ["default_value", "Por defecto"], ["sort_order", "Orden"]] },
  { table: "variant_axes", name: "Ejes de variantes", cols: [["category_id", "Categoría (id)"], ["key", "Clave"], ["label", "Nombre"], ["options", "Opciones"]] },
  { table: "member_names", name: "Equipo", cols: [["name", "Nombre"], ["role", "Rol"], ["active", "Activo"], ["user_id", "Id"]] },
];

const cell = (v: unknown): string | number | boolean => {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") return /^\d{4}-\d{2}-\d{2}T/.test(v) ? v.replace("T", " ").slice(0, 16) : v;
  return JSON.stringify(v);
};

/** Arma el libro completo del respaldo. `fetch` trae cada tabla ya filtrada por el negocio (RLS en el navegador; business_id en Node). */
export async function buildBackupWorkbook(XLSX: XlsxLib, fetch: Fetcher, businessName: string): Promise<{ wb: import("xlsx").WorkBook; counts: Record<string, number> }> {
  const data: Record<string, Row[]> = {};
  for (const t of BACKUP_TABLES) data[t] = await fetch(t);
  const names = new Map((data.member_names ?? []).map((m) => [String(m.user_id), String(m.name)]));
  const wb = XLSX.utils.book_new();

  // Portada
  const counts: Record<string, number> = {};
  BACKUP_TABLES.forEach((t) => (counts[t] = data[t].length));
  const cover = [
    ["InventarIA · respaldo completo"],
    ["Negocio", businessName],
    ["Fecha", new Date().toISOString().replace("T", " ").slice(0, 16)],
    [],
    ["Hoja", "Filas"],
    ["Inventario", counts.products],
    ...SHEETS.map((s) => [s.name, counts[s.table]]),
    [],
    ["Cómo volver a cargar el inventario: Ajustes → Importar desde Excel con la hoja «Inventario»."],
  ];
  const wsCover = XLSX.utils.aoa_to_sheet(cover);
  wsCover["!cols"] = [{ wch: 26 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsCover, "Respaldo");

  // Inventario con las columnas del usuario (mismo formato que Exportar a Excel)
  const products = (data.products as unknown as Product[]).filter((p) => !p.deleted_at);
  addInventorySheets(XLSX, wb, {
    products,
    categories: data.categories as unknown as Category[],
    templates: data.field_templates as unknown as FieldTemplate[],
    variants: data.product_variants as unknown as ProductVariant[],
    axes: data.variant_axes as unknown as VariantAxis[],
  });
  const trash = (data.products as unknown as Product[]).filter((p) => p.deleted_at);
  if (trash.length) {
    const ws = XLSX.utils.json_to_sheet(trash.map((p) => ({ Producto: String(p.data.nombre ?? ""), "Borrado el": cell(p.deleted_at), Datos: JSON.stringify(p.data), Id: p.id })));
    XLSX.utils.book_append_sheet(wb, ws, "Papelera");
  }

  // El resto de tablas, con títulos en español y nombres del equipo en vez de ids
  for (const s of SHEETS) {
    const rows = data[s.table].map((r) => {
      const o: Record<string, string | number | boolean> = {};
      s.cols.forEach(([k, label]) => (o[label] = k === "user_id" ? names.get(String(r[k])) ?? cell(r[k]) : cell(r[k])));
      return o;
    });
    const headers = s.cols.map(([, label]) => label);
    const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
    ws["!cols"] = headers.map((h) => ({ wch: Math.min(40, Math.max(h.length, ...rows.slice(0, 200).map((r) => String(r[h] ?? "").length)) + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  return { wb, counts };
}

/** Nombre del archivo de respaldo: fecha + origen (auto = semanal, manual = botón). */
export function backupFileName(kind: "auto" | "manual", when = new Date()) {
  return `${when.toISOString().slice(0, 10)}-${kind}.xlsx`;
}
