"use client";

import { useEffect, useState } from "react";
import { useToast } from "./ui/Toast";
import { IconCheck, IconSparkles, IconTrash, Spinner } from "./ui/Icons";

/** Ajustes → clave de IA propia (BYOK): el usuario usa su cupo de Gemini en lugar del compartido. */
export default function AiKeyCard() {
  const toast = useToast();
  const [state, setState] = useState<{ configured: boolean; last4: string | null } | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function load() {
    const res = await fetch("/api/ai-key", { cache: "no-store" });
    if (res.ok) setState((await res.json()) as { configured: boolean; last4: string | null });
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    setBusy(true);
    const res = await fetch("/api/ai-key", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
    const json = (await res.json().catch(() => ({}))) as { error?: string; last4?: string };
    setBusy(false);
    if (!res.ok) return toast("error", json.error || "No se pudo guardar la clave");
    setKey("");
    setOpen(false);
    toast("success", "Clave guardada: desde ahora la IA usa tu propio cupo");
    load();
  }
  async function remove() {
    if (!confirm("¿Quitar tu clave? La app volverá a usar el cupo compartido.")) return;
    setBusy(true);
    await fetch("/api/ai-key", { method: "DELETE" });
    setBusy(false);
    toast("success", "Clave quitada");
    load();
  }

  return (
    <section id="ia" className="animate-in card scroll-mt-24 space-y-2">
      <p className="flex items-center gap-1.5 text-sm font-bold text-ink"><IconSparkles size={16} className="text-brand-600" /> Clave de IA propia</p>
      {state?.configured ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-900">
          <IconCheck size={16} className="text-emerald-600" />
          <span className="flex-1">Usando tu clave de Gemini (termina en <b>…{state.last4}</b>). Tus análisis no gastan el cupo compartido.</span>
          <button onClick={remove} disabled={busy} className="btn-secondary btn-sm text-rose-700"><IconTrash size={14} /> Quitar</button>
        </div>
      ) : (
        <>
          <p className="text-xs text-slate-600">
            El cupo gratuito de IA lo comparten todos los usuarios de la app (20 análisis por día y modelo). Con tu propia clave de Google Gemini tienes tu cupo aparte y, si la pagas, sin límite diario.
          </p>
          {open ? (
            <div className="space-y-2">
              <ol className="list-decimal space-y-0.5 pl-5 text-xs text-slate-600">
                <li>Entra a <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="font-semibold text-brand-700 underline">aistudio.google.com/apikey</a> con tu cuenta de Google.</li>
                <li>Toca <b>Create API key</b> y copia la clave (empieza por «AIza…»).</li>
                <li>Pégala aquí. Se guarda cifrada y nunca se muestra completa.</li>
              </ol>
              <div className="flex gap-2">
                <input className="input font-mono text-sm" placeholder="AIza…" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} />
                <button onClick={save} disabled={busy || key.trim().length < 20} className="btn-primary shrink-0">{busy ? <Spinner size={16} /> : "Guardar"}</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setOpen(true)} className="btn-secondary btn-sm">Usar mi propia clave</button>
          )}
        </>
      )}
    </section>
  );
}
