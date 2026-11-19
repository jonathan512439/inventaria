"use client";

import type { Category, FieldTemplate, Product, ProductVariant, VariantAxis } from "@/types/database";
import { fieldLabel, getEffectiveFields, getValue, normalizeFieldName } from "./fields";
import { businessDayKey } from "./dates";

interface ExportArgs {
  products: Product[];
  categories: Category[];
  templates: FieldTemplate[];
  /** Nombre base del archivo, sin extensión */
  fileName?: string;
  /** Una hoja por categoría principal (con columna Subcategoría) o una sola hoja con todo */
  sheetPerCategory?: boolean;
  /** Variantes: una fila por variante (Talla, Color… con su stock y código) + hoja Resumen */
  variants?: ProductVariant[];
  axes?: VariantAxis[];
  /**
   * Fotos (026, bucket privado): la dirección guardada no abre fuera de la app. Con este mapa
   * (image_url → enlace firmado) la columna «Foto» dice «Ver foto» y abre la imagen; sin él solo dice «Sí».
   */
  photoLinks?: Map<string, string>;
}

/** Cuánto dura el enlace de la foto en el Excel descargado. */
const PHOTO_LINK_DAYS = 7;

const CODE_KEYS = ["codigo_barras", "codigo", "sku", "barcode", "ean"];
const hasCodeCol = (cols: { key: string }[]) => cols.some((c) => CODE_KEYS.includes(normalizeFieldName(c.key)));

/** Columnas de datos a exportar para un conjunto de productos: los datos definidos + cualquier clave presente. */
function columnsFor(products: Product[], categories: Category[], templates: FieldTemplate[]): { key: string; label: string; numeric: boolean }[] {
  const seen = new Map<string, { key: string; label: string; numeric: boolean }>();
  const add = (key: string, label: string, numeric: boolean) => {
    const norm = normalizeFieldName(key);
    if (!seen.has(norm)) seen.set(norm, { key, label, numeric });
  };
  // 1) datos definidos (en el orden del usuario) de cada categoría presente
  Array.from(new Set(products.map((p) => p.category_id))).forEach((catId) => {
    getEffectiveFields(templates, categories, catId).forEach((f) => add(f.name, fieldLabel(f.name), f.field_type === "number"));
  });
  // 2) claves que existen en los productos pero no tienen dato definido (categoría borrada, sin categoría…)
  products.forEach((p) => {
    Object.entries(p.data).forEach(([k, v]) => {
      if (v === null || v === undefined || v === "") return;
      add(k, fieldLabel(k), typeof v === "number");
    });
  });
  return Array.from(seen.values());
}

function topAndSub(categories: Category[], categoryId: string | null) {
  const cat = categoryId ? categories.find((c) => c.id === categoryId) ?? null : null;
  const top = cat?.parent_id ? categories.find((c) => c.id === cat.parent_id) ?? cat : cat;
  return { top: top?.name ?? "", sub: cat && cat.parent_id ? cat.name : "" };
}

function toCell(v: unknown, numeric: boolean): string | number {
  if (v === null || v === undefined || v === "") return "";
  if (numeric) {
    const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : String(v);
  }
  return typeof v === "number" ? v : String(v);
}

