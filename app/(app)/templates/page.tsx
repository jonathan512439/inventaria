"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Category, FieldTemplate, FieldType } from "@/types/database";
import { categoryPath } from "@/lib/categories";
import { BASIC_TEMPLATE, fieldLabel, getEffectiveFields, normalizeFieldName } from "@/lib/fields";
import CategorySelect from "@/components/CategorySelect";
import Link from "next/link";
import { IconArrowLeft, IconSparkles } from "@/components/ui/Icons";
import { useConfirm } from "@/components/ui/Confirm";

const TYPE_LABEL: Record<FieldType, string> = { text: "Texto", number: "Número", select: "Opciones" };

export default function TemplatesPage() {
  return (
    <Suspense>
      <Templates />
    </Suspense>
  );
}

function Templates() {
  const supabase = createClient();
  const params = useSearchParams();
  const ask = useConfirm();
  const [categories, setCategories] = useState<Category[]>([]);
  const [templates, setTemplates] = useState<FieldTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // A qué categoría pertenecen los campos que se muestran/crean (null = globales)
  const [scope, setScope] = useState<string | null>(params.get("scope") || null);

  // formulario nuevo campo
  const [fName, setFName] = useState("");
  const [fType, setFType] = useState<FieldType>("text");
  const [fOptions, setFOptions] = useState("");
  const [fAi, setFAi] = useState(true);
  const [fDefault, setFDefault] = useState("");
  const [saving, setSaving] = useState(false);

  // edición
  const [editing, setEditing] = useState<FieldTemplate | null>(null);
  const [editOptions, setEditOptions] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [c, t] = await Promise.all([
      supabase.from("categories").select("*"),
      supabase.from("field_templates").select("*").order("sort_order").order("created_at"),
    ]);
    if (c.error) setError(c.error.message);
    if (t.error) setError(t.error.message);
    setCategories(c.data ?? []);
    setTemplates(t.data ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const ownFields = useMemo(() => templates.filter((t) => t.category_id === scope), [templates, scope]);
  const effective = useMemo(() => getEffectiveFields(templates, categories, scope), [templates, categories, scope]);
  const inherited = effective.filter((t) => t.category_id !== scope);

  function parseOptions(raw: string): string[] | null {
    const arr = raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    return arr.length ? arr : null;
  }

  async function addField(e: React.FormEvent) {
    e.preventDefault();
    if (!fName.trim()) return;
    if (fType === "select" && !parseOptions(fOptions)) return setError("Una lista necesita al menos una opción.");
    setSaving(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from("field_templates").insert({
      user_id: user!.id,
      category_id: scope,
      name: normalizeFieldName(fName) || fName.trim(),
      field_type: fType,
      options: fType === "select" ? parseOptions(fOptions) : null,
      is_ai_fillable: fAi,
      default_value: fDefault.trim() || null,
      sort_order: ownFields.length,
    });
    setSaving(false);
    if (error) return setError(error.message);
    setFName("");
    setFOptions("");
    setFDefault("");
    load();
  }

  async function addBasicTemplate() {
    const existing = new Set(effective.map((t) => t.name.toLowerCase()));
    const toInsert = BASIC_TEMPLATE.filter((t) => !existing.has(t.name.toLowerCase()));
    if (!toInsert.length) return setError("Ya tienes todos los datos de la configuración básica.");
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from("field_templates").insert(
      toInsert.map((t, i) => ({ ...t, user_id: user!.id, category_id: scope, sort_order: ownFields.length + i }))
    );
    if (error) return setError(error.message);
    load();
  }

  async function saveEdit() {
    if (!editing) return;
    const { error } = await supabase
      .from("field_templates")
      .update({
        name: normalizeFieldName(editing.name) || editing.name.trim(),
        field_type: editing.field_type,
        options: editing.field_type === "select" ? parseOptions(editOptions) : null,
        is_ai_fillable: editing.is_ai_fillable,
        default_value: editing.default_value?.trim() || null,
      })
      .eq("id", editing.id);
    if (error) return setError(error.message);
    setEditing(null);
    load();
  }

  async function toggleAi(t: FieldTemplate) {
    const { error } = await supabase.from("field_templates").update({ is_ai_fillable: !t.is_ai_fillable }).eq("id", t.id);
    if (error) return setError(error.message);
    setTemplates((prev) => prev.map((x) => (x.id === t.id ? { ...x, is_ai_fillable: !t.is_ai_fillable } : x)));
  }

  async function remove(t: FieldTemplate) {
    const ok = await ask({
      title: `¿Quitar el dato «${fieldLabel(t.name)}»?`,
      body: "Deja de pedirse en los formularios y de salir en el Excel. Lo que ya guardaste en tus productos no se borra.",
      confirmLabel: "Quitar dato",
      tone: "danger",
    });
    if (!ok) return;
    const { error } = await supabase.from("field_templates").delete().eq("id", t.id);
    if (error) return setError(error.message);
    load();
  }

  async function move(t: FieldTemplate, dir: -1 | 1) {
    const idx = ownFields.findIndex((x) => x.id === t.id);
    const other = ownFields[idx + dir];
    if (!other) return;
    const reordered = [...ownFields];
    reordered[idx] = other;
    reordered[idx + dir] = t;
    await Promise.all(reordered.map((x, i) => supabase.from("field_templates").update({ sort_order: i }).eq("id", x.id)));
    load();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="animate-in">
        <Link href="/store" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"><IconArrowLeft size={16} /> Mi tienda</Link>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Datos de mis productos</h1>
        <p className="text-sm text-slate-500">Qué información guardas de cada producto y cuál llena la IA desde la foto.</p>
      </div>

      <div className="animate-in card space-y-2">
        <label className="label" htmlFor="scope">Datos para</label>
        <CategorySelect id="scope" categories={categories} value={scope} onChange={setScope} emptyLabel="Todos los productos" />
      </div>

      <form onSubmit={addField} className="animate-in card space-y-3">
        <h2 className="font-semibold">Nuevo dato {scope ? `solo para "${categoryPath(categories, scope)}"` : ""}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="fname">Nombre</label>
            <input id="fname" className="input" placeholder="Ej. talla, precio mayorista" value={fName} onChange={(e) => setFName(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="ftype">Tipo</label>
            <select id="ftype" className="input" value={fType} onChange={(e) => setFType(e.target.value as FieldType)}>
              <option value="text">Texto</option>
              <option value="number">Número</option>
              <option value="select">Opciones</option>
            </select>
          </div>
        </div>
        {!fAi && (
          <div>
            <label className="label" htmlFor="fdefault">Valor por defecto (opcional)</label>
            <input id="fdefault" className="input" placeholder={fType === "number" ? "Ej. 1" : "Ej. Sin marca"} value={fDefault} onChange={(e) => setFDefault(e.target.value)} />
          </div>
        )}
        {fType === "select" && (
          <div>
            <label className="label" htmlFor="fopts">Opciones (separadas por coma)</label>
            <input id="fopts" className="input" placeholder="rojo, azul, verde" value={fOptions} onChange={(e) => setFOptions(e.target.value)} />
          </div>
        )}
        <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-brand-50 p-3 text-sm">
          <input type="checkbox" className="mt-1 h-4 w-4 accent-brand-600" checked={fAi} onChange={(e) => setFAi(e.target.checked)} />
          <span>
            <span className="flex items-center gap-1 font-semibold text-brand-800"><IconSparkles size={14} /> La IA lo llena desde la foto</span>
            <span className="text-slate-600">Sí para nombre, color, marca… No para precio o stock.</span>
          </span>
        </label>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={saving}>{saving ? "Guardando..." : "Agregar"}</button>
          <button type="button" className="btn-secondary" onClick={addBasicTemplate}>
            Usar configuración básica
          </button>
        </div>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="animate-in card p-0">
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">
          {scope ? "Datos solo de esta subcategoría" : "Datos de todos los productos"} ({ownFields.length})
        </div>
        {loading ? (
          <p className="p-4 text-sm text-slate-500">Cargando...</p>
        ) : ownFields.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">Nada todavía. Agrega un dato arriba o usa la configuración básica.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {ownFields.map((t, i) => (
              <li key={t.id} className="px-4 py-2.5">
                {editing?.id === t.id ? (
                  <div className="grid gap-2 sm:grid-cols-[1fr_140px_auto]">
                    <input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                    <select className="input" value={editing.field_type} onChange={(e) => setEditing({ ...editing, field_type: e.target.value as FieldType })}>
                      <option value="text">Texto</option>
                      <option value="number">Número</option>
                      <option value="select">Opciones</option>
                    </select>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" className="accent-brand-600" checked={editing.is_ai_fillable} onChange={(e) => setEditing({ ...editing, is_ai_fillable: e.target.checked })} />
                      IA
                    </label>
                    {!editing.is_ai_fillable && (
                      <input className="input sm:col-span-3" placeholder="Valor por defecto (opcional)" value={editing.default_value ?? ""} onChange={(e) => setEditing({ ...editing, default_value: e.target.value })} />
                    )}
                    {editing.field_type === "select" && (
                      <input className="input sm:col-span-3" placeholder="opciones separadas por coma" value={editOptions} onChange={(e) => setEditOptions(e.target.value)} />
                    )}
                    <div className="flex gap-2 sm:col-span-3">
                      <button className="btn-primary px-3 py-1.5" onClick={saveEdit}>Guardar</button>
                      <button className="btn-secondary px-3 py-1.5" onClick={() => setEditing(null)}>Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex flex-col">
                      <button className="btn-ghost h-5 px-1 py-0 text-[10px]" disabled={i === 0} onClick={() => move(t, -1)}>▲</button>
                      <button className="btn-ghost h-5 px-1 py-0 text-[10px]" disabled={i === ownFields.length - 1} onClick={() => move(t, 1)}>▼</button>
                    </div>
                    <span className="flex-1 text-sm font-medium">{fieldLabel(t.name)}</span>
                    <span className="badge bg-slate-100 text-slate-600">{TYPE_LABEL[t.field_type]}</span>
                    {t.options && <span className="hidden text-xs text-slate-400 sm:inline">{t.options.join(", ")}</span>}
                    <button
                      onClick={() => toggleAi(t)}
                      className={`badge ${t.is_ai_fillable ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-500"}`}
                      title="Alternar relleno por IA"
                    >
                      {t.is_ai_fillable ? "✨ IA" : "tú"}
                    </button>
                    {t.default_value && <span className="hidden text-xs text-slate-400 sm:inline">por defecto: {t.default_value}</span>}
                    <button className="btn-ghost px-2 py-1 text-xs" onClick={() => { setEditing(t); setEditOptions(t.options?.join(", ") ?? ""); }}>Editar</button>
                    <button className="btn-ghost px-2 py-1 text-xs text-red-600" onClick={() => remove(t)}>Eliminar</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {scope && inherited.length > 0 && (
        <div className="card p-0">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-600">
            También aplican aquí ({inherited.length})
          </div>
          <ul className="divide-y divide-slate-100">
            {inherited.map((t) => (
              <li key={t.id} className="flex items-center gap-2 px-4 py-2 text-sm text-slate-600">
                <span className="flex-1">{t.name}</span>
                <span className="badge bg-slate-100">{TYPE_LABEL[t.field_type]}</span>
                <span className="badge bg-slate-100">{t.is_ai_fillable ? "✨ IA" : "tú"}</span>
                <span className="text-xs text-slate-400">{t.category_id ? categoryPath(categories, t.category_id) : "todos"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
