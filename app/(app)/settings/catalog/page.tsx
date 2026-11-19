"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Category, FieldTemplate, VariantAxis } from "@/types/database";
import { fieldLabel, getEffectiveFields } from "@/lib/fields";
import { findSibling, getDescendantIds } from "@/lib/categories";
import { categoryColor } from "@/lib/colors";
import { PRESETS } from "@/lib/presets";
import { friendlyError } from "@/lib/errors";
import PresetPicker from "@/components/PresetPicker";
import AxisEditor from "@/components/AxisEditor";
import OwnerOnly from "@/components/OwnerOnly";
import FieldsEditor from "@/components/settings/FieldsEditor";
import Sheet from "@/components/ui/Sheet";
import { EmptyState, ScreenHeader } from "@/components/ui/Screen";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { IconChevronRight, IconEdit, IconList, IconPlus, IconSparkles, IconTrash, Spinner } from "@/components/ui/Icons";

/**
 * Mi catálogo (C7.8 · RECONSTRUCCION_VISUAL.md §3.2, F15 + F14): un árbol único Categoría → Subcategorías y, en
 * cada categoría, sus **Datos** (campos, quién los llena) y **Variantes** (talla, color…). Reemplaza a
 * /store («Mi tienda»), /categories y /templates. El mínimo por categoría vive en Ajustes › Avisos.
 */
