"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BASIC_TEMPLATE } from "@/lib/fields";
import { useToast } from "@/components/ui/Toast";
import { IconChevronRight, IconDownload, IconFolder, IconList, IconLogout, IconSparkles, Spinner } from "@/components/ui/Icons";

export default function SettingsPage() {
  const supabase = createClient();
  const toast = useToast();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [business, setBusiness] = useState("");
  const [savedBusiness, setSavedBusiness] = useState("");
  const [counts, setCounts] = useState<{ categories: number; fields: number } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: u }, p, c, f] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from("profiles").select("business_name").maybeSingle(),
        supabase.from("categories").select("id", { count: "exact", head: true }),
        supabase.from("field_templates").select("id", { count: "exact", head: true }),
      ]);
      setEmail(u.user?.email ?? "");
      setBusiness(p.data?.business_name ?? "");
      setSavedBusiness(p.data?.business_name ?? "");
      setCounts({ categories: c.count ?? 0, fields: f.count ?? 0 });
    })();
  }, [supabase]);

  async function saveBusiness() {
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from("profiles").upsert({ id: user!.id, business_name: business.trim() || null });
    setSaving(false);
    if (error) return toast("error", error.message);
    setSavedBusiness(business.trim());
    toast("success", "Nombre guardado");
  }

  async function quickSetup() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("field_templates")
      .insert(BASIC_TEMPLATE.map((t, i) => ({ ...t, user_id: user!.id, category_id: null, sort_order: i })));
    if (error) return toast("error", error.message);
    setCounts((c) => (c ? { ...c, fields: BASIC_TEMPLATE.length } : c));
    toast("success", "Listo. Ya puedes tomar fotos");
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

      {counts && counts.fields === 0 && (
        <div className="animate-in card bg-gradient-to-br from-brand-600 to-violet-600 text-white ring-0">
          <p className="flex items-center gap-2 text-lg font-semibold"><IconSparkles className="text-amber-300" /> Preparar mi tienda</p>
          <p className="mt-1 text-sm text-white/85">
            Crea los datos básicos de tus productos: nombre, descripción, marca, color, precio, precio de compra y stock. Puedes cambiarlos luego.
          </p>
          <button onClick={quickSetup} className="btn mt-4 w-full bg-white text-brand-700 hover:bg-brand-50">Usar la configuración básica</button>
        </div>
      )}

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
        <Row href="/categories" icon={<IconFolder />} title="Secciones" subtitle={counts ? `${counts.categories} secci${counts.categories === 1 ? "ón" : "ones"} · agrupa tus productos` : ""} />
        <Row href="/templates" icon={<IconList />} title="Datos de mis productos" subtitle={counts ? `${counts.fields} dato${counts.fields === 1 ? "" : "s"} · qué llena la IA y qué llenas tú` : ""} />
        <Row href="/export" icon={<IconDownload />} title="Exportar a Excel" subtitle="Descarga tu inventario" />
      </section>

      <button onClick={signOut} className="btn-ghost w-full text-rose-600"><IconLogout size={18} /> Cerrar sesión</button>
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
