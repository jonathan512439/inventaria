"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Category, FieldTemplate, VariantAxis } from "@/types/database";
import { getEffectiveFields, fieldLabel } from "@/lib/fields";
import PresetPicker from "@/components/PresetPicker";
import AxisEditor from "@/components/AxisEditor";
import { PRESETS } from "@/lib/presets";
import { useToast } from "@/components/ui/Toast";
import { IconArrowLeft, IconChevronRight, IconPlus, IconSparkles, IconTrash, IconX, Spinner } from "@/components/ui/Icons";
import { categoryColor } from "@/lib/colors";
import { findSibling, getDescendantIds } from "@/lib/categories";

/**
 * "Mi tienda": las categorías (tipos de producto) con sus subcategorías.
 * Reemplaza a la gestión manual de categorías/campos para el usuario común.
 */
export default function StorePage() {
  const supabase = createClient();
  const toast = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [templates, setTemplates] = useState<FieldTemplate[]>([]);
  const [axes, setAxes] = useState<VariantAxis[]>([]);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newSection, setNewSection] = useState<{ typeId: string; name: string } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<{ cat: Category; isType: boolean; moveTo: string | "" } | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  /** Subcategorías sin ningún producto (candidatas a limpieza). */
  const emptySubs = useMemo(() => categories.filter((c) => c.parent_id && !counts.get(c.id)), [categories, counts]);

  async function cleanEmpty() {
    if (!emptySubs.length) return;
    if (!confirm(`¿Eliminar ${emptySubs.length} subcategorías sin productos? (Las categorías principales se conservan.)`)) return;
    const { error } = await supabase.from("categories").delete().in("id", emptySubs.map((c) => c.id));
    if (error) return toast("error", error.message);
    toast("success", `${emptySubs.length} subcategorías vacías eliminadas`);
    load();
  }

  const load = useCallback(async () => {
    const [c, t, p, a] = await Promise.all([
      supabase.from("categories").select("*").order("name"),
      supabase.from("field_templates").select("*").order("sort_order"),
      supabase.from("products").select("category_id").is("deleted_at", null),
      supabase.from("variant_axes").select("*").order("sort_order"),
    ]);
    setCategories(c.data ?? []);
    setTemplates(t.data ?? []);
    setAxes((a.data ?? []) as VariantAxis[]);
    const m = new Map<string, number>();
    (p.data ?? []).forEach((x) => x.category_id && m.set(x.category_id, (m.get(x.category_id) ?? 0) + 1));
    setCounts(m);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const types = useMemo(() => categories.filter((c) => !c.parent_id), [categories]);
  const sectionsOf = (typeId: string) => categories.filter((c) => c.parent_id === typeId);
  const countOf = (typeId: string) => (counts.get(typeId) ?? 0) + sectionsOf(typeId).reduce((s, c) => s + (counts.get(c.id) ?? 0), 0);

  async function addSection() {
    if (!newSection || !newSection.name.trim()) return;
    const dup = findSibling(categories, newSection.typeId, newSection.name);
    if (dup) {
      setNewSection(null);
      return toast("info", `Ya existe la subcategoría “${dup.name}”`);
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from("categories").insert({ user_id: user!.id, name: newSection.name.trim(), parent_id: newSection.typeId });
    if (error) return toast("error", error.message);
    setNewSection(null);
    toast("success", "Subcategoría agregada");
    load();
  }

  async function rename() {
    if (!renaming || !renaming.name.trim()) return;
    const { error } = await supabase.from("categories").update({ name: renaming.name.trim() }).eq("id", renaming.id);
    if (error) return toast("error", error.message);
    setRenaming(null);
    load();
  }

  function remove(c: Category, isType: boolean) {
    setRemoving({ cat: c, isType, moveTo: "" });
  }

  /** Elimina la categoría/subcategoría; antes, si se eligió, mueve sus productos a otra. */
  async function confirmRemove() {
    if (!removing) return;
    setRemoveBusy(true);
    const ids = getDescendantIds(categories, removing.cat.id);
    if (removing.moveTo) {
      const { error } = await supabase.from("products").update({ category_id: removing.moveTo }).in("category_id", ids);
      if (error) {
        setRemoveBusy(false);
        return toast("error", error.message);
      }
    }
    const { error } = await supabase.from("categories").delete().eq("id", removing.cat.id);
    setRemoveBusy(false);
    if (error) return toast("error", error.message);
    toast("success", `"${removing.cat.name}" eliminada`);
    setRemoving(null);
    load();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header className="animate-in">
        <Link href="/settings" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"><IconArrowLeft size={16} /> Ajustes</Link>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Mi tienda</h1>
        <p className="text-sm text-slate-500">Lo que vendes, organizado en categorías y subcategorías. La IA usa esto para ordenar cada foto.</p>
      </header>

      {loading ? (
        <div className="flex justify-center py-10"><Spinner size={28} className="text-brand-500" /></div>
      ) : (
        <>
          {emptySubs.length >= 5 && (
            <div className="animate-in flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-sm">
              <span className="flex-1 text-slate-700">
                Tienes <b>{emptySubs.length} subcategorías sin productos</b>. Las vacías no ocupan casi espacio, pero ensucian el selector y el Excel.
              </span>
              <button onClick={cleanEmpty} className="btn-secondary btn-sm"><IconTrash size={14} /> Limpiar vacías</button>
            </div>
          )}
          {types.length === 0 && !adding && (
            <div className="animate-in card bg-gradient-to-br from-brand-600 to-violet-600 text-white ring-0">
              <p className="flex items-center gap-2 text-lg font-semibold"><IconSparkles className="text-amber-300" /> Empieza eligiendo qué vendes</p>
              <p className="mt-1 text-sm text-white/85">Cada categoría trae sus subcategorías y datos listos. Puedes elegir varias.</p>
              <button onClick={() => setAdding(true)} className="btn mt-4 w-full bg-white text-brand-700 hover:bg-brand-50">Elegir mis categorías</button>
            </div>
          )}

          {types.map((t) => {
            const secs = sectionsOf(t.id);
            const fields = getEffectiveFields(templates, categories, t.id);
            const ai = fields.filter((f) => f.is_ai_fillable).map((f) => fieldLabel(f.name));
            const manual = fields.filter((f) => !f.is_ai_fillable).map((f) => fieldLabel(f.name));
            return (
              <section key={t.id} className="animate-in card space-y-3" style={{ borderLeft: `4px solid ${categoryColor(t.name).dot}` }}>
                <div className="flex items-center gap-3">
                  <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-2xl ring-1 ${categoryColor(t.name).bg} ${categoryColor(t.name).ring}`}>{t.icon || "🏪"}</span>
                  <div className="min-w-0 flex-1">
                    {renaming?.id === t.id ? (
                      <div className="flex gap-2">
                        <input className="input py-1.5" value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} autoFocus onKeyDown={(e) => e.key === "Enter" && rename()} />
                        <button className="btn-primary btn-sm" onClick={rename}>OK</button>
                        <button className="btn-ghost btn-sm" onClick={() => setRenaming(null)}><IconX size={14} /></button>
                      </div>
                    ) : (
                      <>
                        <button className="block truncate text-left text-lg font-bold text-ink hover:text-brand-700" onClick={() => setRenaming({ id: t.id, name: t.name })} title="Cambiar nombre">{t.name}</button>
                        <p className="text-xs text-slate-500">{secs.length} subcategorías · {countOf(t.id)} productos</p>
                      </>
                    )}
                  </div>
                  <button className="btn-destructive btn-sm shrink-0" onClick={() => remove(t, true)}><IconTrash size={16} /> Eliminar</button>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {secs.map((s) => (
                    <span key={s.id} className="chip group gap-1 pr-1.5">
                      {renaming?.id === s.id ? (
                        <input className="w-28 bg-transparent outline-none" value={renaming.name} autoFocus onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} onKeyDown={(e) => (e.key === "Enter" ? rename() : e.key === "Escape" ? setRenaming(null) : null)} onBlur={rename} />
                      ) : (
                        <button onClick={() => setRenaming({ id: s.id, name: s.name })} title="Cambiar nombre">{s.name}</button>
                      )}
                      {counts.get(s.id) ? <span className="text-xs text-slate-400">{counts.get(s.id)}</span> : null}
                      <button onClick={() => remove(s, false)} className="rounded-full p-0.5 text-slate-300 hover:bg-rose-50 hover:text-rose-600" title="Eliminar subcategoría"><IconX size={12} /></button>
                    </span>
                  ))}
                  {newSection?.typeId === t.id ? (
                    <span className="chip border-brand-400 gap-1 pr-1.5">
                      <input className="w-32 bg-transparent outline-none" placeholder="Nombre de la subcategoría" value={newSection.name} autoFocus onChange={(e) => setNewSection({ ...newSection, name: e.target.value })} onKeyDown={(e) => (e.key === "Enter" ? addSection() : e.key === "Escape" ? setNewSection(null) : null)} />
                      <button onClick={addSection} className="rounded-full bg-brand-600 p-0.5 text-white"><IconPlus size={12} /></button>
                    </span>
                  ) : (
                    <button onClick={() => setNewSection({ typeId: t.id, name: "" })} className="chip border-dashed text-brand-700"><IconPlus size={14} /> Subcategoría</button>
                  )}
                </div>

                <div className="rounded-2xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <p><span className="font-semibold text-brand-700">✨ La IA llena:</span> {ai.join(", ") || "—"}</p>
                  <p className="mt-0.5"><span className="font-semibold text-slate-700">Tú llenas:</span> {manual.join(", ") || "—"}</p>
                  <Link href={`/templates?scope=${t.id}`} className="mt-1 inline-flex items-center gap-0.5 font-medium text-brand-600 hover:underline">
                    Ajustar datos <IconChevronRight size={12} />
                  </Link>
                </div>

                <AxisEditor categoryId={t.id} axes={axes.filter((a) => a.category_id === t.id)} suggested={PRESETS.find((p) => p.name.toLowerCase() === t.name.toLowerCase())?.axes} onChanged={load} />

                <label className="flex items-center gap-2 rounded-2xl bg-orange-50 px-3 py-2 text-xs text-orange-900">
                  <span className="flex-1"><b>Stock mínimo</b> por defecto para los productos de esta categoría (aviso «por reponer»)</span>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    className="input w-20 py-1 text-center text-sm font-bold tabular-nums"
                    placeholder="3"
                    defaultValue={t.min_stock_default ?? ""}
                    onBlur={async (e) => {
                      const v = e.target.value.trim() === "" ? null : Math.max(0, parseInt(e.target.value, 10) || 0);
                      if (v === (t.min_stock_default ?? null)) return;
                      const { error } = await supabase.from("categories").update({ min_stock_default: v }).eq("id", t.id);
                      if (error) return toast("error", error.message);
                      toast("success", v === null ? "Mínimo por defecto quitado (se usa 3)" : `Mínimo por defecto: ${v}`);
                      load();
                    }}
                  />
                </label>
              </section>
            );
          })}

          {adding ? (
            <div className="animate-in card space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-bold">Agregar categoría</h2>
                <button className="btn-ghost btn-sm" onClick={() => setAdding(false)}><IconX size={16} /></button>
              </div>
              <PresetPicker
                existingNames={types.map((t) => t.name)}
                submitLabel="Agregar"
                onDone={({ types: added }) => {
                  setAdding(false);
                  toast("success", added.length ? `Agregado: ${added.join(", ")}` : "Listo");
                  load();
                }}
              />
            </div>
          ) : (
            types.length > 0 && (
              <button onClick={() => setAdding(true)} className="btn-secondary w-full"><IconPlus size={18} /> Agregar categoría</button>
            )
          )}

          {removing && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setRemoving(null)}>
              <div className="absolute inset-0 bg-black/45" />
              <div className="animate-in relative w-full max-w-md space-y-4 rounded-3xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <h2 className="text-lg font-bold text-ink">
                  Eliminar {removing.isType ? "categoría" : "subcategoría"} “{removing.cat.name}”
                </h2>
                {(() => {
                  const ids = getDescendantIds(categories, removing.cat.id);
                  const n = ids.reduce((s, id) => s + (counts.get(id) ?? 0), 0);
                  const own = templates.filter((t) => t.category_id && ids.includes(t.category_id));
                  return (
                    <div className="space-y-3 text-sm text-slate-700">
                      {removing.isType && sectionsOf(removing.cat.id).length > 0 && (
                        <p>Se eliminarán también sus <b>{sectionsOf(removing.cat.id).length} subcategorías</b>.</p>
                      )}
                      {own.length > 0 && (
                        <p className="rounded-2xl bg-amber-50 p-3 text-amber-900">
                          Se borrará la definición de estos datos: <b>{own.map((t) => fieldLabel(t.name)).join(", ")}</b>. Los valores ya guardados en los productos se conservan y siguen saliendo en el Excel.
                        </p>
                      )}
                      {n > 0 ? (
                        <div>
                          <p className="mb-1.5">
                            Tiene <b>{n} producto{n === 1 ? "" : "s"}</b>. ¿Qué hacemos con ellos?
                          </p>
                          <select className="input" value={removing.moveTo} onChange={(e) => setRemoving({ ...removing, moveTo: e.target.value })}>
                            <option value="">Dejarlos sin categoría</option>
                            {categories
                              .filter((c) => !ids.includes(c.id))
                              .map((c) => {
                                const top = c.parent_id ? categories.find((x) => x.id === c.parent_id) : null;
                                return (
                                  <option key={c.id} value={c.id}>
                                    Mover a: {top ? `${top.name} › ` : ""}{c.name}
                                  </option>
                                );
                              })}
                          </select>
                        </div>
                      ) : (
                        <p>No tiene productos.</p>
                      )}
                    </div>
                  );
                })()}
                <div className="flex gap-2">
                  <button onClick={() => setRemoving(null)} className="btn-secondary flex-1">Cancelar</button>
                  <button onClick={confirmRemove} disabled={removeBusy} className="btn-danger flex-1 bg-rose-600 text-white hover:bg-rose-700">
                    {removeBusy ? <Spinner /> : <IconTrash size={16} />} Eliminar
                  </button>
                </div>
              </div>
            </div>
          )}

          <p className="text-center text-xs text-slate-400">
            ¿Necesitas algo más detallado?{" "}
            <Link href="/categories" className="underline">Subcategorías avanzadas</Link> · <Link href="/templates" className="underline">Datos avanzados</Link>
          </p>
        </>
      )}
    </div>
  );
}
