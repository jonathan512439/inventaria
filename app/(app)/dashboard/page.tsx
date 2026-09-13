"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function DashboardPage() {
  const [stats, setStats] = useState<{ drafts: number; confirmed: number; categories: number } | null>(null);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const [d, c, cat] = await Promise.all([
        supabase.from("products").select("id", { count: "exact", head: true }).eq("status", "draft"),
        supabase.from("products").select("id", { count: "exact", head: true }).eq("status", "confirmed"),
        supabase.from("categories").select("id", { count: "exact", head: true }),
      ]);
      setStats({ drafts: d.count ?? 0, confirmed: c.count ?? 0, categories: cat.count ?? 0 });
    })();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Inicio</h1>
        <p className="text-sm text-slate-500">Toma una foto y deja que la IA rellene los campos.</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Borradores" value={stats?.drafts} href="/drafts" />
        <Stat label="Confirmados" value={stats?.confirmed} href="/products" />
        <Stat label="Categorías" value={stats?.categories} href="/categories" />
      </div>

      <Link href="/capture" className="btn-primary w-full py-4 text-base">
        📷 Tomar / subir foto de producto
      </Link>

      {stats && stats.categories === 0 && (
        <div className="card border-amber-200 bg-amber-50 text-sm text-amber-800">
          <p className="font-medium">Primeros pasos</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li><Link className="underline" href="/categories">Crea al menos una categoría</Link>.</li>
            <li><Link className="underline" href="/templates">Define los campos</Link> (o usa la plantilla básica).</li>
            <li><Link className="underline" href="/capture">Toma una foto</Link> y revisa el borrador.</li>
          </ol>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, href }: { label: string; value?: number; href: string }) {
  return (
    <Link href={href} className="card text-center hover:border-brand-500">
      <div className="text-2xl font-bold text-brand-700">{value ?? "–"}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </Link>
  );
}
