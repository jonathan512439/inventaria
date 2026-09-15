"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import CoachTip from "@/components/CoachTip";
import { useToast } from "@/components/ui/Toast";
import { IconArrowLeft, IconSparkles, Spinner } from "@/components/ui/Icons";

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

/** Pregúntale a tu inventario: preguntas en lenguaje normal sobre tus propios datos (solo lectura). */
export default function AskPage() {
  const toast = useToast();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
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
        toast("error", json.daily ? "Se agotó el cupo de IA de hoy. Puedes usar tu propia clave en Ajustes." : json.error || "No se pudo responder");
        setMsgs((m) => [...m, { role: "ai", text: json.daily ? "Hoy ya no queda cupo de IA. Mañana vuelvo a estar disponible, o pon tu propia clave en Ajustes." : "No pude responder ahora. Intenta de nuevo en un momento." }]);
      } else {
        setMsgs((m) => [...m, { role: "ai", text: json.answer ?? "" }]);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col space-y-4">
      <header className="animate-in">
        <Link href="/dashboard" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"><IconArrowLeft size={16} /> Inicio</Link>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-ink"><IconSparkles className="text-violet-600" /> Pregúntale a tu inventario</h1>
        <p className="text-sm text-slate-500">Pregunta como se lo preguntarías a tu ayudante. Responde solo con tus datos (últimos 90 días) y no cambia nada.</p>
      </header>
      <CoachTip screen="ask" title="Cada pregunta usa 1 análisis de IA">
        Cuenta contra el cupo de IA del día (el mismo de las fotos). Si tienes tu propia clave en Ajustes, usa la tuya.
      </CoachTip>

      {msgs.length === 0 && (
        <div className="animate-in flex flex-wrap gap-2">
          {SUGGESTED.map((s) => (
            <button key={s} onClick={() => ask(s)} className="chip text-left text-xs">{s}</button>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {msgs.map((m, i) => (
          <div key={i} className={`animate-in flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[88%] whitespace-pre-wrap rounded-3xl px-4 py-2.5 text-sm leading-relaxed ${m.role === "user" ? "rounded-br-md bg-brand-600 text-white" : "rounded-bl-md bg-white text-ink shadow-card ring-1 ring-slate-900/10"}`}>{m.text}</div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-3xl rounded-bl-md bg-white px-4 py-2.5 text-sm text-slate-500 shadow-card ring-1 ring-slate-900/10"><Spinner size={14} /> Revisando tus datos…</div>
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
        <div className="flex gap-2">
          <input className="input flex-1" placeholder="Escribe tu pregunta…" value={q} onChange={(e) => setQ(e.target.value)} disabled={busy} />
          <button type="submit" disabled={busy || q.trim().length < 3} className="btn-primary shrink-0">{busy ? <Spinner size={16} /> : <IconSparkles size={18} />} Preguntar</button>
        </div>
      </form>
      <div className="h-16" />
    </div>
  );
}
