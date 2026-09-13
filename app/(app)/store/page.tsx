"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Category, FieldTemplate } from "@/types/database";
import { getEffectiveFields, fieldLabel } from "@/lib/fields";
import PresetPicker from "@/components/PresetPicker";
import { useToast } from "@/components/ui/Toast";
import { IconArrowLeft, IconChevronRight, IconPlus, IconSparkles, IconTrash, IconX, Spinner } from "@/components/ui/Icons";

/**
 * "Mi tienda": los rubros (tipos de producto) con sus secciones.
 * Reemplaza a la gestión manual de categorías/campos para el usuario común.
 */
export default function StorePage() {
  const supabase = createClient();
  const toast = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [templates, setTemplates] = useState<FieldTemplate[]>([]);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newSection, setNewSection] = useState<{ typeId: string; name: string } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  const load = useCallback(async () => {
    const [c, t, p] = await Promise.all([
      supabase.from("categories").select("*").order("name"),
      supabase.from("field_templates").select("*").order("sort_order"),
      supabase.from("products").select("category_id"),
    ]);
    setCategories(c.data ?? []);
    setTemplates(t.data ?? []);
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
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from("categories").insert({ user_id: user!.id, name: newSection.name.trim(), parent_id: newSection.typeId });
    if (error) return toast("error", error.message);
    setNewSection(null);
    toast("success", "Sección agregada");
    load();
  }

  async function rename() {
    if (!renaming || !renaming.name.trim()) return;
    const { error } = await supabase.from("categories").update({ name: renaming.name.trim() }).eq("id", renaming.id);
    if (error) return toast("error", error.message);
    setRenaming(null);
    load();
  }

  async function remove(c: Category, isType: boolean) {
    const n = isType ? countOf(c.id) : (counts.get(c.id) ?? 0);
    const msg = isType
      ? `¿Eliminar el rubro "${c.name}" con todas sus secciones?${n ? ` Sus ${n} productos quedarán sin sección.` : ""}`
      : `¿Eliminar la sección "${c.name}"?${n ? ` Sus ${n} productos quedarán sin sección.` : ""}`;
    if (!confirm(msg)) return;
    const { error } = await supabase.from("categories").delete().eq("id", c.id);
    if (error) return toast("error", error.message);
    load();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header className="animate-in">
        <Link href="/settings" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"><IconArrowLeft size={16} /> Ajustes</Link>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Mi tienda</h1>
        <p className="text-sm text-slate-500">Lo que vendes, organizado en rubros y secciones. La IA usa esto para ordenar cada foto.</p>
      </header>

      {loading ? (
        <div className="flex justify-center py-10"><Spinner size={28} className="text-brand-500" /></div>
      ) : (
        <>
          {types.length === 0 && !adding && (
            <div className="animate-in card bg-gradient-to-br from-brand-600 to-violet-600 text-white ring-0">
              <p className="flex items-center gap-2 text-lg font-semibold"><IconSparkles className="text-amber-300" /> Empieza eligiendo qué vendes</p>
              <p className="mt-1 text-sm text-white/85">Cada rubro trae sus secciones y datos listos. Puedes elegir varios.</p>
              <button onClick={() => setAdding(true)} className="btn mt-4 w-full bg-white text-brand-700 hover:bg-brand-50">Elegir mi rubro</button>
            </div>
          )}

          {types.map((t) => {
            const secs = sectionsOf(t.id);
            const fields = getEffectiveFields(templates, categories, t.id);
            const ai = fields.filter((f) => f.is_ai_fillable).map((f) => fieldLabel(f.name));
            const manual = fields.filter((f) => !f.is_ai_fillable).map((f) => fieldLabel(f.name));
            return (
              <section key={t.id} className="animate-in card space-y-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-50 text-2xl">{t.icon || "🏪"}</span>
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
                        <p className="text-xs text-slate-500">{secs.length} secciones · {countOf(t.id)} productos</p>
                      </>
                    )}
                  </div>
                  <button className="btn-ghost btn-sm text-rose-600" onClick={() => remove(t, true)} title="Eliminar rubro"><IconTrash size={16} /></button>
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
                      <button onClick={() => remove(s, false)} className="rounded-full p-0.5 text-slate-300 hover:bg-rose-50 hover:text-rose-600" title="Eliminar sección"><IconX size={12} /></button>
                    </span>
                  ))}
                  {newSection?.typeId === t.id ? (
                    <span className="chip border-brand-400 gap-1 pr-1.5">
                      <input className="w-32 bg-transparent outline-none" placeholder="Nombre de la sección" value={newSection.name} autoFocus onChange={(e) => setNewSection({ ...newSection, name: e.target.value })} onKeyDown={(e) => (e.key === "Enter" ? addSection() : e.key === "Escape" ? setNewSection(null) : null)} />
                      <button onClick={addSection} className="rounded-full bg-brand-600 p-0.5 text-white"><IconPlus size={12} /></button>
                    </span>
                  ) : (
                    <button onClick={() => setNewSection({ typeId: t.id, name: "" })} className="chip border-dashed text-brand-700"><IconPlus size={14} /> Sección</button>
                  )}
                </div>

                <div className="rounded-2xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <p><span className="font-semibold text-brand-700">✨ La IA llena:</span> {ai.join(", ") || "—"}</p>
                  <p className="mt-0.5"><span className="font-semibold text-slate-700">Tú llenas:</span> {manual.join(", ") || "—"}</p>
                  <Link href={`/templates?scope=${t.id}`} className="mt-1 inline-flex items-center gap-0.5 font-medium text-brand-600 hover:underline">
                    Ajustar datos <IconChevronRight size={12} />
                  </Link>
                </div>
              </section>
            );
          })}

          {adding ? (
            <div className="animate-in card space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-bold">Agregar rubro</h2>
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
              <button onClick={() => setAdding(true)} className="btn-secondary w-full"><IconPlus size={18} /> Agregar rubro</button>
            )
          )}

          <p className="text-center text-xs text-slate-400">
            ¿Necesitas algo más detallado?{" "}
            <Link href="/categories" className="underline">Secciones avanzadas</Link> · <Link href="/templates" className="underline">Datos avanzados</Link>
          </p>
        </>
      )}
    </div>
  );
}