function rowFor(p: Product, cols: ReturnType<typeof columnsFor>, categories: Category[], v?: ProductVariant, axisLabels?: Map<string, string>, photoLinks?: Map<string, string>) {
  const { top, sub } = topAndSub(categories, p.category_id);
  const row: Record<string, string | number> = {
    Categoría: top || "Sin categoría",
    Subcategoría: sub,
    Estado: p.status === "draft" ? "Pendiente" : "En inventario",
  };
  cols.forEach((c) => (row[c.label] = toCell(getValue(p.data, c.key), c.numeric)));
  if (axisLabels) {
    row.Variante = v?.label ?? "";
    axisLabels.forEach((label, key) => (row[label] = v?.values[key] ?? ""));
    if (!hasCodeCol(cols)) row["Código de barras"] = v?.codigo_barras ?? "";
    if (v) {
      // La variante manda: su stock, su precio (si tiene) y su código
      cols.forEach((c) => {
        const n = normalizeFieldName(c.key);
        if (["stock", "cantidad", "existencias"].includes(n)) row[c.label] = v.stock;
        if (["precio", "precio_venta", "price"].includes(n) && v.precio !== null) row[c.label] = v.precio;
        if (CODE_KEYS.includes(n) && v.codigo_barras) row[c.label] = v.codigo_barras;
      });
    }
  }
  row["Etiqueta leída"] = p.ai_meta?.etiqueta ?? "";
  row["Modelo IA"] = p.ai_meta?.modelo ?? "";
  row.Foto = !p.image_url ? "" : photoLinks ? (photoLinks.has(p.image_url) ? "Ver foto" : "Sí") : "Sí";
  row.Creado = new Date(p.created_at).toLocaleString("es");
  return row;
}

function autoWidth(rows: Record<string, unknown>[], headers: string[]) {
  return headers.map((h) => ({
    wch: Math.min(60, Math.max(h.length, ...rows.map((r) => String(r[h] ?? "").length)) + 2),
  }));
}

export type XlsxLib = typeof import("xlsx");

/** Genera y descarga un .xlsx en el navegador con las columnas definidas por el usuario. */
export async function exportToExcel(args: ExportArgs) {
  // Carga bajo demanda: la librería (7 MB) no entra en el bundle del servidor ni en la carga inicial
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  addInventorySheets(XLSX, wb, { ...args, photoLinks: args.photoLinks ?? (await signPhotoLinks(args.products).catch(() => new Map<string, string>())) });
  const stamp = businessDayKey();
  XLSX.writeFile(wb, `${args.fileName ?? "inventario"}-${stamp}.xlsx`);
}

/** Enlaces firmados de las fotos (válidos {@link PHOTO_LINK_DAYS} días), pedidos de a 500. Si falla, el Excel sale igual con «Sí». */
async function signPhotoLinks(products: Product[]): Promise<Map<string, string>> {
  const [{ createClient }, { storagePath }] = await Promise.all([import("./supabase/client"), import("./photos")]);
  const byPath = new Map<string, string>(); // ruta en el bucket → image_url
  products.forEach((p) => {
    const path = storagePath(p.image_url);
    if (path && p.image_url) byPath.set(path, p.image_url);
  });
  const links = new Map<string, string>();
  const paths = Array.from(byPath.keys());
  const storage = createClient().storage.from("product-images");
  for (let i = 0; i < paths.length; i += 500) {
    const { data } = await storage.createSignedUrls(paths.slice(i, i + 500), PHOTO_LINK_DAYS * 86400);
    (data ?? []).forEach((d) => d.path && d.signedUrl && links.set(byPath.get(d.path)!, d.signedUrl));
  }
  // Fotos que no son del bucket (catálogo público): la dirección ya abre tal cual
  products.forEach((p) => p.image_url && !storagePath(p.image_url) && links.set(p.image_url, p.image_url));
  return links;
}

