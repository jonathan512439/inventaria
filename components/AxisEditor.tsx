"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { VariantAxis } from "@/types/database";
import { AXIS_LIBRARY, MAX_AXES, axisKey } from "@/lib/variants";
import { useToast } from "./ui/Toast";
import { IconPlus, IconTrash, IconX, Spinner } from "./ui/Icons";

interface Props {
  categoryId: string;
  axes: VariantAxis[]; // solo los de esta categoría
  /** Ejes típicos del catálogo de esta categoría (p. ej. Ropa → Talla y Color) */
  suggested?: { key: string; label: string; options: string[] }[];
  onChanged: () => void;
}

/** Define qué varía en una categoría (talla, color…). Cada combinación tendrá su propio stock. */
export default function AxisEditor({ categoryId, axes, suggested = [], onChanged }: Props) {
  const supabase = createClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string; options: string } | null>(null);

  async function add(label: string, key: string, options: string[]) {
    if (axes.length >= MAX_AXES) return toast("info", `Máximo ${MAX_AXES} por categoría`);
    if (axes.some((a) => a.key === key)) return toast("info", `Ya existe "${label}"`);
    setBusy(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from("variant_axes").insert({ user_id: user!.id, category_id: categoryId, key, label, options, sort_order: axes.length });
    setBusy(false);
    if (error) return toast("error", error.message);
    setAdding(false);
    setCustom("");
    toast("success", `"${label}" agregado: ahora los productos de esta categoría pueden tener variantes por ${label.toLowerCase()}`);
    onChanged();
  }

  async function remove(a: VariantAxis) {
    if (!confirm(`¿Quitar "${a.label}"? Las variantes ya creadas no se borran, pero no podrás crear nuevas por ${a.label.toLowerCase()}.`)) return;
    const { error } = await supabase.from("variant_axes").delete().eq("id", a.id);
    if (error) return toast("error", error.message);
    onChanged();
  }

  async function saveOptions() {
    if (!editing) return;
    const options = Array.from(new Set(editing.options.split(/,|\n/).map((s) => s.trim()).filter(Boolean))).slice(0, 40);
    const { error } = await supabase.from("variant_axes").update({ options }).eq("id", editing.id);
    if (error) return toast("error", error.message);
    setEditing(null);
    onChanged();
  }

  return (
    <div className="rounded-2xl border-2 border-violet-200 bg-violet-50/50 px-3 py-2 text-xs">
      <p className="font-semibold text-violet-900">
        Variantes {axes.length ? <span className="font-normal text-violet-700">· cada combinación tiene su propio stock</span> : <span className="font-normal text-violet-700">· ¿los productos vienen en tallas, colores o edades?</span>}
      </p>
      {axes.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {axes.map((a) => (
            <li key={a.id} className="rounded-xl bg-white px-2.5 py-1.5 ring-1 ring-violet-100">
              {editing?.id === a.id ? (
                <div className="flex items-center gap-1.5">
                  <span className="shrink-0 font-bold text-ink">{a.label}:</span>
                  <input className="input flex-1 py-1 text-xs" value={editing.options} onChange={(e) => setEditing({ ...editing, options: e.target.value })} placeholder="Opciones separadas por coma" autoFocus onKeyDown={(e) => e.key === "Enter" && saveOptions()} />
                  <button className="btn-primary btn-sm" onClick={saveOptions}>OK</button>
                  <button className="btn-ghost btn-sm" onClick={() => setEditing(null)}><IconX size={12} /></button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button className="min-w-0 flex-1 text-left" onClick={() => setEditing({ id: a.id, options: a.options.join(", ") })} title="Editar opciones">
                    <span className="font-bold text-ink">{a.label}</span>
                    <span className="ml-1.5 text-slate-500">{a.options.length ? a.options.join(" · ") : "cualquier valor"}</span>
                  </button>
                  <button onClick={() => remove(a)} className="rounded-full p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600" title="Quitar"><IconTrash size={12} /></button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {axes.length < MAX_AXES && suggested.some((s) => !axes.some((a) => a.key === s.key)) && !adding && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className="text-violet-800">Sugerido:</span>
          {suggested.filter((s) => !axes.some((a) => a.key === s.key)).map((s) => (
            <button key={s.key} disabled={busy} onClick={() => add(s.label, s.key, s.options)} className="rounded-full border-2 border-violet-300 bg-white px-2.5 py-0.5 text-xs font-semibold text-violet-800 hover:bg-violet-100">
              <IconPlus size={10} className="mr-0.5 inline" />{s.label}
            </button>
          ))}
        </div>
      )}
      {axes.length < MAX_AXES && (
        adding ? (
          <div className="mt-2 space-y-1.5">
            <div className="flex flex-wrap gap-1">
              {AXIS_LIBRARY.filter((l) => !axes.some((a) => a.key === l.key)).map((l) => (
                <button key={l.key} disabled={busy} onClick={() => add(l.label, l.key, l.options)} className="chip py-1 text-xs">{l.label}</button>
              ))}
            </div>
            <div className="flex gap-1.5">
              <input className="input py-1 text-xs" placeholder="Otro (p. ej. Aroma)" value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.key === "Enter" && custom.trim() && add(custom.trim().slice(0, 30), axisKey(custom), [])} />
              <button disabled={!custom.trim() || busy} onClick={() => add(custom.trim().slice(0, 30), axisKey(custom), [])} className="btn-primary btn-sm">{busy ? <Spinner size={12} /> : "Agregar"}</button>
              <button onClick={() => setAdding(false)} className="btn-ghost btn-sm"><IconX size={12} /></button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className="mt-1.5 inline-flex items-center gap-0.5 font-medium text-violet-700 hover:underline">
            <IconPlus size={12} /> {axes.length ? "Agregar otro eje" : "Agregar variantes (talla, color…)"}
          </button>
        )
      )}
    </div>
  );
}
