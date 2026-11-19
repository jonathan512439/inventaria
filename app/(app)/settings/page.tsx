"use client";

import { useEffect, useState } from "react";
import { createClient, setActor } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import WhatsNew from "@/components/WhatsNew";
import AiKeyCard from "@/components/AiKeyCard";
import AiUsageCard from "@/components/AiUsageCard";
import AlertsSection from "@/components/settings/AlertsSection";
import LogoCard from "@/components/settings/LogoCard";
import ModePicker, { MODES } from "@/components/settings/ModePicker";
import type { BusinessMode } from "@/types/database";
import { useFlow } from "@/components/FlowProvider";
import { clearDeviceData } from "@/lib/offline";
import { DEFAULT_TZ } from "@/lib/dates";
import { friendlyError } from "@/lib/errors";
import { ListRow, ScreenHeader } from "@/components/ui/Screen";
import { IconChevronRight, IconCloud, IconLogout, IconSparkles, IconStore, IconUsers, Spinner } from "@/components/ui/Icons";

/** Zonas horarias frecuentes (la del negocio decide qué es «hoy» en caja, ventas y números). */
const TIMEZONES: [string, string][] = [
  ["America/La_Paz", "Bolivia"],
  ["America/Lima", "Perú"],
  ["America/Bogota", "Colombia"],
  ["America/Guayaquil", "Ecuador"],
  ["America/Santiago", "Chile"],
  ["America/Argentina/Buenos_Aires", "Argentina"],
  ["America/Asuncion", "Paraguay"],
  ["America/Montevideo", "Uruguay"],
  ["America/Caracas", "Venezuela"],
  ["America/Sao_Paulo", "Brasil (São Paulo)"],
  ["America/Mexico_City", "México (Ciudad de México)"],
  ["Europe/Madrid", "España"],
];

const Chevron = () => <IconChevronRight className="shrink-0 text-slate-400" />;

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 space-y-2">
      <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-muted">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Ajustes (C7.8 · RECONSTRUCCION_VISUAL.md §3.2): Negocio · Avisos · Equipo · Mi catálogo · Mis datos ·
 * Inteligencia artificial · Ayuda · Mi cuenta. Lo ocasional vive aquí; el vendedor solo ve lo suyo
 * (negocio en lectura, equipo/PIN, IA, cuenta y ayuda). `#avisos` abre directamente la sección de avisos.
 */
