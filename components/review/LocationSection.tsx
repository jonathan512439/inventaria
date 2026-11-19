"use client";

import { useState } from "react";
import type { Category, Product } from "@/types/database";
import { findSimilar, nameKey } from "@/lib/categories";
import CategoryPicker from "@/components/CategoryPicker";
import { IconCheck, IconEdit, IconList, IconSparkles, Spinner } from "@/components/ui/Icons";

/**
 * «¿Dónde va este producto?»: categoría y subcategoría con su estado (sin categoría / falta subcategoría / listo),
 * sugerencias de la IA, «que la elija la IA» y crear la categoría con IA cuando no encaja en ninguna.
 */
export default function LocationSection({
  product,
  title,
  categories,
  onCategoriesChange,
  categoryId,
  onCategory,
  openIn,
  busy,
  onCreateSuggested,
  onAutoSub,
  onSetup,
}: {
  product: Product;
  title: string;
  categories: Category[];
  onCategoriesChange: (c: Category[]) => void;
  categoryId: string | null;
  onCategory: (id: string | null) => void;
  /** Abre el selector dentro de una categoría (cuando la IA no encontró subcategoría clara) */
  openIn: { id: string; nonce: number } | null;
  busy: { settingUp: boolean; classifying: boolean };
  onCreateSuggested: (parentId: string) => void;
  onAutoSub: (categoryId: string) => void;
  onSetup: () => void;
}) {
  const [openPicker, setOpenPicker] = useState<{ step: string | null; nonce: number } | null>(null);
  const meta = product.ai_meta ?? {};
  const cat = categoryId ? categories.find((c) => c.id === categoryId) ?? null : null;
  const top = cat?.parent_id ? categories.find((c) => c.id === cat.parent_id) ?? cat : cat;
  const needsSub = !!categoryId && !cat?.parent_id && categories.some((c) => c.parent_id === categoryId);
  const state = !categoryId
    ? { label: "Sin categoría", chip: "bg-danger-100 text-danger-800", border: "border-danger-200 bg-danger-50/40" }
    : needsSub
      ? { label: "Falta subcategoría", chip: "bg-warn-100 text-warn-800", border: "border-warn-200 bg-warn-50/40" }
      : meta.categoria_sugerida && categoryId === product.category_id
        ? { label: "✨ Asignado por la IA", chip: "bg-ok-100 text-ok-800", border: "border-ok-200 bg-ok-50/40" }
        : { label: "Ubicación elegida", chip: "bg-ok-100 text-ok-800", border: "border-ok-200 bg-ok-50/40" };
  const generalName = meta.categoria_nueva_general || meta.categoria_nueva || null;

  return (
    <section className={`rounded-2xl border-2 p-3 ${state.border}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-ink">¿Dónde va este producto?</h2>
        <span className={`badge ${state.chip}`}>{state.label}</span>
      </div>

      <div className="space-y-2">
        <div className="row-action">
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold uppercase tracking-wide text-muted">Categoría</span>
            <span className="block truncate font-semibold text-ink">{top ? `${top.icon ? top.icon + " " : ""}${top.name}` : "— sin asignar —"}</span>
          </span>
          <button type="button" onClick={() => setOpenPicker({ step: null, nonce: Date.now() })} className="btn-secondary btn-sm min-h-[44px] shrink-0"><IconEdit size={14} /> Cambiar</button>
        </div>
        <div className="row-action">
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold uppercase tracking-wide text-muted">Subcategoría</span>
            <span className={`block truncate font-semibold ${cat?.parent_id ? "text-ink" : "text-warn-700"}`}>{cat?.parent_id ? cat.name : top ? "— falta elegir —" : "—"}</span>
          </span>
          {top && (
            <button type="button" onClick={() => setOpenPicker({ step: top.id, nonce: Date.now() })} className="btn-secondary btn-sm min-h-[44px] shrink-0"><IconEdit size={14} /> Cambiar</button>
          )}
        </div>
      </div>

      {/* Selector (se abre desde los botones Cambiar) */}
      <div className="sr-only">
        <CategoryPicker
          categories={categories}
          value={categoryId}
          onChange={onCategory}
          onCategoriesChange={onCategoriesChange}
          emptyLabel="Sin categoría"
          openIn={openPicker?.step ? { id: openPicker.step, nonce: openPicker.nonce } : openIn}
          openNonce={openPicker?.step === null ? openPicker.nonce : undefined}
        />
      </div>

      {/* Falta subcategoría dentro de una categoría que sí tiene */}
      {needsSub && (
        <div className="mt-3 space-y-2 rounded-2xl bg-brand-50 p-3">
          <p className="text-xs font-semibold text-brand-900">Elige la subcategoría para terminar de ordenarlo:</p>
          <div className="flex flex-wrap gap-2">
            {(meta.categoria_nueva ? findSimilar(categories, categoryId, meta.categoria_nueva) : []).map((c) => (
              <button key={c.id} type="button" onClick={() => onCategory(c.id)} className="chip min-h-[40px] border-ok-400 bg-ok-50 text-ok-800"><IconCheck size={14} /> {c.name}</button>
            ))}
            <button type="button" onClick={() => setOpenPicker({ step: categoryId, nonce: Date.now() })} className="chip min-h-[40px]"><IconList size={14} /> Ver todas</button>
            {meta.categoria_nueva && !categories.some((c) => c.parent_id === categoryId && nameKey(c.name) === nameKey(meta.categoria_nueva!)) ? (
              <button type="button" disabled={busy.settingUp} onClick={() => onCreateSuggested(categoryId!)} className="chip min-h-[40px] border-brand-500 bg-brand-600 text-white hover:bg-brand-700">
                <IconSparkles size={14} /> Crear subcategoría «{meta.categoria_nueva}» y asignar
              </button>
            ) : (
              <button type="button" disabled={busy.classifying} onClick={() => onAutoSub(categoryId!)} className="chip min-h-[40px] border-brand-400 bg-white text-brand-700">
                {busy.classifying ? <Spinner size={14} /> : <IconSparkles size={14} />} Que la elija la IA
              </button>
            )}
          </div>
        </div>
      )}

      {/* Sin categoría: crearla con IA o elegir una existente */}
      {!categoryId && (
        <div className="mt-3 space-y-2 rounded-2xl bg-warn-50 p-3">
          <p className="text-sm font-semibold text-warn-900">Este producto no encaja en tus categorías.</p>
          <p className="text-xs text-warn-800">
            La IA creará la categoría <b>{generalName || title || "nueva"}</b>
            {meta.categoria_nueva ? <> con la subcategoría <b>{meta.categoria_nueva}</b></> : " con sus subcategorías"} y sus datos, y pondrá este producto ahí. Luego puedes cambiarlo con <b>Cambiar</b>.
          </p>
          <button type="button" disabled={busy.settingUp} onClick={onSetup} className="btn-primary btn-lg w-full">
            {busy.settingUp ? <Spinner size={18} /> : <IconSparkles size={20} />}
            {busy.settingUp ? "Creando y asignando…" : "Crear categoría y subcategoría con IA"}
          </button>
          <p className="text-center text-xs text-warn-800">Usa 1 análisis · o toca <b>Cambiar</b> arriba para elegir una existente</p>
        </div>
      )}
    </section>
  );
}
