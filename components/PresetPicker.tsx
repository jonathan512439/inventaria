"use client";

import { useState } from "react";
import { PRESETS } from "@/lib/presets";
import { useToast } from "./ui/Toast";
import { IconCheck, IconSparkles, Spinner } from "./ui/Icons";

interface Props {
  /** Nombres de tipos que el usuario ya tiene (se muestran marcados y no se repiten) */
  existingNames?: string[];
  businessName?: string;
  submitLabel?: string;
  onDone: (result: { types: string[] }) => void;
}

/** Elegir una o varias categorías preconfiguradas, o describir el negocio para que la IA lo arme. */
export default function PresetPicker({ existingNames = [], businessName, submitLabel = "Continuar", onDone }: Props) {
  const toast = useToast();
  const existing = new Set(existingNames.map((n) => n.toLowerCase()));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [describe, setDescribe] = useState(false);
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const canSubmit = selected.size > 0 || description.trim().length > 3;

  async function submit() {
    if (!canSubmit) return;
    setLoading(true);
    const res = await fetch("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        presets: Array.from(selected),
        description: description.trim() || undefined,
        business_name: businessName,
        onboarded: true,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string; types?: string[] };
    setLoading(false);
    if (!res.ok) return toast("error", json.error || "No se pudo configurar");
    onDone({ types: json.types ?? [] });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {PRESETS.map((p) => {
          const has = existing.has(p.name.toLowerCase());
          const on = selected.has(p.id);
          return (
            <button
              key={p.id}
              type="button"
              disabled={has}
              onClick={() => toggle(p.id)}
              className={`relative rounded-2xl border p-3 text-left transition active:scale-[0.98] ${
                has
                  ? "cursor-default border-emerald-200 bg-emerald-50 opacity-80"
                  : on
                    ? "border-brand-500 bg-brand-50 ring-2 ring-brand-200"
                    : "border-slate-200 bg-white hover:border-brand-300"
              }`}
            >
              <span className="text-2xl">{p.icon}</span>
              <span className="mt-1 block text-sm font-semibold leading-tight text-ink">{p.name}</span>
              <span className="mt-0.5 block text-[11px] leading-tight text-slate-500">{p.description}</span>
              {(on || has) && (
                <span className={`absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full text-white ${has ? "bg-emerald-500" : "bg-brand-600"}`}>
                  <IconCheck size={12} />
                </span>
              )}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setDescribe((v) => !v)}
          className={`rounded-2xl border border-dashed p-3 text-left transition ${describe ? "border-brand-500 bg-brand-50" : "border-slate-300 bg-white hover:border-brand-300"}`}
        >
          <IconSparkles size={24} className="text-brand-600" />
          <span className="mt-1 block text-sm font-semibold leading-tight text-ink">Otro</span>
          <span className="mt-0.5 block text-[11px] leading-tight text-slate-500">Descríbelo y la IA lo arma</span>
        </button>
      </div>

      {describe && (
        <div className="animate-in">
          <label className="label" htmlFor="desc">¿Qué vendes? (una frase)</label>
          <textarea
            id="desc"
            className="input min-h-[80px]"
            placeholder="Ej. Repuestos de moto, aceites y cascos"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      )}

      <button type="button" onClick={submit} disabled={!canSubmit || loading} className="btn-primary btn-lg w-full">
        {loading ? (
          <>
            <Spinner /> {description.trim() ? "La IA está armando tu categoría…" : "Preparando…"}
          </>
        ) : (
          submitLabel
        )}
      </button>
    </div>
  );
}
