"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { resetCoach, resetTour } from "@/lib/coach";
import WhatsNew from "@/components/WhatsNew";
import AiKeyCard from "@/components/AiKeyCard";
import { useFlow } from "@/components/FlowProvider";
import { IconAlert, IconCheckCircle, IconChevronRight, IconDownload, IconFolder, IconList, IconLogout, IconRefresh, IconSparkles, IconTable, IconTag, IconTrash, Spinner } from "@/components/ui/Icons";

export default function SettingsPage() {
  const supabase = createClient();
  const toast = useToast();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [business, setBusiness] = useState("");
  const [savedBusiness, setSavedBusiness] = useState("");
  const [counts, setCounts] = useState<{ types: number; sections: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [tour, setTour] = useState(false);
  const flow = useFlow();

  useEffect(() => {
    (async () => {
      const [{ data: u }, p, c, f] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from("profiles").select("business_name").maybeSingle(),
        supabase.from("categories").select("id", { count: "exact", head: true }).is("parent_id", null),
        supabase.from("categories").select("id", { count: "exact", head: true }).not("parent_id", "is", null),
      ]);
      setEmail(u.user?.email ?? "");
      setBusiness(p.data?.business_name ?? "");
      setSavedBusiness(p.data?.business_name ?? "");
      setCounts({ types: c.count ?? 0, sections: f.count ?? 0 });
    })();
  }, [supabase]);

  async function saveBusiness() {
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from("profiles").upsert({ id: user!.id, business_name: business.trim() || null });
    if (!error && flow.business && flow.isOwner) await supabase.from("businesses").update({ name: business.trim() || "Mi negocio" }).eq("id", flow.business.id);
    setSaving(false);
    if (error) return toast("error", error.message);
    setSavedBusiness(business.trim());
    toast("success", "Nombre guardado");
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header className="animate-in">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Ajustes</h1>
        <p className="text-sm text-slate-500">{email}</p>
      </header>

      <section className="animate-in card space-y-3">
        <label className="label" htmlFor="business">Nombre de tu negocio</label>
        <div className="flex gap-2">
          <input id="business" className="input" placeholder="Ej. Tienda Doña Rosa" value={business} onChange={(e) => setBusiness(e.target.value)} />
          <button onClick={saveBusiness} className="btn-primary shrink-0" disabled={saving || business.trim() === savedBusiness}>
            {saving ? <Spinner /> : "Guardar"}
          </button>
        </div>
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
        <Row href="/labels" icon={<IconTag />} title="Etiquetas para imprimir" subtitle="Código de barras, nombre y precio para pegar en cada producto" />
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