export default function SettingsPage() {
  const supabase = createClient();
  const toast = useToast();
  const flow = useFlow();
  const [email, setEmail] = useState("");
  // Ajustes del NEGOCIO (023): nombre, moneda y zona horaria
  const [biz, setBiz] = useState({ name: "", currency: "Bs", timezone: DEFAULT_TZ });
  const [counts, setCounts] = useState<{ types: number; sections: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [tour, setTour] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: u }, c, f] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from("categories").select("id", { count: "exact", head: true }).is("parent_id", null),
        supabase.from("categories").select("id", { count: "exact", head: true }).not("parent_id", "is", null),
      ]);
      setEmail(u.user?.email ?? "");
      setCounts({ types: c.count ?? 0, sections: f.count ?? 0 });
    })();
  }, [supabase]);

  // /settings#avisos (antes /alerts): baja a la sección cuando ya se dibujó
  useEffect(() => {
    if (window.location.hash === "#avisos" && flow.isOwner) setTimeout(() => document.getElementById("avisos")?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
  }, [flow.isOwner]);

  // Negocios de la persona (solo si está en más de uno): se ve y se escribe SOLO en el activo (024)
  const [myBiz, setMyBiz] = useState<{ id: string; name: string; role: string; current: boolean }[]>([]);
  useEffect(() => {
    if (flow.businesses > 1) supabase.rpc("my_businesses").then(({ data }) => setMyBiz(data ?? []));
  }, [flow.businesses, supabase]);
  async function switchTo(id: string) {
    const { error } = await supabase.rpc("switch_business", { p_business: id });
    if (error) return toast("error", friendlyError(error));
    setActor(null); // el turno de «¿quién atiende?» era del otro negocio
    window.location.href = "/dashboard"; // recarga completa: todo se vuelve a pedir del negocio nuevo
  }

  const saved = flow.business;
  useEffect(() => {
    if (saved) setBiz({ name: saved.name ?? "", currency: saved.currency ?? "Bs", timezone: saved.timezone ?? DEFAULT_TZ });
  }, [saved]);
  const dirty = !!saved && (biz.name.trim() !== (saved.name ?? "") || biz.currency.trim() !== (saved.currency ?? "Bs") || biz.timezone !== (saved.timezone ?? DEFAULT_TZ));

  async function saveBusiness() {
    if (!saved) return;
    if (!biz.currency.trim()) return toast("info", "Escribe la moneda (por ejemplo Bs)");
    setSaving(true);
    const { error } = await supabase.from("businesses").update({ name: biz.name.trim() || "Mi negocio", currency: biz.currency.trim(), timezone: biz.timezone }).eq("id", saved.id);
    setSaving(false);
    if (error) return toast("error", friendlyError(error));
    toast("success", "Datos del negocio guardados");
    flow.refresh();
  }

  const [savingMode, setSavingMode] = useState(false);
  async function changeMode(m: BusinessMode) {
    if (!saved || m === (saved.mode ?? "completo")) return;
    setSavingMode(true);
    const { error } = await supabase.from("businesses").update({ mode: m }).eq("id", saved.id);
    setSavingMode(false);
    if (error) return toast("error", friendlyError(error));
    toast("success", m === "inventario" ? "Modo «Solo inventario»: se ocultan Vender, Caja y Clientes (no se borra nada)" : "Modo «Inventario y ventas»: ya puedes vender");
    flow.refresh();
  }

  async function signOut() {
    await clearDeviceData();
    await supabase.auth.signOut();
    // Recarga completa: borra también lo que quedó en memoria (cola de fotos, caché)
    window.location.href = "/login";
  }

  const active = flow.members.filter((m) => m.active).length;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <ScreenHeader title="Ajustes" subtitle={email} />

      <Section title="Negocio">
        {myBiz.length > 1 && (
          <div className="card space-y-2">
            <p className="text-sm font-bold text-ink">Estás en {myBiz.length} negocios</p>
            <p className="text-xs text-muted">Ves y anotas solo en el marcado. Toca otro para cambiar.</p>
            <ul className="grid gap-1.5">
              {myBiz.map((b) => (
                <li key={b.id}>
                  <button type="button" onClick={() => !b.current && switchTo(b.id)} className={`flex min-h-[48px] w-full items-center justify-between rounded-2xl border-2 px-3 py-2 text-left ${b.current ? "border-brand-500 bg-brand-50" : "border-slate-200"}`}>
                    <span className="font-semibold text-ink">{b.name}</span>
                    <span className="text-xs text-muted">{b.role === "dueno" ? "Dueño" : "Vendedor"}{b.current ? " · activo" : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="card space-y-3">
          <LogoCard />
          <div>
            <label className="label" htmlFor="business">Nombre (sale en los tickets y mensajes)</label>
            <input id="business" className="input min-h-[44px]" placeholder="Ej. Tienda Doña Rosa" value={biz.name} disabled={!flow.isOwner} onChange={(e) => setBiz({ ...biz, name: e.target.value })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">Moneda</span>
              <input className="input min-h-[44px]" list="monedas" maxLength={5} value={biz.currency} disabled={!flow.isOwner} onChange={(e) => setBiz({ ...biz, currency: e.target.value })} />
              <datalist id="monedas">{["Bs", "S/", "$", "₲", "€", "R$"].map((c) => <option key={c} value={c} />)}</datalist>
            </label>
            <label className="block">
              <span className="label">Zona horaria (para cortar «hoy»)</span>
              <select className="input min-h-[44px]" value={biz.timezone} disabled={!flow.isOwner} onChange={(e) => setBiz({ ...biz, timezone: e.target.value })}>
                {(TIMEZONES.some(([z]) => z === biz.timezone) ? TIMEZONES : [[biz.timezone, biz.timezone] as [string, string], ...TIMEZONES]).map(([z, t]) => <option key={z} value={z}>{t}</option>)}
              </select>
            </label>
          </div>
          {flow.isOwner ? (
            <button type="button" onClick={saveBusiness} className="btn-primary min-h-[48px] w-full" disabled={saving || !dirty}>{saving ? <Spinner /> : "Guardar"}</button>
          ) : (
            <p className="text-xs text-muted">Estos datos los cambia el dueño.</p>
          )}
        </div>
        <div className="card p-1">
          <ListRow href="/settings/team" icon={<IconUsers size={20} />} title="Equipo" subtitle={active > 1 ? `${active} personas · roles, invitaciones y PIN` : "Invita a alguien o pon tu PIN para atender por turnos"} end={<Chevron />} />
          {flow.isOwner && (
            <ListRow href="/settings/catalog" icon={<IconStore size={20} />} title="Mi catálogo" subtitle={counts ? `${counts.types} categoría${counts.types === 1 ? "" : "s"} · ${counts.sections} subcategorías · datos y variantes` : "Categorías, datos y variantes"} end={<Chevron />} />
          )}
          {flow.isOwner && <ListRow href="/settings/data" icon={<IconCloud size={20} />} title="Mis datos" subtitle="Excel, respaldos, ordenar y limpiar, papelera" end={<Chevron />} />}
        </div>
      </Section>

      <Section id="modo" title="Modo de uso">
        <div className="card space-y-2">
          {flow.isOwner ? (
            <>
              <ModePicker value={saved?.mode ?? "completo"} onChange={changeMode} disabled={savingMode} />
              <p className="text-xs text-muted">Cambiar de modo no borra nada: solo muestra u oculta Vender, Caja y Clientes.</p>
            </>
          ) : (
            <p className="text-sm text-muted">Este negocio usa <b className="text-ink">{MODES.find((x) => x.value === (saved?.mode ?? "completo"))?.title}</b>. Lo cambia el dueño.</p>
          )}
        </div>
      </Section>

      {flow.isOwner && (
        <Section id="avisos" title="Avisos">
          <div className="card">
            <AlertsSection />
          </div>
        </Section>
      )}

      <Section title="Inteligencia artificial">
        {flow.isOwner && <AiUsageCard />}
        <AiKeyCard />
      </Section>

      <Section title="Ayuda">
        <div className="card p-1">
          <ListRow onClick={() => setTour(true)} icon={<IconSparkles size={20} />} title="Cómo usar la app" subtitle="Un recorrido corto por los 5 lugares" end={<Chevron />} />
        </div>
        <p className="px-1 text-xs text-muted">En cada pantalla, el botón «?» de arriba explica cómo se usa.</p>
      </Section>

      <Section title="Mi cuenta">
        <div className="card space-y-2">
          <p className="text-sm text-muted">Entraste como <b className="text-ink">{email || "…"}</b></p>
          <button type="button" onClick={signOut} className="btn-ghost min-h-[48px] w-full text-danger-700"><IconLogout size={18} /> Cerrar sesión</button>
        </div>
      </Section>

      {tour && <WhatsNew force onClose={() => setTour(false)} />}
    </div>
  );
}
