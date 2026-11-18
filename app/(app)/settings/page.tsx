"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient, setActor } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { resetCoach, resetTour } from "@/lib/coach";
import WhatsNew from "@/components/WhatsNew";
import AiKeyCard from "@/components/AiKeyCard";
import { useFlow } from "@/components/FlowProvider";
import { clearDeviceData } from "@/lib/offline";
import { DEFAULT_TZ } from "@/lib/dates";
import { friendlyError } from "@/lib/errors";
import { IconAlert, IconCheckCircle, IconChevronRight, IconDownload, IconFolder, IconList, IconLogout, IconRefresh, IconSparkles, IconTable, IconTag, IconTrash, Spinner } from "@/components/ui/Icons";

/** Zonas horarias frecuentes (la del negocio decide qué es «hoy» en caja, ventas y reportes). */
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

export default function SettingsPage() {
  const supabase = createClient();
  const toast = useToast();
  const router = useRouter();
  const [email, setEmail] = useState("");
  // Ajustes del NEGOCIO (023): nombre, moneda y zona horaria (antes el nombre era del perfil de cada usuario)
  const [biz, setBiz] = useState({ name: "", currency: "Bs", timezone: DEFAULT_TZ });
  const [counts, setCounts] = useState<{ types: number; sections: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [tour, setTour] = useState(false);
  const flow = useFlow();

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

  async function signOut() {
    await clearDeviceData();
    await supabase.auth.signOut();
    // Recarga completa: borra también lo que quedó en memoria (cola de fotos, caché)
    window.location.href = "/login";
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header className="animate-in">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Ajustes</h1>
        <p className="text-sm text-slate-500">{email}</p>
      </header>

      {myBiz.length > 1 && (
        <section className="animate-in card space-y-2">
          <p className="text-sm font-bold text-ink">Estás en {myBiz.length} negocios</p>
          <p className="text-xs text-slate-500">Ves y anotas solo en el que está marcado. Toca otro para cambiar.</p>
          <ul className="grid gap-1.5">
            {myBiz.map((b) => (
              <li key={b.id}>
                <button onClick={() => !b.current && switchTo(b.id)} className={`flex w-full items-center justify-between rounded-2xl border-2 px-3 py-2 text-left ${b.current ? "border-brand-500 bg-brand-50" : "border-slate-200"}`}>
                  <span className="font-semibold text-ink">{b.name}</span>
                  <span className="text-xs text-slate-500">{b.role === "dueno" ? "Dueño" : "Vendedor"}{b.current ? " · activo" : ""}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="animate-in card space-y-3">
        <p className="text-sm font-bold text-ink">Tu negocio</p>
        <label className="label" htmlFor="business">Nombre (sale en los tickets y mensajes)</label>
        <input id="business" className="input" placeholder="Ej. Tienda Doña Rosa" value={biz.name} disabled={!flow.isOwner} onChange={(e) => setBiz({ ...biz, name: e.target.value })} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Moneda</span>
            <input className="input" list="monedas" maxLength={5} value={biz.currency} disabled={!flow.isOwner} onChange={(e) => setBiz({ ...biz, currency: e.target.value })} />
            <datalist id="monedas">{["Bs", "S/", "$", "₲", "€", "R$"].map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          <label className="block">
            <span className="label">Zona horaria (para cortar «hoy»)</span>
            <select className="input" value={biz.timezone} disabled={!flow.isOwner} onChange={(e) => setBiz({ ...biz, timezone: e.target.value })}>
              {(TIMEZONES.some(([z]) => z === biz.timezone) ? TIMEZONES : [[biz.timezone, biz.timezone] as [string, string], ...TIMEZONES]).map(([z, t]) => <option key={z} value={z}>{t}</option>)}
            </select>
          </label>
        </div>
        {flow.isOwner ? (
          <button onClick={saveBusiness} className="btn-primary w-full" disabled={saving || !dirty}>
            {saving ? <Spinner /> : "Guardar"}
          </button>
        ) : (
          <p className="text-xs text-slate-500">Estos datos los cambia el dueño.</p>
        )}
      </section>

      <section className="animate-in card divide-y divide-slate-100 p-0">
        <Row href="/team" icon={<IconCheckCircle />} title="Equipo" subtitle={flow.members.length > 1 ? `${flow.members.filter((m) => m.active).length} personas · roles, invitaciones y PIN` : "Invita a alguien o pon tu PIN para atender por turnos"} />
        {flow.isOwner && <Row href="/store" icon={<IconFolder />} title="Mi tienda" subtitle={counts ? `${counts.types} categoría${counts.types === 1 ? "" : "s"} · ${counts.sections} subcategorías · qué vendes, datos y variantes` : ""} />}
        <Row href="/review" icon={<IconCheckCircle />} title="Revisar pendientes" subtitle="Confirma lo que la IA reconoció" />
        <Row href="/scan" icon={<IconTag />} title="Escanear código de barras" subtitle="Repetidos y reposición sin gastar IA" />
        {flow.isOwner && <Row href="/alerts" icon={<IconAlert />} title="Avisos de reposición" subtitle="Desde cuántas unidades avisar y de qué categorías o productos" />}
        <Row href="/movements" icon={<IconList />} title="Ventas y movimientos" subtitle="Ingresos, entradas y retiros de stock" />
        {flow.isOwner && <Row href="/export" icon={<IconDownload />} title="Exportar a Excel" subtitle="Descarga tu inventario" />}
        {flow.isOwner && <Row href="/import" icon={<IconTable />} title="Importar desde Excel" subtitle="Carga tu inventario desde una planilla" />}
        {flow.isOwner && <Row href="/backup" icon={<IconRefresh />} title="Respaldos" subtitle="Copia completa cada semana; guarda o descarga una ahora" />}
        <Row href="/products?select=1" icon={<IconTag />} title="Etiquetas para imprimir" subtitle="En Productos: Seleccionar → Etiquetas" />
        <Row href="/dashboard#guia" icon={<IconList />} title="Guía paso a paso" subtitle="Cómo armar tu inventario completo" />
        <Row href="/dashboard#limpiar" icon={<IconTrash />} title="Ordenar y limpiar" subtitle="Pendientes viejos, categorías vacías y fotos sueltas" />
      </section>

      <AiKeyCard />

      <section className="animate-in card space-y-2">
        <p className="text-sm font-bold text-ink">Ayuda</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setTour(true)} className="btn-secondary btn-sm"><IconSparkles size={14} /> Cómo usar la herramienta</button>
          <button
            onClick={() => {
              resetCoach();
              resetTour();
              toast("success", "Las burbujas de ayuda volverán a aparecer en cada pantalla");
            }}
            className="btn-secondary btn-sm"
          >
            Reactivar burbujas de ayuda
          </button>
        </div>
        <p className="text-xs text-slate-500">Las burbujas violetas aparecen las primeras 3 veces que abres cada pantalla y luego desaparecen.</p>
      </section>

      <button onClick={signOut} className="btn-ghost w-full text-rose-600"><IconLogout size={18} /> Cerrar sesión</button>
      {tour && <WhatsNew force onClose={() => setTour(false)} />}
    </div>
  );
}

function Row({ href, icon, title, subtitle }: { href: string; icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <Link href={href} className="group flex items-center gap-4 px-5 py-4 transition hover:bg-brand-50/60">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-slate-100 text-slate-600 group-hover:bg-brand-100 group-hover:text-brand-700">{icon}</span>
      <span className="flex-1">
        <span className="block font-semibold text-ink">{title}</span>
        <span className="block text-xs text-slate-500">{subtitle}</span>
      </span>
      <IconChevronRight className="text-slate-300 group-hover:text-brand-500" />
    </Link>
  );
}
