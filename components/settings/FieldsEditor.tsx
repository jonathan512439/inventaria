"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Category, FieldTemplate, FieldType } from "@/types/database";
import { categoryPath } from "@/lib/categories";
import { BASIC_TEMPLATE, fieldLabel, getEffectiveFields, normalizeFieldName } from "@/lib/fields";
import { friendlyError } from "@/lib/errors";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import Sheet from "@/components/ui/Sheet";
import OptionsInput, { parseOptions } from "@/components/ui/OptionsInput";
import { IconEdit, IconPlus, IconSparkles, IconTrash, Spinner } from "@/components/ui/Icons";

const TYPE_LABEL: Record<FieldType, string> = { text: "Texto", number: "Número", select: "Opciones" };

interface Draft {
  id: string | null;
  name: string;
  type: FieldType;
  options: string;
  ai: boolean;
  def: string;
}
const EMPTY: Draft = { id: null, name: "", type: "text", options: "", ai: true, def: "" };

/**
 * «Datos» de una categoría (o de todos los productos si `scope` es null): qué se guarda de cada producto y qué
 * llena la IA desde la foto. Antes /templates; ahora vive dentro de Mi catálogo (C7.8), una lista por categoría.
 */
export default function FieldsEditor({ scope, categories, templates, onChanged }: { scope: string | null; categories: Category[]; templates: FieldTemplate[]; onChanged: () => void }) {
  const supabase = createClient();
  const toast = useToast();
  const ask = useConfirm();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const own = templates.filter((t) => t.category_id === scope).sort((a, b) => a.sort_order - b.sort_order);
  const inherited = scope ? getEffectiveFields(templates, categories, scope).filter((t) => t.category_id !== scope) : [];

  async function save() {
    if (!draft || !draft.name.trim()) return;
    const parsed = parseOptions(draft.options);
    const options = draft.type === "select" && parsed.length ? parsed : null;
    if (draft.type === "select" && !options) return toast("info", "Una lista de opciones necesita al menos una opción");
    setSaving(true);
    const row = {
      name: normalizeFieldName(draft.name) || draft.name.trim(),
      field_type: draft.type,
      options,
      is_ai_fillable: draft.ai,
      default_value: draft.ai ? null : draft.def.trim() || null,
    };
    const { error } = draft.id
      ? await supabase.from("field_templates").update(row).eq("id", draft.id)
      : await supabase.from("field_templates").insert({ ...row, user_id: (await supabase.auth.getUser()).data.user?.id ?? "", category_id: scope, sort_order: own.length });
    setSaving(false);
    if (error) return toast("error", friendlyError(error));
    setDraft(null);
    onChanged();
  }

  async function addBasic() {
    const existing = new Set(getEffectiveFields(templates, categories, scope).map((t) => t.name.toLowerCase()));
    const toInsert = BASIC_TEMPLATE.filter((t) => !existing.has(t.name.toLowerCase()));
    if (!toInsert.length) return toast("info", "Ya tienes todos los datos básicos");
    const uid = (await supabase.auth.getUser()).data.user?.id ?? "";
    const { error } = await supabase.from("field_templates").insert(toInsert.map((t, i) => ({ ...t, user_id: uid, category_id: scope, sort_order: own.length + i })));
    if (error) return toast("error", friendlyError(error));
    onChanged();
  }

  async function toggleAi(t: FieldTemplate) {
    const { error } = await supabase.from("field_templates").update({ is_ai_fillable: !t.is_ai_fillable }).eq("id", t.id);
    if (error) return toast("error", friendlyError(error));
    onChanged();
  }

  async function remove(t: FieldTemplate) {
    const ok = await ask({ title: `¿Quitar el dato «${fieldLabel(t.name)}»?`, body: "Deja de pedirse en los formularios y de salir en el Excel. Lo que ya guardaste en tus productos no se borra.", confirmLabel: "Quitar dato", tone: "danger" });
    if (!ok) return;
    const { error } = await supabase.from("field_templates").delete().eq("id", t.id);
    if (error) return toast("error", friendlyError(error));
    setDraft(null);
    onChanged();
  }

  async function move(t: FieldTemplate, dir: -1 | 1) {
    const idx = own.findIndex((x) => x.id === t.id);
    const other = own[idx + dir];
    if (!other) return;
    const re = [...own];
    re[idx] = other;
    re[idx + dir] = t;
    await Promise.all(re.map((x, i) => supabase.from("field_templates").update({ sort_order: i }).eq("id", x.id)));
    onChanged();
  }

  return (
    <div className="space-y-2">
      {own.length === 0 ? (
        <p className="text-sm text-muted">{scope ? "Sin datos propios." : "Sin datos generales."}</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-2xl bg-white ring-1 ring-slate-900/10">
          {own.map((t, i) => (
            <li key={t.id} className="flex min-h-[48px] items-center gap-1 px-2 py-1">
              <span className="flex flex-col">
                <button type="button" className="h-6 w-8 text-xs text-muted disabled:opacity-30" disabled={i === 0} onClick={() => move(t, -1)} aria-label="Subir">▲</button>
                <button type="button" className="h-6 w-8 text-xs text-muted disabled:opacity-30" disabled={i === own.length - 1} onClick={() => move(t, 1)} aria-label="Bajar">▼</button>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">{fieldLabel(t.name)}</span>
                <span className="block truncate text-xs text-muted">{TYPE_LABEL[t.field_type]}{t.options ? ` · ${t.options.join(", ")}` : ""}{t.default_value ? ` · por defecto ${t.default_value}` : ""}</span>
              </span>
              <button type="button" onClick={() => toggleAi(t)} className={`badge min-h-[32px] ${t.is_ai_fillable ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-600"}`} title="Quién lo llena">
                {t.is_ai_fillable ? "✨ IA" : "tú"}
              </button>
              <button type="button" onClick={() => setDraft({ id: t.id, name: t.name, type: t.field_type, options: t.options?.join(", ") ?? "", ai: t.is_ai_fillable, def: t.default_value ?? "" })} className="grid h-11 w-11 place-items-center rounded-full text-muted hover:bg-slate-100" aria-label={`Editar ${fieldLabel(t.name)}`}>
                <IconEdit size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {inherited.length > 0 && <p className="text-xs text-muted">También aplican: {inherited.map((t) => `${fieldLabel(t.name)}${t.category_id ? "" : " (todos)"}`).join(", ")}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setDraft({ ...EMPTY })} className="btn-secondary btn-sm min-h-[44px]"><IconPlus size={14} /> Dato</button>
        {!scope && <button type="button" onClick={addBasic} className="btn-ghost btn-sm min-h-[44px]">Usar datos básicos</button>}
      </div>

      <Sheet
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? "Editar dato" : `Nuevo dato${scope ? ` · ${categoryPath(categories, scope)}` : " · todos los productos"}`}
        footer={
          <div className="flex gap-2">
            {draft?.id && (
              <button type="button" onClick={() => remove(own.find((x) => x.id === draft.id)!)} className="btn-destructive min-h-[48px]"><IconTrash size={16} /> Quitar</button>
            )}
            <button type="button" onClick={save} disabled={saving || !draft?.name.trim()} className="btn-primary btn-lg flex-1">{saving ? <Spinner /> : null} Guardar</button>
          </div>
        }
      >
        {draft && (
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="f-name">Nombre</label>
              <input id="f-name" className="input min-h-[44px]" placeholder="Ej. talla, sabor, contenido" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus />
            </div>
            <div>
              <label className="label" htmlFor="f-type">Tipo</label>
              <select id="f-type" className="input min-h-[44px]" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as FieldType })}>
                <option value="text">Texto</option>
                <option value="number">Número</option>
                <option value="select">Opciones</option>
              </select>
            </div>
            {draft.type === "select" && (
              <div>
                <label className="label" htmlFor="f-opts">Opciones</label>
                <OptionsInput id="f-opts" value={draft.options} onChange={(v) => setDraft({ ...draft, options: v })} />
              </div>
            )}
            <label className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-2xl bg-brand-50 p-3 text-sm">
              <input type="checkbox" className="mt-1 h-5 w-5 accent-brand-600" checked={draft.ai} onChange={(e) => setDraft({ ...draft, ai: e.target.checked })} />
              <span>
                <span className="flex items-center gap-1 font-semibold text-brand-800"><IconSparkles size={14} /> La IA lo llena desde la foto</span>
                <span className="text-slate-600">Sí para nombre, color, marca… No para precio o stock.</span>
              </span>
            </label>
            {!draft.ai && (
              <div>
                <label className="label" htmlFor="f-def">Valor por defecto (opcional)</label>
                <input id="f-def" className="input min-h-[44px]" value={draft.def} onChange={(e) => setDraft({ ...draft, def: e.target.value })} />
              </div>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
