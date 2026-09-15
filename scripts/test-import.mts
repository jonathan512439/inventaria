/**
 * Prueba de la importación desde Excel (lógica pura, sin base): adivinar columnas, convertir filas,
 * detectar repetidos (mismo código / mismo nombre) y categorías que faltan.
 *   npm run test:import
 */
import * as XLSX from "xlsx";
import { buildRows, initialMapping, planImport } from "../lib/import";
import type { Category, Product } from "../types/database";

let failed = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? "OK  " : "FAIL"} ${msg}`); if (!ok) failed++; };

// Planilla "de la calle": títulos variados, precios con coma, código numérico, fecha en Excel
const sheet = XLSX.utils.aoa_to_sheet([
  ["Producto", "Rubro", "Sección", "Precio de venta", "Costo", "Cantidad", "Código", "Vence", "Proveedor"],
  ["Arroz Grano de Oro 1kg", "Abarrotes", "Granos", "8,50", 6, 10, 7770000000001, "31/12/2027", "Rios"],
  ["Coca Cola 2L", "Bebidas", "", 12, "9.5", "24", "", new Date(2027, 0, 15), ""],
  ["", "Bebidas", "", 5, 4, 1, "", "", ""],
  ["Coca Cola 2L", "Bebidas", "", 12, 9.5, 24, "", "", ""],
  ["Fideo Don Vittorio", "Abarrotes", "Pastas", "6", "4,2", 300, "", "sin fecha", ""],
  ["Leche Pil 1L", "Lácteos", "", 7, 5, 12, "", 46752, ""],
], { cellDates: true });
const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
const headers = Object.keys(raw[0]);
const mapping = initialMapping(headers);
check(mapping.Producto === "nombre" && mapping.Rubro === "categoria" && mapping["Sección"] === "subcategoria", "adivina Nombre, Categoría y Subcategoría");
check(mapping["Precio de venta"] === "precio" && mapping.Costo === "precio_compra" && mapping.Cantidad === "stock" && mapping["Código"] === "codigo_barras" && mapping.Vence === "expires_at", "adivina precio, costo, stock, código y vencimiento");
check(mapping.Proveedor === "otro", "una columna desconocida se guarda como «otro dato»");

const rows = buildRows(raw, mapping);
check(rows[0].data.precio === 8.5 && rows[0].data.precio_compra === 6 && rows[0].data.stock === 10, `números con coma y enteros: ${rows[0].data.precio} / ${rows[0].data.stock}`);
check(rows[0].data.codigo_barras === "7770000000001", `código numérico se guarda como texto: ${rows[0].data.codigo_barras}`);
check(rows[0].expires_at === "2027-12-31" && rows[1].expires_at === "2027-01-15" && rows[4].expires_at === null && rows[5].expires_at === "2027-12-31", `fechas (texto, Date, «sin fecha», número de Excel): ${rows[0].expires_at}, ${rows[1].expires_at}, ${rows[4].expires_at}, ${rows[5].expires_at}`);
check(rows[0].data.proveedor === "Rios", "el dato extra queda con la clave normalizada (proveedor)");
check(rows[2].error === "Sin nombre", "fila sin nombre se marca");

const cats: Category[] = [{ id: "c1", user_id: "u", name: "Abarrotes", parent_id: null, created_at: "", icon: null } as unknown as Category];
const products: Product[] = [
  { id: "p1", user_id: "u", category_id: "c1", status: "confirmed", data: { nombre: "Fideo don vittorio", precio: 5, stock: 2 }, ai_meta: {}, image_url: null, created_at: "", updated_at: "" },
  { id: "p2", user_id: "u", category_id: "c1", status: "confirmed", data: { nombre: "Arroz", precio: 7, stock: 1, codigo_barras: "7770000000001" }, ai_meta: {}, image_url: null, created_at: "", updated_at: "" },
];
const plan = planImport(rows, products, cats);
check(plan.creates.length === 2 && plan.creates[0].nombre === "Coca Cola 2L", `2 productos nuevos (Coca Cola, Leche)`);
check(plan.updates.length === 2 && plan.updates.some((u) => u.product.id === "p2" && u.motivo === "mismo código de barras") && plan.updates.some((u) => u.product.id === "p1" && u.motivo === "mismo nombre"), "2 coinciden: por código y por nombre (sin importar mayúsculas)");
check(plan.skipped.length === 2 && plan.skipped.some((r) => /Repetida/.test(r.error ?? "")), "se saltan la fila sin nombre y la repetida en la planilla");
const nc = plan.newCategories.map((c) => `${c.top}>${c.sub ?? ""}`).sort();
check(JSON.stringify(nc) === JSON.stringify(["Abarrotes>Granos", "Abarrotes>Pastas", "Bebidas>", "Lácteos>"]), `categorías nuevas: ${nc.join(", ")}`);

console.log(failed ? `\n${failed} fallo(s)` : "\nTodo OK");
process.exit(failed ? 1 : 0);
