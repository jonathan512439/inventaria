"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Category } from "@/types/database";
import { DEFAULT_ALERTS } from "@/lib/inventory";
import { categoryColor } from "@/lib/colors";
import { friendlyError } from "@/lib/errors";
import { useFlow } from "@/components/FlowProvider";
import { useToast } from "@/components/ui/Toast";
import { IconCheck, Spinner } from "@/components/ui/Icons";

/**
 * Ajustes › Avisos (antes /alerts, F16): mínimo y días de vencimiento del negocio, mínimo y silencio por
 * categoría, y lo silenciado para volver a activarlo. El mínimo de UN producto se pone en su ficha (pestaña Stock).
 * Misma regla que la lista de pedido y que la base (027 · restock_lines).
 */
export default function AlertsSection() {
  const supabase = createClient();
  const toast = useToast();
  const flow = useFlow();
  const [categories, setCategories] = useState<Category[]>([]);
  const [muted, setMuted] = useState<{ id: string; nombre: string | null }[]>([]);
  const [minStock, setMinStock] = useState("");
  const [expiryDays, setExpiryDays] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [c, p] = await Promise.all([
      supabase.from("categories").select("*").is("parent_id", null).order("name"),
      supabase.from("product_summaries").select("id,nombre").eq("status", "confirmed").eq("alerts_off", true).order("nombre").limit(100),
    ]);
    setCategories(c.data ?? []);
    setMuted((p.data ?? []) as { id: string; nombre: string | null }[]);
  }, [supabase]);
  useEffect(() => {
    load();
  }, [load]);

  // Los avisos generales son del NEGOCIO (023): los mismos para todo el equipo
  const biz = flow.business;
  useEffect(() => {
    if (!biz) return;
    setMinStock(biz.min_stock_default === null || biz.min_stock_default === undefined ? "" : String(biz.min_stock_default));
    setExpiryDays(biz.expiry_days === null || biz.expiry_days === undefined ? "" : String(biz.expiry_days));
  }, [biz]);
  const general = minStock.trim() === "" ? DEFAULT_ALERTS.minStock : parseInt(minStock, 10) || 0;

  async function saveGeneral() {
    if (!biz) return;
    setSaving(true);
    const min = minStock.trim() === "" ? null : Math.max(0, parseInt(minStock, 10) || 0);
    const days = expiryDays.trim() === "" ? null : Math.min(365, Math.max(1, parseInt(expiryDays, 10) || 30));
    const { error } = await supabase.from("businesses").update({ min_stock_default: min, expiry_days: days }).eq("id", biz.id);
    setSaving(false);
    if (error) return toast("error", friendlyError(error));
    toast("success", "Avisos guardados para todo el equipo");
    flow.refresh();
  }

  async function setCategoryMin(cat: Category, raw: string) {
    const v = raw.trim() === "" ? null : Math.max(0, parseInt(raw, 10) || 0);
    if (v === (cat.min_stock_default ?? null)) return;
    const { error } = await supabase.from("categories").update({ min_stock_default: v }).eq("id", cat.id);
    if (error) return toast("error", friendlyError(error));
    setCategories((cs) => cs.map((c) => (c.id === cat.id ? { ...c, min_stock_default: v } : c)));
    toast("success", v === null ? `«${cat.name}» usa el mínimo general` : `«${cat.name}»: avisa desde ${v}`);
  }
  async function toggleCategory(cat: Category) {
    const next = !cat.alerts_off;
    const { error } = await supabase.from("categories").update({ alerts_off: next }).eq("id", cat.id);
    if (error) return toast("error", friendlyError(error));
    setCategories((cs) => cs.map((c) => (c.id === cat.id ? { ...c, alerts_off: next } : c)));
    toast("success", next ? `«${cat.name}» ya no avisa` : `«${cat.name}» vuelve a avisar`);
  }
  async function unmute(id: string) {
    const { error } = await supabase.from("products").update({ alerts_off: false }).eq("id", id);
    if (error) return toast("error", friendlyError(error));
    setMuted((m) => m.filter((x) => x.id !== id));
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs font-semibold text-muted">
          Avisar desde
          <input type="number" min={0} inputMode="numeric" className="input mt-1 min-h-[48px] text-lg font-bold tabular-nums" placeholder={String(DEFAULT_ALERTS.minStock)} value={minStock} onChange={(e) => setMinStock(e.target.value)} />
          <span className="mt-1 block font-normal">unidades o menos = «por reponer»</span>
        </label>
        <label className="text-xs font-semibold text-muted">
          Vencimiento
          <input type="number" min={1} max={365} inputMode="numeric" className="input mt-1 min-h-[48px] text-lg font-bold tabular-nums" placeholder={String(DEFAULT_ALERTS.expiryDays)} value={expiryDays} onChange={(e) => setExpiryDays(e.target.value)} />
          <span className="mt-1 block font-normal">días antes de que venza</span>
        </label>
      </div>
      <button type="button" onClick={saveGeneral} disabled={saving} className="btn-primary min-h-[48px] w-full">{saving ? <Spinner size={16} /> : <IconCheck size={18} />} Guardar</button>

      {categories.length > 0 && (
        <div>
          <p className="text-sm font-bold text-ink">Por categoría</p>
          <p className="text-xs text-muted">Vacío = usa el general ({general}). Apaga el interruptor si esa categoría no debe avisar nunca. El mínimo de un producto se pone en su ficha.</p>
          <ul className="mt-1 divide-y divide-slate-100">
            {categories.map((c) => {
              const col = categoryColor(c.name);
              return (
                <li key={c.id} className="flex min-h-[56px] items-center gap-3 py-1.5">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-lg ring-1 ${col.bg} ${col.ring}`}>{c.icon || "🏷️"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-ink">{c.name}</span>
                    {c.alerts_off && <span className="block text-xs text-muted">sin avisos</span>}
                  </span>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    className="input min-h-[44px] w-20 text-center font-bold tabular-nums disabled:opacity-40"
                    placeholder={String(general)}
                    defaultValue={c.min_stock_default ?? ""}
                    disabled={c.alerts_off}
                    onBlur={(e) => setCategoryMin(c, e.target.value)}
                    aria-label={`Mínimo de ${c.name}`}
                  />
                  <button type="button" role="switch" aria-checked={!c.alerts_off} onClick={() => toggleCategory(c)} className="grid h-11 w-14 shrink-0 place-items-center" aria-label={c.alerts_off ? `Activar avisos de ${c.name}` : `Silenciar avisos de ${c.name}`}>
                    <span className={`relative h-6 w-11 rounded-full transition ${c.alerts_off ? "bg-slate-300" : "bg-ok-500"}`}>
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${c.alerts_off ? "left-0.5" : "left-[22px]"}`} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {muted.length > 0 && (
        <div>
          <p className="text-sm font-bold text-ink">Productos sin avisos ({muted.length})</p>
          <p className="text-xs text-muted">Los que quitaste de la lista de pedido con la ×.</p>
          <ul className="mt-1 max-h-64 divide-y divide-slate-100 overflow-y-auto overscroll-contain">
            {muted.map((p) => (
              <li key={p.id} className="flex min-h-[52px] items-center gap-2 py-1">
                <Link href={`/products/${p.id}`} className="min-w-0 flex-1 truncate font-medium text-ink">{p.nombre || "Sin nombre"}</Link>
                <button type="button" onClick={() => unmute(p.id)} className="btn-secondary btn-sm min-h-[44px]">Volver a avisar</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
