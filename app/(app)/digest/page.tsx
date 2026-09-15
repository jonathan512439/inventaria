"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Category, Product, Sale } from "@/types/database";
import { SUMMARY_COLS, daysToExpiry, expiringSoon, fmtMoney, fromSummary, needsRestock, stockOf } from "@/lib/inventory";
import { useFlow } from "@/components/FlowProvider";
import CoachTip from "@/components/CoachTip";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { IconArrowLeft, IconTag } from "@/components/ui/Icons";

/** Resumen del día: lo que un dueño quiere saber al cerrar, en un mensaje que se puede mandar por WhatsApp. */
export default function DigestPage() {
  const supabase = createClient();
  const { alerts } = useFlow();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [salesToday, setSalesToday] = useState<Sale[]>([]);
  const [salesYesterday, setSalesYesterday] = useState<Sale[]>([]);
  const [debts, setDebts] = useState<{ name: string; amount: number; days: number }[]>([]);
  const [business, setBusiness] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const yesterday = new Date(today.getTime() - 86400000);
      const [p, c, st, sy, open, prof] = await Promise.all([
        supabase.from("product_summaries").select(SUMMARY_COLS).eq("status", "confirmed"),
        supabase.from("categories").select("*"),
        supabase.from("sales").select("*").gte("created_at", today.toISOString()),
        supabase.from("sales").select("*").gte("created_at", yesterday.toISOString()).lt("created_at", today.toISOString()),
        supabase.from("sales").select("customer_name,total,paid,created_at").neq("status", "pagado"),
        supabase.from("profiles").select("business_name").maybeSingle(),
      ]);
      setProducts((p.data ?? []).map(fromSummary));
      setCategories(c.data ?? []);
      setSalesToday((st.data ?? []) as Sale[]);
      setSalesYesterday((sy.data ?? []) as Sale[]);
      const m = new Map<string, { amount: number; oldest: string }>();
      (open.data ?? []).forEach((s) => {
        const k = s.customer_name ?? "Sin nombre";
        const cur = m.get(k) ?? { amount: 0, oldest: s.created_at };
        cur.amount += Number(s.total) - Number(s.paid);
        if (s.created_at < cur.oldest) cur.oldest = s.created_at;
        m.set(k, cur);
      });
      setDebts(Array.from(m.entries()).map(([name, v]) => ({ name, amount: v.amount, days: Math.floor((Date.now() - new Date(v.oldest).getTime()) / 86400000) })).sort((a, b) => b.days - a.days));
      setBusiness(prof.data?.business_name ?? null);
      setLoading(false);
    })();
  }, [supabase]);

  const sum = (l: Sale[]) => ({ total: l.reduce((a, s) => a + Number(s.total), 0), profit: l.reduce((a, s) => a + Number(s.total) - Number(s.cost_total), 0) });
  const t = sum(salesToday);
  const y = sum(salesYesterday);
  const out = useMemo(() => products.filter((p) => (stockOf(p) ?? 0) <= 0), [products]);
  const restock = useMemo(() => products.filter((p) => needsRestock(p, categories, alerts) && (stockOf(p) ?? 0) > 0), [products, categories, alerts]);
  const expiring = useMemo(() => products.filter((p) => expiringSoon(p, alerts, categories)).sort((a, b) => (daysToExpiry(a.expires_at) ?? 0) - (daysToExpiry(b.expires_at) ?? 0)), [products, categories, alerts]);
  const oldDebts = debts.filter((d) => d.days >= 30);

  const text = [
    `*${business || "Mi negocio"} · resumen de hoy* (${new Date().toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" })})`,
    "",
    `💰 Vendido: Bs ${fmtMoney(t.total)} en ${salesToday.length} venta${salesToday.length === 1 ? "" : "s"} (ayer Bs ${fmtMoney(y.total)})`,
    `📈 Ganancia: Bs ${fmtMoney(t.profit)}`,
    out.length ? `🔴 Agotados: ${out.slice(0, 5).map((p) => String(p.data.nombre)).join(", ")}${out.length > 5 ? ` y ${out.length - 5} más` : ""}` : "✅ Sin agotados",
    restock.length ? `🟠 Por reponer: ${restock.length} producto${restock.length === 1 ? "" : "s"}` : "",
    expiring.length ? `⏳ Por vencer: ${expiring.slice(0, 3).map((p) => `${String(p.data.nombre)} (${daysToExpiry(p.expires_at)} d)`).join(", ")}${expiring.length > 3 ? ` y ${expiring.length - 3} más` : ""}` : "",
    debts.length ? `💳 Te deben: Bs ${fmtMoney(debts.reduce((a, d) => a + d.amount, 0))} (${debts.length} cliente${debts.length === 1 ? "" : "s"}${oldDebts.length ? `, ${oldDebts.length} desde hace +30 días` : ""})` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <header className="animate-in">
        <Link href="/dashboard" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"><IconArrowLeft size={16} /> Inicio</Link>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Resumen de hoy</h1>
        <p className="text-sm text-slate-500">Lo importante del día en un vistazo. Mándatelo por WhatsApp para tenerlo a mano.</p>
      </header>
      <CoachTip screen="digest" title="Un mensaje al cerrar">
        Ábrelo al final del día: ventas, ganancia, agotados, por vencer y quién te debe. Con <b>Enviar por WhatsApp</b> lo compartes contigo o con tu socio.
      </CoachTip>

      {loading ? (
        <ListSkeleton rows={4} />
      ) : (
        <>
          <div className="animate-in grid grid-cols-2 gap-2">
            <Tile label="Vendido hoy" value={`Bs ${fmtMoney(t.total)}`} hint={`ayer Bs ${fmtMoney(y.total)}`} tone="emerald" />
            <Tile label="Ganancia de hoy" value={`Bs ${fmtMoney(t.profit)}`} hint={`ayer Bs ${fmtMoney(y.profit)}`} />
            <Tile label="Agotados" value={String(out.length)} hint={restock.length ? `+${restock.length} por reponer` : "nada por reponer"} tone={out.length ? "rose" : undefined} href="/restock" />
            <Tile label="Te deben" value={`Bs ${fmtMoney(debts.reduce((a, d) => a + d.amount, 0))}`} hint={oldDebts.length ? `${oldDebts.length} con más de 30 días` : `${debts.length} cliente${debts.length === 1 ? "" : "s"}`} tone={oldDebts.length ? "amber" : undefined} href="/customers?tab=deben" />
          </div>

          {expiring.length > 0 && (
            <section className="animate-in card p-3">
              <h2 className="mb-1 text-sm font-bold text-ink">Por vencer</h2>
              <ul className="divide-y divide-slate-100 text-sm">
                {expiring.slice(0, 6).map((p) => (
                  <li key={p.id} className="flex items-center gap-2 py-1.5"><Link href={`/products/${p.id}`} className="min-w-0 flex-1 truncate font-medium text-ink">{String(p.data.nombre || "Sin nombre")}</Link><span className="text-xs font-bold text-amber-700">{(daysToExpiry(p.expires_at) ?? 0) < 0 ? "vencido" : `${daysToExpiry(p.expires_at)} d`}</span></li>
                ))}
              </ul>
            </section>
          )}
          {oldDebts.length > 0 && (
            <section className="animate-in card p-3">
              <h2 className="mb-1 text-sm font-bold text-ink">Deudas viejas (+30 días)</h2>
              <ul className="divide-y divide-slate-100 text-sm">
                {oldDebts.slice(0, 6).map((d) => (
                  <li key={d.name} className="flex items-center gap-2 py-1.5"><span className="min-w-0 flex-1 truncate font-medium text-ink">{d.name}</span><span className="text-xs text-slate-500">{d.days} d</span><span className="font-bold tabular-nums text-amber-700">Bs {fmtMoney(d.amount)}</span></li>
                ))}
              </ul>
              <Link href="/customers?tab=deben" className="mt-2 inline-block text-xs font-semibold text-brand-700 underline">Ir a cobrar →</Link>
            </section>
          )}

          <pre className="animate-in whitespace-pre-wrap rounded-2xl bg-slate-50 p-3 font-mono text-[12px] leading-snug text-slate-700">{text}</pre>
          <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" className="btn-success btn-lg w-full"><IconTag size={18} /> Enviar por WhatsApp</a>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, hint, tone, href }: { label: string; value: string; hint: string; tone?: "emerald" | "rose" | "amber"; href?: string }) {
  const cls = tone === "emerald" ? "bg-emerald-600 text-white ring-emerald-600" : "bg-white ring-slate-900/10";
  const v = tone === "rose" ? "text-rose-700" : tone === "amber" ? "text-amber-700" : tone === "emerald" ? "" : "text-ink";
  const inner = (
    <>
      <p className={`text-[11px] font-semibold uppercase tracking-wide ${tone === "emerald" ? "text-white/70" : "text-slate-500"}`}>{label}</p>
      <p className={`text-xl font-bold tabular-nums ${v}`}>{value}</p>
      <p className={`truncate text-[11px] ${tone === "emerald" ? "text-white/70" : "text-slate-400"}`}>{hint}</p>
    </>
  );
  return href ? <Link href={href} className={`press rounded-2xl p-3 shadow-card ring-1 ${cls}`}>{inner}</Link> : <div className={`rounded-2xl p-3 shadow-card ring-1 ${cls}`}>{inner}</div>;
}
