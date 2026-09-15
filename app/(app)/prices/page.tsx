"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Category, Product } from "@/types/database";
import { getDescendantIds } from "@/lib/categories";
import { SUMMARY_COLS, fmtMoney, fromSummary, priceOf } from "@/lib/inventory";
import CoachTip from "@/components/CoachTip";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { IconArrowLeft, IconCheck, Spinner } from "@/components/ui/Icons";

type Field = "precio" | "precio_mayorista";
type Mode = "pct" | "amount" | "margin";
type Round = "none" | "0.5" | "1";

/** Precios: cambio masivo por categoría (+%, monto fijo o margen sobre el costo), con redondeo y vista previa. */
export default function PricesPage() {
  const supabase = createClient();
  const toast = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [catId, setCatId] = useState<string>("");
  const [field, setField] = useState<Field>("precio");
  const [mode, setMode] = useState<Mode>("pct");
  const [value, setValue] = useState("10");
  const [round, setRound] = useState<Round>("0.5");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [c, p] = await Promise.all([supabase.from("categories").select("*").order("name"), supabase.from("product_summaries").select(SUMMARY_COLS).eq("status", "confirmed")]);
      setCategories(c.data ?? []);
      setProducts((p.data ?? []).map(fromSummary));
      setLoading(false);
    })();
  }, [supabase]);

  const scope = useMemo(() => {
    if (!catId) return products;
    const ids = new Set(getDescendantIds(categories, catId));
    return products.filter((p) => p.category_id && ids.has(p.category_id));
  }, [products, categories, catId]);

  const n = Number(value.replace(",", ".")) || 0;
  const roundTo = (x: number) => (round === "none" ? Math.round(x * 100) / 100 : round === "0.5" ? Math.round(x * 2) / 2 : Math.round(x));
  const preview = useMemo(
    () =>
      scope
        .map((p) => {
          const base = field === "precio" ? priceOf(p) : Number(p.data.precio_mayorista ?? "") || null;
          const cost = Number(p.data.precio_compra ?? "") || null;
          let next: number | null = null;
          if (mode === "pct" && base !== null) next = base * (1 + n / 100);
          if (mode === "amount" && base !== null) next = base + n;
          if (mode === "margin" && cost !== null) next = cost * (1 + n / 100);
          if (next !== null) next = Math.max(0, roundTo(next));
          return { p, base, next };
        })
        .filter((r) => r.next !== null && r.next !== r.base),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope, field, mode, n, round]
  );

  async function apply() {
    if (!preview.length) return;
    if (!confirm(`Se cambiará el ${field === "precio" ? "precio de venta" : "precio mayorista"} de ${preview.length} producto${preview.length === 1 ? "" : "s"}. ¿Continuar?`)) return;
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    let ok = 0;
    for (const r of preview) {
      const { data: p } = await supabase.from("products").select("data").eq("id", r.p.id).single();
      if (!p) continue;
      const keys = Object.keys(p.data);
      const key = field === "precio" ? ["precio", "precio_venta", "price"].map((k) => keys.find((x) => x.toLowerCase() === k)).find(Boolean) ?? "precio" : "precio_mayorista";
      const { error } = await supabase.from("products").update({ data: { ...p.data, [key]: r.next } }).eq("id", r.p.id);
      if (error) continue;
      await supabase.from("price_history").insert({ user_id: user!.id, product_id: r.p.id, field, old_value: r.base, new_value: r.next, source: "masivo" });
      ok++;
    }
    setSaving(false);
    toast("success", `${ok} precio${ok === 1 ? "" : "s"} actualizado${ok === 1 ? "" : "s"}`);
    setProducts((ps) => ps.map((p) => {
      const r = preview.find((x) => x.p.id === p.id);
      return r ? { ...p, data: { ...p.data, [field]: r.next } } : p;
    }));
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="animate-in">
        <Link href="/products" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"><IconArrowLeft size={16} /> Mi inventario</Link>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Cambiar precios</h1>
        <p className="text-sm text-slate-500">Sube o baja los precios de una categoría entera de una vez. Cada cambio queda en el historial del producto.</p>
      </header>
      <CoachTip screen="prices" title="Un cambio para muchos productos">
        Elige la categoría, cuánto cambiar (por ejemplo +10 %) y revisa la vista previa antes de aplicar. Con «Margen sobre el costo» el precio se calcula desde el precio de compra.
      </CoachTip>

      <section className="animate-in card grid gap-3 p-4 sm:grid-cols-2">
        <label className="text-xs font-semibold uppercase text-slate-500">
          Categoría
          <select className="input mt-1 normal-case" value={catId} onChange={(e) => setCatId(e.target.value)}>
            <option value="">Todo el inventario</option>
            {categories.filter((c) => !c.parent_id).map((c) => <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ` : ""}{c.name}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold uppercase text-slate-500">
          Qué precio
          <select className="input mt-1 normal-case" value={field} onChange={(e) => setField(e.target.value as Field)}>
            <option value="precio">Precio de venta</option>
            <option value="precio_mayorista">Precio mayorista</option>
          </select>
        </label>
        <label className="text-xs font-semibold uppercase text-slate-500">
          Cómo cambiar
          <select className="input mt-1 normal-case" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            <option value="pct">Porcentaje (+10 % / −5 %)</option>
            <option value="amount">Monto fijo (+2 Bs / −1 Bs)</option>
            <option value="margin">Margen sobre el costo (costo + 30 %)</option>
          </select>
        </label>
        <label className="text-xs font-semibold uppercase text-slate-500">
          {mode === "amount" ? "Monto (Bs)" : "Porcentaje (%)"}
          <input type="number" step="any" inputMode="decimal" className="input mt-1 text-lg font-bold tabular-nums" value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <label className="text-xs font-semibold uppercase text-slate-500 sm:col-span-2">
          Redondear
          <div className="mt-1 flex gap-2">
            {([["0.5", "a 0,50"], ["1", "a 1 Bs"], ["none", "sin redondear"]] as [Round, string][]).map(([k, t]) => (
              <button key={k} type="button" onClick={() => setRound(k)} className={`chip ${round === k ? "chip-active" : ""}`}>{t}</button>
            ))}
          </div>
        </label>
      </section>

      {loading ? (
        <ListSkeleton rows={4} />
      ) : (
        <section className="animate-in card p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-bold text-ink">Vista previa · {preview.length} de {scope.length} cambian</h2>
          </div>
          {preview.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-500">{mode === "margin" ? "Ningún producto de esta categoría tiene precio de compra." : "Nada que cambiar con esos valores."}</p>
          ) : (
            <ul className="max-h-[50vh] divide-y divide-slate-100 overflow-y-auto">
              {preview.map(({ p, base, next }) => (
                <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{String(p.data.nombre || "Sin nombre")}</span>
                  <span className="tabular-nums text-slate-400 line-through">{base === null ? "—" : `Bs ${fmtMoney(base)}`}</span>
                  <span className="font-bold tabular-nums text-emerald-700">Bs {fmtMoney(next!)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="sticky-action">
        <button onClick={apply} disabled={saving || !preview.length} className="btn-primary btn-lg w-full">
          {saving ? <Spinner /> : <IconCheck size={20} />} Aplicar a {preview.length} producto{preview.length === 1 ? "" : "s"}
        </button>
      </div>
    </div>
  );
}
