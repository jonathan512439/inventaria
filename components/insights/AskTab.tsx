"use client";

import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { IconSparkles, Spinner } from "@/components/ui/Icons";

interface Msg {
  role: "user" | "ai";
  text: string;
}

const SUGGESTED = [
  "¿Cuánto vendí esta semana y cuánto gané?",
  "¿Qué producto se vende más?",
  "¿Qué productos están por reponer?",
  "¿Quién me debe y cuánto?",
  "¿Qué tengo parado sin venderse?",
  "¿Cuál es mi mejor día de ventas?",
];

/**
 * Números › Pregúntale (antes /ask): preguntas en lenguaje normal sobre tus datos (últimos 90 días, solo lectura).
 * Cada pregunta usa 1 análisis del cupo de IA (Gemini desde el servidor, /api/ask). Lo que ve el vendedor lo
 * decide el servidor (sin costos ni ganancia).
 */
export default function AskTab() {
  const toast = useToast();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (msgs.length) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs]);

  async function ask(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setMsgs((m) => [...m, { role: "user", text: question }]);
    setQ("");
    setBusy(true);
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) });
      const json = (await res.json().catch(() => ({}))) as { answer?: string; error?: string; daily?: boolean };
      if (!res.ok) {
        toast("error", json.daily ? "Se agotó el cupo de IA de hoy. Puedes usar tu propia clave en Ajustes." : "No se pudo responder ahora. Intenta de nuevo en un momento.");
        setMsgs((m) => [...m, { role: "ai", text: json.daily ? "Hoy ya no queda cupo de IA. Mañana vuelvo a estar disponible, o pon tu propia clave en Ajustes." : "No pude responder ahora. Intenta de nuevo en un momento." }]);
      } else {
        setMsgs((m) => [...m, { role: "ai", text: json.answer ?? "" }]);
      }
    } catch {
      setMsgs((m) => [...m, { role: "ai", text: "Sin conexión: no pude revisar tus datos. Intenta cuando vuelva la señal." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Pregunta como se lo preguntarías a tu ayudante. Responde con tus datos de los últimos 90 días y no cambia nada. Cada pregunta usa 1 análisis de IA del día.</p>
      {msgs.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {SUGGESTED.map((s) => (
            <button key={s} type="button" onClick={() => ask(s)} className="chip min-h-[44px] text-left">{s}</button>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[88%] whitespace-pre-wrap rounded-3xl px-4 py-2.5 text-sm leading-relaxed ${m.role === "user" ? "rounded-br-md bg-brand-600 text-white" : "rounded-bl-md bg-white text-ink shadow-card ring-1 ring-slate-900/10"}`}>{m.text}</div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-3xl rounded-bl-md bg-white px-4 py-2.5 text-sm text-muted shadow-card ring-1 ring-slate-900/10"><Spinner size={14} /> Revisando tus datos…</div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
        className="sticky-action"
      >
        <div className="mx-auto flex max-w-3xl gap-2">
          <input className="input min-h-[48px] flex-1" placeholder="Escribe tu pregunta…" value={q} onChange={(e) => setQ(e.target.value)} disabled={busy} aria-label="Tu pregunta" />
          <button type="submit" disabled={busy || q.trim().length < 3} className="btn-primary min-h-[48px] shrink-0">{busy ? <Spinner size={16} /> : <IconSparkles size={18} />} Preguntar</button>
        </div>
      </form>
    </div>
  );
}