/** Añade al libro las hojas del inventario (Inventario o una por categoría, y Resumen si hay variantes). Sirve en navegador y en Node. */
export function addInventorySheets(XLSX: XlsxLib, wb: import("xlsx").WorkBook, { products, categories, templates, sheetPerCategory = false, variants = [], axes = [], photoLinks }: ExportArgs) {
  const usedNames = new Set<string>(wb.SheetNames);
  const variantsOf = new Map<string, ProductVariant[]>();
  variants.forEach((v) => variantsOf.set(v.product_id, [...(variantsOf.get(v.product_id) ?? []), v]));
  const hasVariants = products.some((p) => variantsOf.has(p.id));
  // Columnas por eje (Talla, Color…) presentes en las variantes exportadas
  const axisLabels = new Map<string, string>();
  if (hasVariants) {
    products.forEach((p) =>
      (variantsOf.get(p.id) ?? []).forEach((v) =>
        Object.keys(v.values).forEach((k) => {
          if (!axisLabels.has(k)) axisLabels.set(k, axes.find((a) => a.key === k)?.label ?? k[0].toUpperCase() + k.slice(1));
        })
      )
    );
  }

  const safeSheetName = (name: string) => {
    const base = name.replace(/[\\/?*[\]:]/g, " ").slice(0, 28) || "Hoja";
    let candidate = base;
    let i = 2;
    while (usedNames.has(candidate)) candidate = `${base.slice(0, 25)} ${i++}`;
    usedNames.add(candidate);
    return candidate;
  };

  const addSheet = (name: string, list: Product[]) => {
    const cols = columnsFor(list, categories, templates);
    const extra = hasVariants ? ["Variante", ...Array.from(axisLabels.values()), ...(hasCodeCol(cols) ? [] : ["Código de barras"])] : [];
    const headers = ["Categoría", "Subcategoría", "Estado", ...cols.map((c) => c.label), ...extra, "Etiqueta leída", "Modelo IA", "Foto", "Creado"];
    // Una fila por variante; el producto sin variantes va en una sola fila
    const rows = list.flatMap((p) => {
      const vs = variantsOf.get(p.id);
      return vs?.length ? vs.map((v) => rowFor(p, cols, categories, v, axisLabels, photoLinks)) : [rowFor(p, cols, categories, undefined, hasVariants ? axisLabels : undefined, photoLinks)];
    });
    const rowProducts = list.flatMap((p) => Array(Math.max(1, variantsOf.get(p.id)?.length ?? 0)).fill(p) as Product[]);
    const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
    if (photoLinks) {
      // «Ver foto» como enlace que se abre con un toque
      const col = XLSX.utils.encode_col(headers.indexOf("Foto"));
      rowProducts.forEach((p, i) => {
        const link = p.image_url ? photoLinks.get(p.image_url) : undefined;
        const c = ws[`${col}${i + 2}`];
        if (link && c) c.l = { Target: link, Tooltip: `Abre la foto (el enlace dura ${PHOTO_LINK_DAYS} días)` };
      });
    }
    ws["!cols"] = autoWidth(rows, headers);
    ws["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(headers.length - 1)}${rows.length + 1}` };
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(name));
  };

  if (sheetPerCategory) {
    // Agrupar por categoría PRINCIPAL (la subcategoría va en su columna)
    const byTop = new Map<string, Product[]>();
    products.forEach((p) => {
      const { top } = topAndSub(categories, p.category_id);
      const key = top || "Sin categoría";
      byTop.set(key, [...(byTop.get(key) ?? []), p]);
    });
    Array.from(byTop.entries())
      .sort(([a], [b]) => a.localeCompare(b, "es"))
      .forEach(([name, list]) => addSheet(name, list));
  } else {
    addSheet("Inventario", products);
  }

  if (hasVariants) {
    // Hoja Resumen: una fila por producto con sus variantes y stock total
    const rows = products.map((p) => {
      const { top, sub } = topAndSub(categories, p.category_id);
      const vs = variantsOf.get(p.id) ?? [];
      const stock = vs.length ? vs.reduce((s, v) => s + v.stock, 0) : Number(getValue(p.data, "stock") ?? 0) || 0;
      const price = Number(getValue(p.data, "precio") ?? 0) || 0;
      return {
        Producto: String(getValue(p.data, "nombre") ?? ""),
        Categoría: top || "Sin categoría",
        Subcategoría: sub,
        Variantes: vs.length,
        Detalle: vs.map((v) => `${v.label} (${v.stock})`).join(", "),
        Agotadas: vs.filter((v) => v.stock <= 0).map((v) => v.label).join(", "),
        "Stock total": stock,
        "Valor de venta": Math.round(stock * price * 100) / 100,
      };
    });
    const headers = ["Producto", "Categoría", "Subcategoría", "Variantes", "Detalle", "Agotadas", "Stock total", "Valor de venta"];
    const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
    ws["!cols"] = autoWidth(rows, headers);
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName("Resumen"));
  }

  if (wb.SheetNames.length === 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Sin productos"]]), "Inventario");
  }
}
