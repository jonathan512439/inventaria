"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Category, FieldTemplate, Product, ProductData, ProductStatus } from "@/types/database";
import { categoryPath } from "@/lib/categories";
import { coerceValue, fieldLabel, getEffectiveFields } from "@/lib/fields";
import { fmtMoney, priceOf, stockOf } from "@/lib/inventory";
import { categoryColor } from "@/lib/colors";
import { IconChevronRight } from "./ui/Icons";
import FieldInput from "./FieldInput";

interface Props {
  products: Product[];
  categories: Category[];
  templates: FieldTemplate[];
  mode: ProductStatus;
  onChanged: () => void;
}

/**
 * Tabla editable tipo hoja de cálculo. Agrupa por categoría (cada categoría tiene sus columnas).
 * Los cambios se mantienen en memoria hasta pulsar Guardar / Confirmar.
 */
export default function ProductTable({ products, categories, templates, mode, onChanged }: Props) {
  const supabase = createClient();
  const [edits, setEdits] = useState<Record<string, ProductData>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleGroup = (k: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  const groups = useMemo(() => {
    const map = new Map<string | null, Product[]>();
    products.forEach((p) => {
      const list = map.get(p.category_id) ?? [];
      list.push(p);
      map.set(p.category_id, list);
    });
    return Array.from(map.entries()).sort(([a], [b]) => categoryPath(categories, a).localeCompare(categoryPath(categories, b), "es"));
  }, [products, categories]);

  const getData = (p: Product): ProductData => ({ ...p.data, ...(edits[p.id] ?? {}) });
  const isDirty = (id: string) => !!edits[id];

  function setValue(p: Product, field: FieldTemplate, raw: string) {
    // texto tal cual mientras se edita (permite decimales); se convierte al guardar
    setEdits((prev) => ({ ...prev, [p.id]: { ...(prev[p.id] ?? {}), [field.name]: raw } }));
  }

  async function persist(p: Product, fields: FieldTemplate[], status?: ProductStatus) {
    setBusy((b) => ({ ...b, [p.id]: true }));
    setError(null);
    // Normaliza todos los campos según su tipo
    const merged = getData(p);
    const data: ProductData = { ...merged };
    fields.forEach((f) => (data[f.name] = coerceValue(f, merged[f.name])));
    const { error } = await supabase
      .from("products")
      .update({ data, ...(status ? { status } : {}) })
      .eq("id", p.id);
    setBusy((b) => ({ ...b, [p.id]: false }));
    if (error) return setError(error.message);
    setEdits((prev) => {
      const next = { ...prev };
      delete next[p.id];
      return next;
    });
    onChanged();
  }

  async function saveAll(list: Product[], fields: FieldTemplate[], status?: ProductStatus) {
    for (const p of list) {
      if (status || isDirty(p.id)) await persist(p, fields, status);
    }
  }

  async function remove(p: Product) {
    if (!confirm("¿Eliminar este producto? La foto también se borrará.")) return;
    setBusy((b) => ({ ...b, [p.id]: true }));
    // borra imagen (ruta = user_id/uuid.ext dentro del bucket)
    if (p.image_url) {
      const idx = p.image_url.indexOf("/product-images/");
      if (idx >= 0) await supabase.storage.from("product-images").remove([p.image_url.slice(idx + "/product-images/".length)]);
    }
    const { error } = await supabase.from("products").delete().eq("id", p.id);
    setBusy((b) => ({ ...b, [p.id]: false }));
    if (error) return setError(error.message);
    onChanged();
  }

  if (products.length === 0) {
    return (
      <div className="card text-sm text-slate-500">
        {mode === "draft" ? (
          <>Nada pendiente. <Link href="/capture" className="text-brand-600 underline">Toma una foto</Link> para empezar.</>
        ) : (
          <>Tu inventario está vacío.</>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-600">{error}</p>}
      {groups.map(([catId, list]) => {
        const fields = getEffectiveFields(templates, categories, catId);
        const dirtyCount = list.filter((p) => isDirty(p.id)).length;
        const cat = catId ? categories.find((c) => c.id === catId) ?? null : null;
        const top = cat?.parent_id ? categories.find((c) => c.id === cat.parent_id) ?? cat : cat;
        const col = categoryColor(top?.name);
        const key = catId ?? "none";
        const isCollapsed = collapsed.has(key);
        const units = list.reduce((s, p) => s + (stockOf(p) ?? 0), 0);
        const value = list.reduce((s, p) => s + (priceOf(p) ?? 0) * (stockOf(p) ?? 0), 0);
        return (
          <section key={key} className="card p-0" style={{ borderLeft: `5px solid ${col.dot}` }}>
            <header className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
              <button type="button" onClick={() => toggleGroup(key)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <IconChevronRight size={18} className={`shrink-0 text-slate-400 transition ${isCollapsed ? "" : "rotate-90"}`} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-ink">
                    {top && cat && cat.id !== top.id ? (
                      <><span className="text-slate-500">{top.icon ? `${top.icon} ` : ""}{top.name} › </span>{cat.name}</>
                    ) : (
                      <>{top?.icon ? `${top.icon} ` : ""}{categoryPath(categories, catId)}</>
                    )}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {list.length} producto{list.length === 1 ? "" : "s"} · {fmtMoney(units)} unid.{value ? ` · Bs ${fmtMoney(value)}` : ""}
                  </span>
                </span>
              </button>
              {dirtyCount > 0 && (
                <button className="btn-secondary btn-sm" onClick={() => saveAll(list, fields)}>
                  Guardar cambios ({dirtyCount})
                </button>
              )}
              {mode === "draft" && (
                <button className="btn-success btn-sm" onClick={() => confirm(`¿Pasar los ${list.length} productos de esta subcategoría al inventario?`) && saveAll(list, fields, "confirmed")}>
                  ✓ Confirmar todos
                </button>
              )}
            </header>

            {fields.length === 0 && (
              <p className="px-4 py-2 text-xs text-amber-700">
                Esta subcategoría no tiene datos definidos. <Link href="/templates" className="underline">Definir datos</Link>
              </p>
            )}

            {!isCollapsed && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-max text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2">Foto</th>
                    {fields.map((f) => (
                      <th key={f.id} className="px-2 py-2 font-medium">
                        {fieldLabel(f.name)} {f.is_ai_fillable && <span title="Lo llena la IA">✨</span>}
                      </th>
                    ))}
                    <th className="px-2 py-2">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {list.map((p) => {
                    const data = getData(p);
                    const dirty = isDirty(p.id);
                    const isBusy = !!busy[p.id];
                    return (
                      <tr key={p.id} className={dirty ? "bg-amber-50/50" : ""}>
                        <td className="sticky left-0 z-10 bg-white px-3 py-1.5">
                          <Link href={`/products/${p.id}`}>
                            {p.image_url ? (
                              <img src={p.image_url} alt="" className="h-12 w-12 rounded-md object-cover" loading="lazy" />
                            ) : (
                              <div className="h-12 w-12 rounded-md bg-slate-100" />
                            )}
                          </Link>
                        </td>
                        {fields.map((f) => (
                          <td key={f.id} className="px-1 py-1.5">
                            <FieldInput
                              field={f}
                              value={data[f.name]}
                              onChange={(v) => setValue(p, f, v)}
                              compact
                              className={`input rounded-xl ${f.field_type === "number" ? "w-24" : f.field_type === "select" ? "w-32" : "w-44"}`}
                            />
                          </td>
                        ))}
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-1">
                            {dirty && (
                              <button className="btn-secondary btn-sm" disabled={isBusy} onClick={() => persist(p, fields)}>
                                Guardar
                              </button>
                            )}
                            {mode === "draft" ? (
                              <button className="btn-success btn-sm" disabled={isBusy} onClick={() => persist(p, fields, "confirmed")}>
                                ✓ Confirmar
                              </button>
                            ) : (
                              <button className="btn-secondary btn-sm" disabled={isBusy} onClick={() => persist(p, fields, "draft")}>
                                ↩ Revisar de nuevo
                              </button>
                            )}
                            <Link href={`/products/${p.id}`} className="btn-secondary btn-sm">Abrir</Link>
                            <button className="btn-destructive btn-sm" disabled={isBusy} onClick={() => remove(p)}>Eliminar</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
