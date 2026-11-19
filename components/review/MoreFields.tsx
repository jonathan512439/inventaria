"use client";

import { useState } from "react";
import type { FieldTemplate, ProductData } from "@/types/database";
import { fieldLabel } from "@/lib/fields";
import FieldInput from "@/components/FieldInput";
import { IconChevronRight, IconList, IconSparkles, IconTag } from "@/components/ui/Icons";

/** El resto de los datos del producto, plegado, con cuántos faltan completar. */
export default function MoreFields({ fields, data, etiqueta, onChange }: { fields: FieldTemplate[]; data: ProductData; etiqueta?: string | null; onChange: (f: FieldTemplate, v: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!fields.length) return null;
  const empty = fields.filter((f) => data[f.name] === "" || data[f.name] === null || data[f.name] === undefined).length;
  return (
    <section>
      <button type="button" onClick={() => setOpen((v) => !v)} className="btn-disclosure">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-100 text-brand-700"><IconList size={18} /></span>
        <span className="min-w-0 flex-1">
          <span className="block">{open ? "Ocultar los demás datos" : `Revisar los demás datos (${fields.length})`}</span>
          <span className="block truncate text-xs font-normal text-muted">
            {empty > 0 ? `${empty} sin completar · ` : "todos completos · "}
            {fields.map((f) => fieldLabel(f.name)).join(", ")}
          </span>
        </span>
        {empty > 0 && !open && <span className="badge shrink-0 bg-warn-100 text-warn-800">{empty}</span>}
        <IconChevronRight className={`shrink-0 text-brand-600 transition ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="stagger mt-2 space-y-3 rounded-2xl border-2 border-slate-200 px-4 py-4">
          {fields.map((f) => (
            <div key={f.id}>
              <label className="label flex items-center gap-1">{fieldLabel(f.name)} {f.is_ai_fillable && <IconSparkles size={12} className="text-brand-500" />}</label>
              <FieldInput field={f} value={data[f.name]} onChange={(v) => onChange(f, v)} />
            </div>
          ))}
          {etiqueta && (
            <p className="flex gap-2 rounded-2xl bg-slate-50 p-3 text-xs text-slate-600">
              <IconTag size={16} className="mt-0.5 shrink-0 text-slate-400" />
              <span><b className="text-slate-700">En la etiqueta se lee:</b> {etiqueta}</span>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
