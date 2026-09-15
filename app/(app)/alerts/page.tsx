"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Category, Product } from "@/types/database";
import { categoryPath } from "@/lib/categories";
import { SUMMARY_COLS, DEFAULT_ALERTS, fromSummary as toProduct, minStockOf, stockOf } from "@/lib/inventory";
import { categoryColor } from "@/lib/colors";
import CoachTip from "@/components/CoachTip";
import OwnerOnly from "@/components/OwnerOnly";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { IconAlert, IconArrowLeft, IconCheck, IconSearch, Spinner } from "@/components/ui/Icons";

/**
 * Ajustes → Avisos de reposición: desde cuántas unidades avisar (negocio, categoría y producto),
 * cuántos días antes avisar del vencimiento, y qué categorías o productos no deben avisar.
 */
export default function AlertsPage() {
  const supabase = createClient();
  const toast = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [minStock, setMinStock] = useState<string>("");
  const [expiryDays, setExpiryDays] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"general" | "productos" | "silenciados">("general");

  const load = useCallback(async () => {
    const [c, p, prof] = await Promise.all([
      supabase.from("categories").select("*").order("name"),
      supabase.from("product_summaries").select(SUMMARY_COLS).eq("status", "confirmed"),
      supabase.from("profiles").select("min_stock_default,expiry_days").maybeSingle(),
    ]);
    setCategories(c.data ?? []);
    setProducts((p.data ?? []).map(toProduct));
    setMinStock(prof.data?.min_stock_default === null || prof.data?.min_stock_default === undefined ? "" : String(prof.data.min_stock_default));
    setExpiryDays(prof.data?.expiry_days === null || prof.data?.expiry_days === undefined ? "" : String(prof.data.expiry_days));
    setLoading(false);
  }, [supabase]);
  useEffect(() => {
    load();
  }, [load]);

  async function saveGeneral() {
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const min = minStock.trim() === "" ? null : Math.max(0, parseInt(minStock, 10) || 0);
    const days = expiryDays.trim() === "" ? null : Math.min(365, Math.max(1, parseInt(expiryDays, 10) || 30));
    const { error } = await supabase.from("profiles").upsert({ id: user!.id, min_stock_default: min, expiry_days: days });
    setSaving(false);
    if (error) return toast("error", error.message);
    toast("success", "Avisos guardados. Se aplican en todo el inventario.");
  }

  async function setCategoryMin(cat: Category, raw: string) {
    const v = raw.trim() === "" ? null : Math.max(0, parseInt(raw, 10) || 0);
    if (v === (cat.min_stock_default ?? null)) return;
    const { error } = await supabase.from("categories").update({ min_stock_default: v }).eq("id", cat.id);
    if (error) return toast("error", error.message);
    setCategories((cs) => cs.map((c) => (c.id === cat.id ? { ...c, min_stock_default: v } : c)));
  }
  async function toggleCategory(cat: Category) {
    const next = !cat.alerts_off;
    const { error } = await supabase.from("categories").update({ alerts_off: next }).eq("id", cat.id);
    if (error) return toast("error", error.message);
    setCategories((cs) => cs.map((c) => (c.id === cat.id ? { ...c, alerts_off: next } : c)));
    toast("success", next ? `«${cat.name}» ya no avisa` : `«${cat.name}» vuelve a avisar`);
  }
  async function setProductMin(p: Product, raw: string) {
    const v = raw.trim() === "" ? null : Math.max(0, parseInt(raw, 10) || 0);
    if (v === (p.min_stock ?? null)) return;
    const { error } = await supabase.from("products").update({ min_stock: v }).eq("id", p.id);
    if (error) return toast("error", error.message);
    setProducts((ps) => ps.map((x) => (x.id === p.id ? { ...x, min_stock: v } : x)));
  }
  async function toggleProduct(p: Product) {
    const next = !p.alerts_off;
    const { error } = await supabase.from("products").update({ alerts_off: next }).eq("id", p.id);
    if (error) return toast("error", error.message);
    setProducts((ps) => ps.map((x) => (x.id === p.id ? { ...x, alerts_off: next } : x)));
  }

  const tops = useMemo(() => categories.filter((c) => !c.parent_id), [categories]);
  const term = q.trim().toLowerCase();
  const listed = useMemo(() => {
    const base = term ? products.filter((p) => String(p.data.nombre ?? "").toLowerCase().includes(term)) : products;
    return [...base].sort((a, b) => (stockOf(a) ?? 0) - (stockOf(b) ?? 0)).slice(0, 60);
  }, [products, term]);
  const muted = useMemo(() => products.filter((p) => p.alerts_off), [products]);
  const mutedCats = useMemo(() => categories.filter((c) => c.alerts_off), [categories]);
  const settings = { minStock: minStock.trim() === "" ? DEFAULT_ALERTS.minStock : parseInt(minStock, 10) || 0, expiryDays: expiryDays.trim() === "" ? DEFAULT_ALERTS.expiryDays : parseInt(expiryDays, 10) || 30 };

  return (
    <OwnerOnly>
    <div className="mx-auto max-w-2xl space-y-4">
      <header className="animate-in">
        <Link href="/settings" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"><IconArrowLeft size={16} /> Ajustes</Link>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Avisos de reposición</h1>
        <p className="text-sm text-slate-500">Tú decides desde cuántas unidades avisar y de qué productos o categorías.</p>
      </header>
      <CoachTip screen="alerts" title="¿Cuándo es urgente reponer?">
        Pon el mínimo general para todo el negocio, cámbialo en las categorías que necesiten otro número y ajusta productos sueltos. Lo que apagues aquí deja de salir en <b>Por reponer</b> y en el Inicio.
      </CoachTip>

      <div className="animate-in grid grid-cols-3 gap-1 rounded-2xl bg-slate-100 p-1">
        {([["general", "General"], ["productos", "Por producto"], ["silenciados", `Sin avisos (${muted.length + mutedCats.length})`]] as [typeof tab, string][]).map(([k, t]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-xl px-2 py-2 text-sm font-semibold ${tab === k ? "bg-white text-ink shadow" : "text-slate-500"}`}>{t}</button>
        ))}
      </div>

      {loading ? (
        <ListSkeleton rows={4} />
      ) : tab === "general" ? (
        <>
          <section className="animate-in card space-y-3 p-4">
            <p className="text-sm font-bold text-ink">Para todo el negocio</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-semibold uppercase text-slate-500">
                Avisar desde
                <input type="number" min={0} inputMode="numeric" className="input mt-1 text-lg font-bold tabular-nums" placeholder={String(DEFAULT_ALERTS.minStock)} value={minStock} onChange={(e) => setMinStock(e.target.value)} />
                <span className="mt-1 block font-normal normal-case text-slate-500">unidades o menos = «por reponer»</span>
              </label>
              <label className="text-xs font-semibold uppercase text-slate-500">
                Vencimiento
                <input type="number" min={1} max={365} inputMode="numeric" className="input mt-1 text-lg font-bold tabular-nums" placeholder={String(DEFAULT_ALERTS.expiryDays)} value={expiryDays} onChange={(e) => setExpiryDays(e.target.value)} />
                <span className="mt-1 block font-normal normal-case text-slate-500">días antes de que venza</span>
              </label>
            </div>
            <button onClick={saveGeneral} disabled={saving} className="btn-primary w-full">{saving ? <Spinner size={16} /> : <IconCheck size={18} />} Guardar</button>
          </section>

          <section className="animate-in card space-y-2 p-4">
            <p className="text-sm font-bold text-ink">Por categoría</p>
            <p className="text-xs text-slate-500">Deja el número vacío para usar el general ({settings.minStock}). Apaga el interruptor si esa categoría no debe avisar nunca.</p>
            <ul className="divide-y divide-slate-100">
              {tops.map((c) => {
                const col = categoryColor(c.name);
                const n = products.filter((p) => p.category_id && (p.category_id === c.id || categories.some((x) => x.id === p.category_id && x.parent_id === c.id))).length;
                return (
                  <li key={c.id} className="flex items-center gap-3 py-2.5">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-lg ring-1 ${col.bg} ${col.ring}`}>{c.icon || "🏷️"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-ink">{c.name}</span>
                      <span className="block text-xs text-slate-500">{n} producto{n === 1 ? "" : "s"}{c.alerts_off ? " · sin avisos" : ""}</span>
                    </span>
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      className="input w-20 py-1.5 text-center font-bold tabular-nums disabled:opacity-40"
                      placeholder={String(settings.minStock)}
                      defaultValue={c.min_stock_default ?? ""}
                      disabled={c.alerts_off}
                      onBlur={(e) => setCategoryMin(c, e.target.value)}
                    />
                    <button onClick={() => toggleCategory(c)} className={`relative h-6 w-11 shrink-0 rounded-full transition ${c.alerts_off ? "bg-slate-300" : "bg-emerald-500"}`} title={c.alerts_off ? "Activar avisos" : "Silenciar avisos"} aria-label={c.alerts_off ? "Activar avisos" : "Silenciar avisos"}>
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${c.alerts_off ? "left-0.5" : "left-[22px]"}`} />
                    </button>
                  </li>
                );
              })}
              {tops.length === 0 && <li className="py-4 text-center text-sm text-slate-500">Aún no tienes categorías.</li>}
            </ul>
          </section>
        </>
      ) : tab === "productos" ? (
        <section className="animate-in card space-y-2 p-4">
          <div className="relative">
            <IconSearch size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-11" placeholder="Buscar un producto…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <p className="text-xs text-slate-500">Vacío = usa el mínimo de su categoría. Se muestran primero los de menor stock.</p>
          <ul className="divide-y divide-slate-100">
            {listed.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <Link href={`/products/${p.id}`} className="block truncate font-semibold text-ink hover:text-brand-700">{String(p.data.nombre || "Sin nombre")}</Link>
                  <span className="block truncate text-xs text-slate-500">
                    {p.category_id ? categoryPath(categories, p.category_id) : "Sin categoría"} · stock {stockOf(p) ?? 0} · avisa desde {minStockOf(p, categories, settings)}
                    {p.alerts_off ? " · sin avisos" : ""}
                  </span>
                </span>
                <input type="number" min={0} inputMode="numeric" className="input w-20 py-1.5 text-center font-bold tabular-nums disabled:opacity-40" placeholder={String(minStockOf({ ...p, min_stock: null }, categories, settings))} defaultValue={p.min_stock ?? ""} disabled={p.alerts_off} onBlur={(e) => setProductMin(p, e.target.value)} />
                <button onClick={() => toggleProduct(p)} className={`relative h-6 w-11 shrink-0 rounded-full transition ${p.alerts_off ? "bg-slate-300" : "bg-emerald-500"}`} aria-label={p.alerts_off ? "Activar avisos" : "Silenciar avisos"}>
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${p.alerts_off ? "left-0.5" : "left-[22px]"}`} />
                </button>
              </li>
            ))}
            {listed.length === 0 && <li className="py-4 text-center text-sm text-slate-500">Nada coincide con la búsqueda.</li>}
          </ul>
        </section>
      ) : (
        <section className="animate-in card space-y-2 p-4">
          <p className="text-sm font-bold text-ink">Sin avisos</p>
          <p className="text-xs text-slate-500">Lo que descartaste deslizando en <b>Por reponer</b> o apagaste aquí. Vuelve a activarlo cuando quieras.</p>
          {muted.length + mutedCats.length === 0 ? (
            <p className="flex items-center gap-2 py-4 text-sm text-emerald-800"><IconCheck size={16} /> Todo avisa normalmente.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {mutedCats.map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-2.5">
                  <IconAlert size={16} className="shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate font-semibold text-ink">{c.name} <span className="text-xs font-normal text-slate-500">(categoría)</span></span>
                  <button onClick={() => toggleCategory(c)} className="btn-secondary btn-sm">Volver a avisar</button>
                </li>
              ))}
              {muted.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-ink">{String(p.data.nombre || "Sin nombre")}</span>
                    <span className="block truncate text-xs text-slate-500">{p.category_id ? categoryPath(categories, p.category_id) : "Sin categoría"} · stock {stockOf(p) ?? 0}</span>
                  </span>
                  <button onClick={() => toggleProduct(p)} className="btn-secondary btn-sm">Volver a avisar</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
    </OwnerOnly>
  );
}