export default function CatalogPage() {
  const supabase = createClient();
  const toast = useToast();
  const ask = useConfirm();
  const [categories, setCategories] = useState<Category[]>([]);
  const [templates, setTemplates] = useState<FieldTemplate[]>([]);
  const [axes, setAxes] = useState<VariantAxis[]>([]);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [general, setGeneral] = useState(false);
  const [adding, setAdding] = useState(false);
  /** Editar una categoría o subcategoría: nombre, dónde va (solo subcategorías) y sus datos propios */
  const [editing, setEditing] = useState<{ cat: Category; name: string; parent: string | null } | null>(null);
  const [newSub, setNewSub] = useState<{ parent: Category; name: string } | null>(null);
  const [removing, setRemoving] = useState<{ cat: Category; moveTo: string } | null>(null);
  const [busy, setBusy] = useState(false);

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
  const subsOf = (id: string) => categories.filter((c) => c.parent_id === id);
  const countOf = (id: string) => getDescendantIds(categories, id).reduce((s, x) => s + (counts.get(x) ?? 0), 0);
  const emptySubs = categories.filter((c) => c.parent_id && !counts.get(c.id));

  async function cleanEmpty() {
    const ok = await ask({
      title: "¿Quitar las subcategorías vacías?",
      body: "Solo se quitan las que no tienen ningún producto. Las categorías principales se conservan.",
      details: [{ label: "Subcategorías que se quitan", value: String(emptySubs.length), tone: "warn" }],
      confirmLabel: "Sí, quitar",
      tone: "danger",
    });
    if (!ok) return;
    const { error } = await supabase.from("categories").delete().in("id", emptySubs.map((c) => c.id));
    if (error) return toast("error", friendlyError(error));
    toast("success", `${emptySubs.length} subcategorías vacías quitadas`);
    load();
  }

  async function addSub() {
    if (!newSub || !newSub.name.trim()) return;
    const dup = findSibling(categories, newSub.parent.id, newSub.name);
    if (dup) {
      setNewSub(null);
      return toast("info", `Ya existe la subcategoría «${dup.name}»`);
    }
    const uid = (await supabase.auth.getUser()).data.user?.id ?? "";
    const { error } = await supabase.from("categories").insert({ user_id: uid, name: newSub.name.trim(), parent_id: newSub.parent.id });
    if (error) return toast("error", friendlyError(error));
    setNewSub(null);
    toast("success", "Subcategoría agregada");
    load();
  }

  async function saveEdit() {
    if (!editing || !editing.name.trim()) return;
    setBusy(true);
    const patch: { name: string; parent_id?: string | null } = { name: editing.name.trim() };
    if (editing.cat.parent_id) patch.parent_id = editing.parent;
    const { error } = await supabase.from("categories").update(patch).eq("id", editing.cat.id);
    setBusy(false);
    if (error) return toast("error", friendlyError(error));
    setEditing(null);
    load();
  }

  async function confirmRemove() {
    if (!removing) return;
    setBusy(true);
    const ids = getDescendantIds(categories, removing.cat.id);
    if (removing.moveTo) {
      const { error } = await supabase.from("products").update({ category_id: removing.moveTo }).in("category_id", ids);
      if (error) {
        setBusy(false);
        return toast("error", friendlyError(error));
      }
    }
    const { error } = await supabase.from("categories").delete().eq("id", removing.cat.id);
    setBusy(false);
    if (error) return toast("error", friendlyError(error));
    toast("success", `«${removing.cat.name}» eliminada`);
    setRemoving(null);
    setEditing(null);
    load();
  }

  const removeInfo = (() => {
    if (!removing) return null;
    const ids = getDescendantIds(categories, removing.cat.id);
    return {
      ids,
      products: ids.reduce((s, id) => s + (counts.get(id) ?? 0), 0),
      subs: subsOf(removing.cat.id).length,
      fields: templates.filter((t) => t.category_id && ids.includes(t.category_id)),
    };
  })();

  return (
    <OwnerOnly>
      <div className="mx-auto max-w-2xl space-y-4">
        <ScreenHeader
          title="Mi catálogo"
          subtitle="Lo que vendes en categorías y subcategorías, con sus datos y variantes. La IA lo usa para ordenar cada foto."
          back={{ href: "/settings", label: "Ajustes" }}
          help={
            <>
              <p>Toca una categoría para abrirla: ahí están sus <b>subcategorías</b>, sus <b>datos</b> (qué se guarda de cada producto y si lo llena la IA) y sus <b>variantes</b> (talla, color…).</p>
              <p>Toca una subcategoría para cambiarle el nombre, pasarla a otra categoría o darle datos propios.</p>
              <p>Cuándo avisar que falta stock se ajusta en <b>Ajustes › Avisos</b>.</p>
            </>
          }
        />

        {loading ? (
          <ListSkeleton rows={4} />
        ) : (
          <>
            {types.length === 0 && (
              <EmptyState icon={<IconSparkles size={28} />} title="Empieza eligiendo qué vendes" body="Cada categoría trae sus subcategorías y datos listos. Puedes elegir varias." action={<button type="button" onClick={() => setAdding(true)} className="btn-primary">Elegir mis categorías</button>} />
            )}

            {emptySubs.length >= 5 && (
              <div className="animate-in flex flex-wrap items-center gap-3 rounded-2xl bg-white p-3 text-sm ring-1 ring-slate-900/10">
                <span className="min-w-0 flex-1 text-slate-700">Tienes <b>{emptySubs.length} subcategorías sin productos</b>: ensucian el selector y el Excel.</span>
                <button type="button" onClick={cleanEmpty} className="btn-secondary btn-sm min-h-[44px]"><IconTrash size={14} /> Quitar vacías</button>
              </div>
            )}

            {/* Datos de todos los productos */}
            <section className="animate-in">
              <button type="button" onClick={() => setGeneral((v) => !v)} className="btn-disclosure">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-100 text-brand-700"><IconList size={18} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block">Datos de todos los productos</span>
                  <span className="block truncate text-xs font-normal text-muted">{templates.filter((t) => !t.category_id).map((t) => fieldLabel(t.name)).join(", ") || "ninguno"}</span>
                </span>
                <IconChevronRight className={`shrink-0 text-brand-600 transition ${general ? "rotate-90" : ""}`} />
              </button>
              {general && (
                <div className="mt-2 rounded-2xl border-2 border-slate-200 p-3">
                  <FieldsEditor scope={null} categories={categories} templates={templates} onChanged={load} />
                </div>
              )}
            </section>

            {types.map((t) => {
              const col = categoryColor(t.name);
              const subs = subsOf(t.id);
              const isOpen = open === t.id;
              const fields = getEffectiveFields(templates, categories, t.id);
              const tAxes = axes.filter((a) => a.category_id === t.id);
              return (
                <section key={t.id} className="animate-in card p-0" style={{ borderLeft: `4px solid ${col.dot}` }}>
                  <button type="button" onClick={() => setOpen(isOpen ? null : t.id)} className="flex min-h-[64px] w-full items-center gap-3 p-3 text-left" aria-expanded={isOpen}>
                    <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-2xl ring-1 ${col.bg} ${col.ring}`}>{t.icon || "🏪"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-bold text-ink">{t.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {subs.length} subcategoría{subs.length === 1 ? "" : "s"} · {countOf(t.id)} producto{countOf(t.id) === 1 ? "" : "s"} · {fields.length} datos{tAxes.length ? ` · ${tAxes.map((a) => a.label).join(", ")}` : ""}
                      </span>
                    </span>
                    <IconChevronRight className={`shrink-0 text-slate-400 transition ${isOpen ? "rotate-90" : ""}`} />
                  </button>

                  {isOpen && (
                    <div className="space-y-4 border-t border-slate-100 p-3">
                      <div>
                        <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">Subcategorías</p>
                        <div className="flex flex-wrap gap-1.5">
                          {subs.map((s) => (
                            <button key={s.id} type="button" onClick={() => setEditing({ cat: s, name: s.name, parent: s.parent_id })} className="chip min-h-[40px]">
                              {s.name}
                              {counts.get(s.id) ? <span className="text-xs text-muted">{counts.get(s.id)}</span> : null}
                            </button>
                          ))}
                          <button type="button" onClick={() => setNewSub({ parent: t, name: "" })} className="chip min-h-[40px] border-dashed text-brand-700"><IconPlus size={14} /> Subcategoría</button>
                        </div>
                      </div>

                      <div>
                        <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">Datos de sus productos</p>
                        <FieldsEditor scope={t.id} categories={categories} templates={templates} onChanged={load} />
                      </div>

                      <div>
                        <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">Variantes</p>
                        <AxisEditor categoryId={t.id} axes={tAxes} suggested={PRESETS.find((p) => p.name.toLowerCase() === t.name.toLowerCase())?.axes} onChanged={load} />
                      </div>

                      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                        <button type="button" onClick={() => setEditing({ cat: t, name: t.name, parent: null })} className="btn-secondary btn-sm min-h-[44px]"><IconEdit size={14} /> Cambiar nombre</button>
                        <button type="button" onClick={() => setRemoving({ cat: t, moveTo: "" })} className="btn-ghost btn-sm min-h-[44px] text-danger-700"><IconTrash size={14} /> Eliminar categoría</button>
                      </div>
                    </div>
                  )}
                </section>
              );
            })}

            {types.length > 0 && (
              <button type="button" onClick={() => setAdding(true)} className="btn-secondary min-h-[48px] w-full"><IconPlus size={18} /> Agregar categoría</button>
            )}
          </>
        )}

        {/* Agregar categorías desde los catálogos sugeridos */}
        <Sheet open={adding} onClose={() => setAdding(false)} title="Agregar categoría" wide>
          <PresetPicker
            existingNames={types.map((t) => t.name)}
            submitLabel="Agregar"
            onDone={({ types: added }) => {
              setAdding(false);
              toast("success", added.length ? `Agregado: ${added.join(", ")}` : "Listo");
              load();
            }}
          />
        </Sheet>

        {/* Nueva subcategoría */}
        <Sheet
          open={!!newSub}
          onClose={() => setNewSub(null)}
          title={newSub ? `Nueva subcategoría en ${newSub.parent.name}` : ""}
          footer={<button type="button" onClick={addSub} disabled={!newSub?.name.trim()} className="btn-primary btn-lg w-full">Agregar</button>}
        >
          {newSub && (
            <input className="input min-h-[44px]" placeholder="Nombre de la subcategoría" value={newSub.name} autoFocus onChange={(e) => setNewSub({ ...newSub, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addSub()} aria-label="Nombre de la subcategoría" />
          )}
        </Sheet>

        {/* Editar categoría o subcategoría */}
        <Sheet
          open={!!editing}
          onClose={() => setEditing(null)}
          title={editing ? (editing.cat.parent_id ? `Subcategoría «${editing.cat.name}»` : `Categoría «${editing.cat.name}»`) : ""}
          footer={
            <div className="flex gap-2">
              {editing?.cat.parent_id && (
                <button type="button" onClick={() => setRemoving({ cat: editing.cat, moveTo: "" })} className="btn-destructive min-h-[48px]"><IconTrash size={16} /> Eliminar</button>
              )}
              <button type="button" onClick={saveEdit} disabled={busy || !editing?.name.trim()} className="btn-primary btn-lg flex-1">{busy ? <Spinner /> : null} Guardar</button>
            </div>
          }
        >
          {editing && (
            <div className="space-y-3">
              <div>
                <label className="label" htmlFor="c-name">Nombre</label>
                <input id="c-name" className="input min-h-[44px]" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              {editing.cat.parent_id && (
                <>
                  <div>
                    <label className="label" htmlFor="c-parent">Dentro de</label>
                    <select id="c-parent" className="input min-h-[44px]" value={editing.parent ?? ""} onChange={(e) => setEditing({ ...editing, parent: e.target.value || null })}>
                      {types.map((t) => <option key={t.id} value={t.id}>{t.icon ? `${t.icon} ` : ""}{t.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <p className="label">Datos solo de esta subcategoría</p>
                    <FieldsEditor scope={editing.cat.id} categories={categories} templates={templates} onChanged={load} />
                  </div>
                </>
              )}
            </div>
          )}
        </Sheet>

        {/* Eliminar (con qué hacer con sus productos) */}
        <Sheet
          open={!!removing}
          onClose={() => setRemoving(null)}
          title={removing ? `Eliminar «${removing.cat.name}»` : ""}
          footer={
            <div className="flex gap-2">
              <button type="button" onClick={() => setRemoving(null)} className="btn-secondary min-h-[48px] flex-1">Cancelar</button>
              <button type="button" onClick={confirmRemove} disabled={busy} className="btn-destructive min-h-[48px] flex-1">{busy ? <Spinner /> : <IconTrash size={16} />} Eliminar</button>
            </div>
          }
        >
          {removing && removeInfo && (
            <div className="space-y-3 text-sm text-slate-700">
              {removeInfo.subs > 0 && <p>Se eliminan también sus <b>{removeInfo.subs} subcategorías</b>.</p>}
              {removeInfo.fields.length > 0 && (
                <p className="rounded-2xl bg-warn-50 p-3 text-warn-900">Se borra la definición de: <b>{removeInfo.fields.map((t) => fieldLabel(t.name)).join(", ")}</b>. Lo ya guardado en los productos se conserva y sigue en el Excel.</p>
              )}
              {removeInfo.products > 0 ? (
                <div>
                  <p className="mb-1.5">Tiene <b>{removeInfo.products} producto{removeInfo.products === 1 ? "" : "s"}</b>. ¿Qué hacemos con ellos?</p>
                  <select className="input min-h-[44px]" value={removing.moveTo} onChange={(e) => setRemoving({ ...removing, moveTo: e.target.value })} aria-label="Dónde mover los productos">
                    <option value="">Dejarlos sin categoría</option>
                    {categories
                      .filter((c) => !removeInfo.ids.includes(c.id))
                      .map((c) => {
                        const top = c.parent_id ? categories.find((x) => x.id === c.parent_id) : null;
                        return <option key={c.id} value={c.id}>Mover a: {top ? `${top.name} › ` : ""}{c.name}</option>;
                      })}
                  </select>
                </div>
              ) : (
                <p>No tiene productos.</p>
              )}
            </div>
          )}
        </Sheet>
      </div>
    </OwnerOnly>
  );
}
