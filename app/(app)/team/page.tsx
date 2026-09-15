"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { BusinessMember, Invite, MemberRole } from "@/types/database";
import { useFlow } from "@/components/FlowProvider";
import CoachTip from "@/components/CoachTip";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { IconArrowLeft, IconCheck, IconPlus, IconTag, IconX, Spinner } from "@/components/ui/Icons";

const ROLE_LABEL: Record<MemberRole, string> = { dueno: "Dueño", vendedor: "Vendedor" };

/** Equipo: quiénes usan el negocio, con qué rol, invitaciones y PIN para cambiar de persona en el mismo celular. */
export default function TeamPage() {
  const supabase = createClient();
  const toast = useToast();
  const confirm = useConfirm();
  const flow = useFlow();
  const [members, setMembers] = useState<BusinessMember[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null);

  const bid = flow.business?.id;
  const load = useCallback(async () => {
    if (!bid) return;
    const [m, i] = await Promise.all([
      supabase.from("business_members").select("*").eq("business_id", bid).order("created_at"),
      supabase.from("invites").select("*").eq("business_id", bid).is("used_at", null).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }),
    ]);
    setMembers((m.data ?? []) as BusinessMember[]);
    setInvites((i.data ?? []) as Invite[]);
    setLoading(false);
  }, [supabase, bid]);
  useEffect(() => {
    load();
  }, [load]);

  async function invite(role: MemberRole) {
    if (!bid) return;
    setBusy(true);
    const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from("invites").insert({ business_id: bid, code, role, created_by: user!.id });
    setBusy(false);
    if (error) return toast("error", error.message);
    toast("success", `Código ${code} creado. Compártelo por WhatsApp.`);
    load();
  }
  const inviteText = (i: Invite) => `Hola, te invito a usar InventarIA en ${flow.business?.name ?? "mi negocio"} como ${ROLE_LABEL[i.role].toLowerCase()}. Entra a ${location.origin}/join?code=${i.code} (o regístrate y usa el código ${i.code}). Vence en 7 días.`;

  async function setRole(m: BusinessMember, role: MemberRole) {
    const { error } = await supabase.from("business_members").update({ role }).eq("business_id", m.business_id).eq("user_id", m.user_id);
    if (error) return toast("error", error.message);
    load();
  }
  async function toggleActive(m: BusinessMember) {
    if (m.active) {
      const ok = await confirm({ title: `¿Quitar a ${m.display_name ?? "esta persona"}?`, body: "Deja de poder entrar al negocio. Lo que hizo queda registrado a su nombre.", confirmLabel: "Quitar", tone: "danger" });
      if (!ok) return;
    }
    const { error } = await supabase.from("business_members").update({ active: !m.active }).eq("business_id", m.business_id).eq("user_id", m.user_id);
    if (error) return toast("error", error.message);
    load();
  }
  async function saveName() {
    if (!rename || !bid) return;
    const { error } =
      rename.id === flow.meId
        ? await supabase.rpc("set_my_name", { p_business: bid, p_name: rename.name })
        : await supabase.from("business_members").update({ display_name: rename.name.trim() || null }).eq("business_id", bid).eq("user_id", rename.id);
    if (error) return toast("error", error.message);
    setRename(null);
    load();
  }
  async function savePin() {
    if (!bid) return;
    if (!/^\d{4}$/.test(pin)) return toast("info", "El PIN son 4 números");
    const { error } = await supabase.rpc("set_pin", { p_business: bid, p_pin: pin });
    if (error) return toast("error", error.message);
    setPin("");
    toast("success", "PIN guardado. Con él puedes cambiar a tu nombre en cualquier celular del negocio.");
    load();
  }

  const me = members.find((m) => m.user_id === flow.meId);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <header className="animate-in">
        <Link href="/settings" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"><IconArrowLeft size={16} /> Ajustes</Link>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Equipo</h1>
        <p className="text-sm text-slate-500">Quiénes usan {flow.business?.name ?? "el negocio"}. Cada venta, conteo o abono queda con el nombre de quien lo hizo.</p>
      </header>
      <CoachTip screen="team" title="Dos formas de trabajar en equipo">
        <b>Cada uno con su celular:</b> invítalo con un código y entra con su propia cuenta. <b>Un solo celular para todos:</b> cada persona pone su PIN y, al empezar a atender, toca su nombre en el Inicio.
      </CoachTip>

      {loading ? (
        <ListSkeleton rows={3} />
      ) : (
        <>
          <section className="animate-in card space-y-2 p-4">
            <p className="text-sm font-bold text-ink">Personas</p>
            <ul className="divide-y divide-slate-100">
              {members.map((m) => (
                <li key={m.user_id} className={`flex flex-wrap items-center gap-2 py-2.5 ${m.active ? "" : "opacity-50"}`}>
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold ${m.role === "dueno" ? "bg-brand-100 text-brand-800" : "bg-slate-100 text-slate-700"}`}>{(m.display_name ?? "?").slice(0, 1).toUpperCase()}</span>
                  <span className="min-w-0 flex-1">
                    {rename?.id === m.user_id ? (
                      <span className="flex gap-1"><input className="input py-1" value={rename.name} onChange={(e) => setRename({ ...rename, name: e.target.value })} autoFocus onKeyDown={(e) => e.key === "Enter" && saveName()} /><button onClick={saveName} className="btn-primary btn-sm">OK</button><button onClick={() => setRename(null)} className="btn-ghost btn-sm"><IconX size={14} /></button></span>
                    ) : (
                      <button onClick={() => (flow.isOwner || m.user_id === flow.meId) && setRename({ id: m.user_id, name: m.display_name ?? "" })} className="block truncate text-left font-semibold text-ink">{m.display_name ?? "Sin nombre"}{m.user_id === flow.meId ? <span className="text-xs font-normal text-slate-500"> (tú)</span> : null}</button>
                    )}
                    <span className="block text-xs text-slate-500">{ROLE_LABEL[m.role]}{m.has_pin ? " · con PIN" : " · sin PIN"}{!m.active ? " · sin acceso" : ""}</span>
                  </span>
                  {flow.isOwner && m.user_id !== flow.business?.owner_id && (
                    <>
                      <select className="input w-auto py-1 text-xs" value={m.role} onChange={(e) => setRole(m, e.target.value as MemberRole)}>
                        <option value="vendedor">Vendedor</option>
                        <option value="dueno">Dueño</option>
                      </select>
                      <button onClick={() => toggleActive(m)} className={`btn-sm ${m.active ? "btn-ghost text-rose-600" : "btn-secondary"}`}>{m.active ? "Quitar" : "Reactivar"}</button>
                    </>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-slate-500">El <b>vendedor</b> vende, cobra, cuenta y repone; no ve precios de compra, ganancia, reportes ni ajustes.</p>
          </section>

          {flow.isOwner && (
            <section className="animate-in card space-y-2 p-4">
              <p className="text-sm font-bold text-ink">Invitar a alguien</p>
              <p className="text-xs text-slate-500">Se crea un código de 6 letras que vale 7 días. La persona se registra con su correo y lo escribe (o abre el enlace).</p>
              <div className="flex gap-2">
                <button onClick={() => invite("vendedor")} disabled={busy} className="btn-primary btn-sm"><IconPlus size={14} /> Código para vendedor</button>
                <button onClick={() => invite("dueno")} disabled={busy} className="btn-secondary btn-sm"><IconPlus size={14} /> Código para dueño</button>
              </div>
              {invites.length > 0 && (
                <ul className="divide-y divide-slate-100">
                  {invites.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center gap-2 py-2">
                      <span className="rounded-xl bg-slate-100 px-3 py-1 font-mono text-lg font-bold tracking-widest text-ink">{i.code}</span>
                      <span className="min-w-0 flex-1 text-xs text-slate-500">{ROLE_LABEL[i.role]} · vence {new Date(i.expires_at).toLocaleDateString("es", { day: "2-digit", month: "short" })}</span>
                      <a href={`https://wa.me/?text=${encodeURIComponent(inviteText(i))}`} target="_blank" rel="noreferrer" className="btn-success btn-sm"><IconTag size={14} /> WhatsApp</a>
                      <button onClick={async () => { await supabase.from("invites").delete().eq("id", i.id); load(); }} className="btn-ghost btn-sm text-rose-600"><IconX size={14} /></button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="animate-in card space-y-2 p-4">
            <p className="text-sm font-bold text-ink">Mi PIN {me?.has_pin ? <span className="text-xs font-normal text-emerald-700">· ya tienes uno</span> : null}</p>
            <p className="text-xs text-slate-500">4 números para pasar a tu nombre cuando atiendes desde un celular compartido (toca «¿Quién atiende?» en el Inicio). Tras 5 intentos fallidos se bloquea 10 minutos.</p>
            <div className="flex gap-2">
              <input type="password" inputMode="numeric" maxLength={4} pattern="\d{4}" className="input w-32 text-center text-2xl font-bold tracking-[0.5em]" placeholder="••••" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} />
              <button onClick={savePin} disabled={pin.length !== 4} className="btn-primary"><IconCheck size={16} /> {me?.has_pin ? "Cambiar PIN" : "Guardar PIN"}</button>
            </div>
          </section>
        </>
      )}
      {busy && <div className="fixed bottom-24 right-4"><Spinner /></div>}
    </div>
  );
}
