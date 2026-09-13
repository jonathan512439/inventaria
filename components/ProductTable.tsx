"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Category, FieldTemplate, Product, ProductData, ProductStatus } from "@/types/database";
import { categoryPath } from "@/lib/categories";
import { coerceValue, getEffectiveFields } from "@/lib/fields";
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
    setEdits((prev) => ({ ...prev, [p.id]: { ...(prev[p.id] ?? {}), [field.name]: coerceValue(field, raw) } }));
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
          <>No hay borradores. <Link href="/capture" className="text-brand-600 underline">Toma una foto</Link> para crear uno.</>
        ) : (
          <>Aún no hay productos confirmados.</>
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
        return (
          <section key={catId ?? "none"} className="card p-0">
            <header className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
              <h2 className="flex-1 text-sm font-semibold">
                {categoryPath(categories, catId)} <span className="font-normal text-slate-500">({list.length})</span>
              </h2>
              {dirtyCount > 0 && (
                <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => saveAll(list, fields)}>
                  Guardar cambios ({dirtyCount})
                </button>
              )}
              {mode === "draft" && (
                <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => confirm(`¿Confirmar los ${list.length} productos de esta categoría?`) && saveAll(list, fields, "confirmed")}>
                  ✓ Confirmar todos
                </button>
              )}
            </header>

            {fields.length === 0 && (
              <p className="px-4 py-2 text-xs text-amber-700">
                Esta categoría no tiene campos definidos. <Link href="/templates" className="underline">Definir campos</Link>
              </p>
            )}

            <div className="overflow-x-auto">
              <table className="w-full min-w-max text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2">Foto</th>
                    {fields.map((f) => (
                      <th key={f.id} className="px-2 py-2 font-medium">
                        {f.name} {f.is_ai_fillable && <span title="Rellenado por IA">✨</span>}
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
                              className={`input ${f.field_type === "number" ? "w-24" : f.field_type === "select" ? "w-32" : "w-44"}`}
                            />
                          </td>
                        ))}
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-1">
                            {dirty && (
                              <button className="btn-secondary px-2 py-1 text-xs" disabled={isBusy} onClick={() => persist(p, fields)}>
                                Guardar
                              </button>
                            )}
                            {mode === "draft" ? (
                              <button className="btn-primary px-2 py-1 text-xs" disabled={isBusy} onClick={() => persist(p, fields, "confirmed")}>
                                ✓ Confirmar
                              </button>
                            ) : (
                              <button className="btn-ghost px-2 py-1 text-xs" disabled={isBusy} onClick={() => persist(p, fields, "draft")}>
                                ↩ Borrador
                              </button>
                            )}
                            <Link href={`/products/${p.id}`} className="btn-ghost px-2 py-1 text-xs">Ver</Link>
                            <button className="btn-ghost px-2 py-1 text-xs text-red-600" disabled={isBusy} onClick={() => remove(p)}>✕</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
