"use client";

import * as XLSX from "xlsx";
import type { Category, FieldTemplate, Product } from "@/types/database";
import { categoryPath } from "./categories";
import { getEffectiveFields } from "./fields";

interface ExportArgs {
  products: Product[];
  categories: Category[];
  templates: FieldTemplate[];
  /** Nombre base del archivo, sin extensión */
  fileName?: string;
  /** Una hoja por categoría (columnas exactas de cada una) o una sola hoja con la unión de columnas */
  sheetPerCategory?: boolean;
}

const FIXED_COLS = ["Sección", "Estado", "Foto", "Creado"] as const;

function rowFor(p: Product, fields: FieldTemplate[], categories: Category[]) {
  const row: Record<string, string | number> = {
    Sección: categoryPath(categories, p.category_id),
    Estado: p.status === "draft" ? "Pendiente" : "En inventario",
  };
  fields.forEach((f) => {
    const v = p.data[f.name];
    row[f.name] = v === null || v === undefined ? "" : v;
  });
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
    let base = name.replace(/[\\/?*[\]:]/g, " ").slice(0, 28) || "Hoja";
    let candidate = base;
    let i = 2;
    while (usedNames.has(candidate)) candidate = `${base.slice(0, 25)} ${i++}`;
    usedNames.add(candidate);
    return candidate;
  };

  const addSheet = (name: string, list: Product[], fields: FieldTemplate[]) => {
    const headers = [FIXED_COLS[0], FIXED_COLS[1], ...fields.map((f) => f.name), FIXED_COLS[2], FIXED_COLS[3]];
    const rows = list.map((p) => rowFor(p, fields, categories));
    const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
    ws["!cols"] = autoWidth(rows, headers);
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(name));
  };

  if (sheetPerCategory) {
    const byCat = new Map<string | null, Product[]>();
    products.forEach((p) => byCat.set(p.category_id, [...(byCat.get(p.category_id) ?? []), p]));
    byCat.forEach((list, catId) => {
      const fields = getEffectiveFields(templates, categories, catId);
      addSheet(catId ? (categories.find((c) => c.id === catId)?.name ?? "Sección") : "Sin sección", list, fields);
    });
  } else {
    // Unión de campos de todas las categorías presentes, sin duplicar nombres
    const seen = new Set<string>();
    const union: FieldTemplate[] = [];
    const catIds = Array.from(new Set(products.map((p) => p.category_id)));
    catIds.forEach((catId) => {
      getEffectiveFields(templates, categories, catId).forEach((f) => {
        if (!seen.has(f.name)) {
          seen.add(f.name);
          union.push(f);
        }
      });
    });
    addSheet("Inventario", products, union);
  }

  if (wb.SheetNames.length === 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Sin productos"]]), "Inventario");
  }

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${fileName}-${stamp}.xlsx`);
}
