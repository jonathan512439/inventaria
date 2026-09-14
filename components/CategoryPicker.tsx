"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import type { Category } from "@/types/database";
import { useToast } from "./ui/Toast";
import { IconArrowLeft, IconCheck, IconChevronRight, IconPlus, IconX, Spinner } from "./ui/Icons";
import { categoryColor } from "@/lib/colors";
import { findSibling } from "@/lib/categories";

interface Props {
  categories: Category[];
  value: string | null;
  onChange: (id: string | null) => void;
  /** Se llama cuando se crea una categoría/subcategoría nueva, con la lista actualizada */
  onCategoriesChange?: (categories: Category[]) => void;
  /** Permite crear categorías y subcategorías desde el selector */
  allowCreate?: boolean;
  /** Muestra la opción "Sin categoría / Todas" */
  emptyLabel?: string | null;
  className?: string;
  /** Cambiar este valor abre el panel directamente en el paso 2 de esa categoría */
  openIn?: { id: string; nonce: number } | null;
  /** Cambiar este valor abre el panel en el paso 1 (lista de categorías) */
  openNonce?: number;
}

/**
 * Selector de categoría en dos pasos: primero la categoría, luego su subcategoría.
 * Abre un panel (hoja inferior en móvil). Permite crear sobre la marcha.
 */
