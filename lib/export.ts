"use client";

import * as XLSX from "xlsx";
import type { Category, FieldTemplate, Product } from "@/types/database";
import { fieldLabel, getEffectiveFields, getValue, normalizeFieldName } from "./fields";

interface ExportArgs {
  products: Product[];
  categories: Category[];
  templates: FieldTemplate[];
  /** Nombre base del archivo, sin extensión */
  fileName?: string;
  /** Una hoja por categoría principal (con columna Subcategoría) o una sola hoja con todo */
  sheetPerCategory?: boolean;
}

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

function rowFor(p: Product, cols: ReturnType<typeof columnsFor>, categories: Category[]) {
  const { top, sub } = topAndSub(categories, p.category_id);
  const row: Record<string, string | number> = {
    Categoría: top || "Sin categoría",
    Subcategoría: sub,
    Estado: p.status === "draft" ? "Pendiente" : "En inventario",
  };
  cols.forEach((c) => (row[c.label] = toCell(getValue(p.data, c.key), c.numeric)));
  row["Etiqueta leída"] = p.ai_meta?.etiqueta ?? "";
  row["Modelo IA"] = p.ai_meta?.modelo ?? "";
  row.Foto = p.image_url ?? "";
  row.Creado = new Date(p.created_at).toLocaleString("es");
  return row;
}

function autoWidth(rows: Record<string, unknown>[], headers: string[]) {
  return headers.map((h) => ({
    wch: Math.min(60, Math.max(h.length, ...rows.map((r) => String(r[h] ?? "").length)) + 2),
  }));
}

/** Genera y descarga un .xlsx en el navegador con las columnas definidas por el usuario. */
export function exportToExcel({ products, categories, templates, fileName = "inventario", sheetPerCategory = false }: ExportArgs) {
  const wb = XLSX.utils.book_new();
  const usedNames = new Set<string>();

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
    const headers = ["Categoría", "Subcategoría", "Estado", ...cols.map((c) => c.label), "Etiqueta leída", "Modelo IA", "Foto", "Creado"];
    const rows = list.map((p) => rowFor(p, cols, categories));
    const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
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

  if (wb.SheetNames.length === 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Sin productos"]]), "Inventario");
  }

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${fileName}-${stamp}.xlsx`);
}
