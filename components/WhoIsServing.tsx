"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useFlow } from "./FlowProvider";
import { useToast } from "./ui/Toast";
import { IconCheck, IconX, Spinner } from "./ui/Icons";

/** «¿Quién atiende?»: en un celular compartido, cada persona pasa a su nombre con su PIN. */
export default function WhoIsServing() {
  const flow = useFlow();
  const supabase = createClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  const active = flow.members.filter((m) => m.active);
  if (!flow.business || active.length < 2) return null;
  const current = active.find((m) => m.user_id === (flow.actorId ?? flow.meId));

  async function confirmPin() {
    if (!pick || !flow.business) return;
    if (pick === flow.meId) {
      flow.switchActor(null);
      setOpen(false);
      return;
    }
    setBusy(true);
    const { data: ok, error } = await supabase.rpc("verify_pin", { p_business: flow.business.id, p_user: pick, p_pin: pin });
    setBusy(false);
    if (error) return toast("error", error.message);
    if (!ok) {
      setPin("");
      return toast("error", "PIN incorrecto (o bloqueado por intentos). Prueba de nuevo.");
    }
    flow.switchActor(pick);
    navigator.vibrate?.(15);
    toast("success", `Ahora atiende ${active.find((m) => m.user_id === pick)?.display_name ?? "otra persona"}`);
    setOpen(false);
    setPin("");
  }

  return (
    <>
      <button onClick={() => { setOpen(true); setPick(null); setPin(""); }} className="flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-card ring-1 ring-slate-900/10 hover:ring-brand-300">
        <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-600 text-[10px] font-bold text-white">{(current?.display_name ?? "?").slice(0, 1).toUpperCase()}</span>
        Atiende {current?.display_name ?? "—"} ▾
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[70] flex items-end justify-center md:items-center" onClick={() => setOpen(false)}>
            <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
            <div className="animate-in relative w-full max-w-sm rounded-t-3xl bg-white p-5 shadow-2xl md:rounded-3xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-ink">¿Quién atiende?</h2>
                <button onClick={() => setOpen(false)} className="btn-ghost btn-sm"><IconX size={18} /></button>
              </div>
              <p className="mt-1 text-xs text-slate-500">Lo que se registre desde ahora llevará ese nombre.</p>
              <ul className="mt-3 grid gap-1.5">
                {active.map((m) => (
                  <li key={m.user_id}>
                    <button onClick={() => { setPick(m.user_id); setPin(""); }} className={`flex w-full items-center gap-3 rounded-2xl border-2 px-3 py-2 text-left ${pick === m.user_id ? "border-brand-500 bg-brand-50" : "border-slate-200"}`}>
                      <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-sm font-bold text-slate-700">{(m.display_name ?? "?").slice(0, 1).toUpperCase()}</span>
                      <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-ink">{m.display_name ?? "Sin nombre"}</span><span className="block text-[11px] text-slate-500">{m.role === "dueno" ? "Dueño" : "Vendedor"}{m.user_id === flow.meId ? " · tu cuenta" : m.has_pin ? "" : " · sin PIN"}</span></span>
                      {(flow.actorId ?? flow.meId) === m.user_id && <IconCheck size={16} className="text-brand-600" />}
                    </button>
                  </li>
                ))}
              </ul>
              {pick && pick !== flow.meId && (
                <div className="mt-3">
                  {active.find((m) => m.user_id === pick)?.has_pin ? (
                    <>
                      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Su PIN</label>
                      <input type="password" inputMode="numeric" maxLength={4} autoFocus className="input mt-1 text-center text-2xl font-bold tracking-[0.5em]" placeholder="••••" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} onKeyDown={(e) => e.key === "Enter" && pin.length === 4 && confirmPin()} />
                    </>
                  ) : (
                    <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">Esa persona todavía no puso su PIN. Que entre con su cuenta a <Link href="/team" className="underline">Equipo</Link> y lo cree.</p>
                  )}
                </div>
              )}
              <button onClick={confirmPin} disabled={!pick || busy || (pick !== flow.meId && pin.length !== 4)} className="btn-primary btn-lg mt-4 w-full">{busy ? <Spinner /> : <IconCheck size={18} />} {pick === flow.meId ? "Volver a mi cuenta" : "Pasar a esta persona"}</button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