export default function CategoryPicker({ categories, value, onChange, onCategoriesChange, allowCreate = true, emptyLabel = null, className = "", openIn = null, openNonce }: Props) {
  const supabase = createClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<string | null>(null); // id de la categoría elegida en el paso 1
  const [creating, setCreating] = useState<"cat" | "sub" | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const roots = categories.filter((c) => !c.parent_id).sort((a, b) => a.name.localeCompare(b.name, "es"));
  const byId = new Map(categories.map((c) => [c.id, c]));
  const current = value ? byId.get(value) : null;
  const currentTop = current ? (current.parent_id ? byId.get(current.parent_id) : current) : null;

  useEffect(() => {
    if (open) {
      setStep(currentTop?.id ?? (roots.length === 1 ? roots[0].id : null));
      setCreating(null);
      setNewName("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (openIn) {
      setOpen(true);
      // tras el efecto de apertura, fijar el paso en la categoría pedida
      setTimeout(() => setStep(openIn.id), 0);
    }
  }, [openIn]);

  useEffect(() => {
    if (openNonce) {
      setOpen(true);
      setTimeout(() => setStep(null), 0); // paso 1: lista de categorías
    }
  }, [openNonce]);

  function choose(id: string | null) {
    onChange(id);
    setOpen(false);
  }

  async function create() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    if (creating === "cat") {
      const dupTop = findSibling(categories, null, name);
      if (dupTop) {
        setBusy(false);
        setCreating(null);
        setNewName("");
        toast("info", `Ya existe “${dupTop.name}”`);
        setStep(dupTop.id);
        return;
      }
      const res = await fetch("/api/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plain_names: [name] }) });
      if (!res.ok) {
        setBusy(false);
        return toast("error", "No se pudo crear la categoría");
      }
      const { data } = await supabase.from("categories").select("*");
      const all = data ?? [];
      onCategoriesChange?.(all);
      const created = all.find((c) => !c.parent_id && c.name.toLowerCase() === name.toLowerCase());
      setBusy(false);
      setCreating(null);
      setNewName("");
      if (created) {
        toast("success", `Categoría "${name}" creada`);
        setStep(created.id);
      }
    } else if (creating === "sub" && step) {
      const dup = findSibling(categories, step, name);
      if (dup) {
        setBusy(false);
        setCreating(null);
        setNewName("");
        toast("info", `Ya existe “${dup.name}”: la usamos`);
        choose(dup.id);
        return;
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data, error } = await supabase.from("categories").insert({ user_id: user!.id, name, parent_id: step }).select().single();
      setBusy(false);
      if (error) return toast("error", error.message);
      onCategoriesChange?.([...categories, data]);
      setCreating(null);
      setNewName("");
      toast("success", `Subcategoría "${name}" creada`);
      choose(data.id);
    }
  }

  const subsOfCurrentTop = currentTop ? categories.filter((c) => c.parent_id === currentTop.id).length : 0;

  const stepCat = step ? byId.get(step) : null;
  const subs = step ? categories.filter((c) => c.parent_id === step).sort((a, b) => a.name.localeCompare(b.name, "es")) : [];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`input flex items-center justify-between gap-2 text-left ${current ? "border-brand-300 bg-brand-50/40" : "text-slate-500"} ${className}`}
      >
        {current ? (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-slate-500">
              Categoría: <b className="text-ink">{currentTop?.icon ? `${currentTop.icon} ` : ""}{currentTop?.name}</b>
            </span>
            <span className="block truncate text-sm">
              {current.parent_id ? (
                <><span className="text-xs font-medium text-slate-500">Subcategoría:</span> <b className="text-ink">{current.name}</b></>
              ) : subsOfCurrentTop > 0 ? (
                <span className="text-xs font-medium text-amber-700">Falta elegir la subcategoría</span>
              ) : (
                <span className="text-xs text-slate-400">sin subcategorías</span>
              )}
            </span>
          </span>
        ) : (
          <span className="truncate">{emptyLabel ?? "Elegir categoría"}</span>
        )}
        <span className="shrink-0 rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-brand-700">cambiar</span>
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-3" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" />
          <div
            className="animate-in relative flex max-h-[80vh] w-full max-w-lg flex-col rounded-3xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Cabecera */}
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
              {stepCat && roots.length > 1 ? (
                <button type="button" onClick={() => setStep(null)} className="btn-ghost btn-sm -ml-2">
                  <IconArrowLeft size={18} /> Categorías
                </button>
              ) : (
                <span className="text-sm font-semibold text-slate-500">Paso 1 de 2</span>
              )}
              <span className="flex-1 truncate text-center font-bold text-ink">{stepCat ? `${stepCat.icon ? stepCat.icon + " " : ""}${stepCat.name}` : "Elige la categoría"}</span>
              <button type="button" onClick={() => setOpen(false)} className="btn-ghost btn-sm -mr-2"><IconX size={18} /></button>
            </div>

            <div className="overflow-y-auto p-3">
              {!stepCat ? (
                /* ---------- Paso 1: categorías ---------- */
                <ul className="space-y-1.5">
                  {emptyLabel && (
                    <li>
                      <button type="button" onClick={() => choose(null)} className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left ${!value ? "border-brand-500 bg-brand-50" : "border-slate-200 hover:bg-slate-50"}`}>
                        <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-500">—</span>
                        <span className="flex-1 font-medium">{emptyLabel}</span>
                        {!value && <IconCheck size={18} className="text-brand-600" />}
                      </button>
                    </li>
                  )}
                  {roots.map((r) => {
                    const n = categories.filter((c) => c.parent_id === r.id).length;
                    const active = currentTop?.id === r.id;
                    return (
                      <li key={r.id}>
                        <button type="button" onClick={() => (n > 0 || allowCreate ? setStep(r.id) : choose(r.id))} className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition ${active ? "border-brand-500 bg-brand-50" : "border-slate-200 hover:border-brand-300 hover:bg-brand-50/40"}`}>
                          <span className={`grid h-9 w-9 place-items-center rounded-xl text-xl ring-1 ${categoryColor(r.name).bg} ${categoryColor(r.name).ring}`}>{r.icon || "🏷️"}</span>
                          <span className="flex-1">
                            <span className="block font-semibold text-ink">{r.name}</span>
                            <span className="block text-xs text-slate-500">{n ? `${n} subcategorías · toca para elegir una` : allowCreate ? "sin subcategorías · toca para usarla o crear una" : "sin subcategorías"}</span>
                          </span>
                          {value === r.id ? <IconCheck size={18} className="text-brand-600" /> : <IconChevronRight size={18} className="text-slate-400" />}
                        </button>
                      </li>
                    );
                  })}
                  {allowCreate && (
                    <li>
                      {creating === "cat" ? (
                        <div className="flex items-center gap-2 rounded-2xl border border-brand-400 bg-white px-3 py-2">
                          <input className="flex-1 bg-transparent outline-none" placeholder="Nombre de la categoría" value={newName} autoFocus onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
                          <button type="button" onClick={create} disabled={busy || !newName.trim()} className="btn-primary btn-sm">{busy ? <Spinner size={14} /> : "Crear"}</button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => setCreating("cat")} className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-brand-300 px-3 py-3 text-left text-brand-700 hover:bg-brand-50">
                          <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-100"><IconPlus size={18} /></span>
                          <span className="font-semibold">Nueva categoría</span>
                          <span className="ml-auto text-xs text-slate-500">solo el nombre</span>
                        </button>
                      )}
                    </li>
                  )}
                </ul>
              ) : (
                /* ---------- Paso 2: subcategorías ---------- */
                <ul className="space-y-1.5">
                  <li className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Paso 2 de 2 · {subs.length ? "Elige la subcategoría" : "Esta categoría aún no tiene subcategorías"}
                  </li>
                  {subs.length === 0 && (
                    <li>
                      <button type="button" onClick={() => choose(stepCat.id)} className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left ${value === stepCat.id ? "border-brand-500 bg-brand-50" : "border-slate-200 hover:bg-slate-50"}`}>
                        <span className="flex-1 font-semibold text-ink">Usar “{stepCat.name}” tal cual</span>
                        {value === stepCat.id && <IconCheck size={18} className="text-brand-600" />}
                      </button>
                    </li>
                  )}
                  {subs.map((s) => (
                    <li key={s.id}>
                      <button type="button" onClick={() => choose(s.id)} className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition ${value === s.id ? "border-brand-500 bg-brand-50" : "border-slate-200 hover:border-brand-300 hover:bg-brand-50/40"}`}>
                        <span className="flex-1 font-semibold text-ink">{s.name}</span>
                        {value === s.id && <IconCheck size={18} className="text-brand-600" />}
                      </button>
                    </li>
                  ))}
                  {allowCreate && (
                    <li>
                      {creating === "sub" ? (
                        <div className="flex items-center gap-2 rounded-2xl border border-brand-400 bg-white px-3 py-2">
                          <input className="flex-1 bg-transparent outline-none" placeholder="Nombre de la subcategoría" value={newName} autoFocus onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
                          <button type="button" onClick={create} disabled={busy || !newName.trim()} className="btn-primary btn-sm">{busy ? <Spinner size={14} /> : "Crear"}</button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => setCreating("sub")} className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-brand-300 px-3 py-3 text-left text-brand-700 hover:bg-brand-50">
                          <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-100"><IconPlus size={18} /></span>
                          <span className="font-semibold">Nueva subcategoría en {stepCat.name}</span>
                        </button>
                      )}
                    </li>
                  )}
                </ul>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
