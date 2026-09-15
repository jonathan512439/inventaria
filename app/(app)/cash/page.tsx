"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { CashClosing, CashMovement, PayMethod, Sale } from "@/types/database";
import { fmtMoney } from "@/lib/inventory";
import { METHOD_LABEL } from "@/lib/sales";
import CoachTip from "@/components/CoachTip";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { IconArrowLeft, IconCheck, IconPlus, Spinner } from "@/components/ui/Icons";

const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Caja del día: cuánto entró por cada medio, dinero que salió, cuánto efectivo debería haber y cierre. */
export default function CashPage() {
  const supabase = createClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [sales, setSales] = useState<Sale[]>([]);
  const [moves, setMoves] = useState<CashMovement[]>([]);
  const [closings, setClosings] = useState<CashClosing[]>([]);
  const [todayClosing, setTodayClosing] = useState<CashClosing | null>(null);
  const [loading, setLoading] = useState(true);
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [moveForm, setMoveForm] = useState<{ tipo: "ingreso" | "retiro"; amount: string; note: string } | null>(null);

  const load = useCallback(async () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const [s, m, c, tc] = await Promise.all([
      supabase.from("sales").select("*").gte("created_at", start.toISOString()).order("created_at", { ascending: false }),
      supabase.from("cash_movements").select("*").gte("created_at", start.toISOString()).order("created_at", { ascending: false }),
      supabase.from("cash_closings").select("*").order("day", { ascending: false }).limit(14),
      supabase.from("cash_closings").select("*").eq("day", dayKey()).maybeSingle(),
    ]);
    setSales((s.data ?? []) as Sale[]);
    setMoves((m.data ?? []) as CashMovement[]);
    setClosings((c.data ?? []) as CashClosing[]);
    setTodayClosing((tc.data as CashClosing | null) ?? null);
    setLoading(false);
  }, [supabase]);
  useEffect(() => {
    load();
  }, [load]);

  const byMethod = useMemo(() => {
    const out: Record<PayMethod, number> = { efectivo: 0, qr: 0, transferencia: 0, mixto: 0 };
    sales.forEach((s) => (out[s.method] += Number(s.paid)));
    return out;
  }, [sales]);
  const totalSales = sales.reduce((a, s) => a + Number(s.total), 0);
  const collected = sales.reduce((a, s) => a + Number(s.paid), 0);
  const pending = totalSales - collected;
  const profit = sales.reduce((a, s) => a + (Number(s.total) - Number(s.cost_total)), 0);
  const cashIn = moves.filter((m) => m.tipo === "ingreso").reduce((a, m) => a + Number(m.amount), 0);
  const cashOut = moves.filter((m) => m.tipo === "retiro").reduce((a, m) => a + Number(m.amount), 0);
  const expectedCash = byMethod.efectivo + cashIn - cashOut;
  const countedNum = counted.trim() === "" ? null : Number(counted.replace(",", ".")) || 0;
  const diff = countedNum === null ? null : Math.round((countedNum - expectedCash) * 100) / 100;

  async function addMove() {
    if (!moveForm) return;
    const amount = Number(moveForm.amount.replace(",", ".")) || 0;
    if (amount <= 0) return toast("info", "Escribe un monto");
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from("cash_movements").insert({ user_id: user!.id, tipo: moveForm.tipo, amount, note: moveForm.note.trim() || null });
    if (error) return toast("error", error.message);
    setMoveForm(null);
    toast("success", moveForm.tipo === "retiro" ? `Retiro de Bs ${fmtMoney(amount)} anotado` : `Ingreso de Bs ${fmtMoney(amount)} anotado`);
    load();
  }

  async function close() {
    const ok = await confirm({
      title: todayClosing ? "¿Actualizamos el cierre de hoy?" : "¿Cerramos la caja de hoy?",
      body: countedNum === null ? "No escribiste cuánto efectivo contaste; se guardará el cierre sin comparar." : diff === 0 ? "El efectivo contado coincide con lo que debería haber." : `Hay una diferencia de Bs ${fmtMoney(Math.abs(diff!))} ${diff! > 0 ? "de más" : "de menos"}. Quedará anotada.`,
      details: [
        { label: "Ventas de hoy", value: `${sales.length} · Bs ${fmtMoney(totalSales)}` },
        { label: "Efectivo que debería haber", value: `Bs ${fmtMoney(expectedCash)}` },
        ...(countedNum !== null ? [{ label: "Efectivo contado", value: `Bs ${fmtMoney(countedNum)}`, tone: (diff === 0 ? "ok" : "warn") as "ok" | "warn" }] : []),
        { label: "Ganancia del día", value: `Bs ${fmtMoney(profit)}`, tone: "ok" as const },
      ],
      confirmLabel: "Cerrar caja",
      tone: "success",
    });
    if (!ok) return;
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const row = {
      user_id: user!.id,
      day: dayKey(),
      sales_count: sales.length,
      total_sales: Math.round(totalSales * 100) / 100,
      by_method: byMethod,
      cash_in: cashIn,
      cash_out: cashOut,
      expected_cash: Math.round(expectedCash * 100) / 100,
      counted_cash: countedNum,
      difference: diff,
      profit: Math.round(profit * 100) / 100,
      note: note.trim() || null,
    };
    const { error } = await supabase.from("cash_closings").upsert(row, { onConflict: "user_id,day" });
    setSaving(false);
    if (error) return toast("error", error.message);
    navigator.vibrate?.(30);
    toast("success", "Caja cerrada");
    load();
  }

  return (
    <div className="has-action mx-auto max-w-2xl space-y-4">
      <header className="animate-in">
        <Link href="/movements" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"><IconArrowLeft size={16} /> Ventas y movimientos</Link>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Caja de hoy</h1>
        <p className="text-sm text-slate-500">Cuánto entró, cuánto salió y cuánto efectivo debería haber. Al final del día, cuenta y cierra.</p>
      </header>
      <CoachTip screen="cash" title="Cerrar la caja en 1 minuto">
        Anota si sacaste dinero de la caja (gastos) o pusiste cambio. Al terminar el día, cuenta el efectivo, escríbelo y toca <b>Cerrar caja</b>: la app te dice si cuadra.
      </CoachTip>

      {loading ? (
        <ListSkeleton rows={4} />
      ) : (
        <>
          {todayClosing && (
            <p className="animate-in rounded-2xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              Hoy ya cerraste la caja a las {new Date(todayClosing.closed_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}. Si vendiste más después, puedes volver a cerrar y se actualiza.
            </p>
          )}

          <section className="animate-in grid grid-cols-2 gap-2">
            <div className="rounded-3xl bg-emerald-600 p-4 text-white shadow-float">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-white/70">Vendido hoy</p>
              <p className="text-2xl font-bold tabular-nums">Bs {fmtMoney(totalSales)}</p>
              <p className="text-xs text-white/80">{sales.length} venta{sales.length === 1 ? "" : "s"} · ganancia Bs {fmtMoney(profit)}</p>
            </div>
            <div className="rounded-3xl bg-white p-4 shadow-card ring-1 ring-slate-900/10">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Cobrado</p>
              <p className="text-2xl font-bold tabular-nums text-ink">Bs {fmtMoney(collected)}</p>
              <p className="text-xs text-slate-500">{pending > 0 ? `Bs ${fmtMoney(pending)} quedaron fiados` : "todo cobrado"}</p>
            </div>
          </section>

          <section className="animate-in card space-y-2 p-4">
            <p className="text-sm font-bold text-ink">Por cómo pagaron</p>
            <ul className="divide-y divide-slate-100 text-sm">
              {(["efectivo", "qr", "transferencia"] as PayMethod[]).map((m) => (
                <li key={m} className="flex items-center justify-between py-2">
                  <span className="text-slate-600">{METHOD_LABEL[m]}</span>
                  <span className="font-semibold tabular-nums">Bs {fmtMoney(byMethod[m])}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="animate-in card space-y-2 p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-ink">Dinero que salió o entró aparte</p>
              {!moveForm && (
                <div className="flex gap-1">
                  <button onClick={() => setMoveForm({ tipo: "retiro", amount: "", note: "" })} className="btn-secondary btn-sm">− Retiro</button>
                  <button onClick={() => setMoveForm({ tipo: "ingreso", amount: "", note: "" })} className="btn-secondary btn-sm"><IconPlus size={14} /> Ingreso</button>
                </div>
              )}
            </div>
            {moveForm && (
              <div className="grid gap-2 rounded-2xl bg-slate-50 p-3 sm:grid-cols-[110px_1fr_auto]">
                <input type="number" min={0} step="any" inputMode="decimal" className="input py-1.5 tabular-nums" placeholder="Bs" value={moveForm.amount} onChange={(e) => setMoveForm({ ...moveForm, amount: e.target.value })} autoFocus />
                <input className="input py-1.5" placeholder={moveForm.tipo === "retiro" ? "¿Para qué? (p. ej. pagar al proveedor)" : "¿De dónde? (p. ej. cambio inicial)"} value={moveForm.note} onChange={(e) => setMoveForm({ ...moveForm, note: e.target.value })} />
                <div className="flex gap-1">
                  <button onClick={addMove} className="btn-primary btn-sm">Anotar {moveForm.tipo}</button>
                  <button onClick={() => setMoveForm(null)} className="btn-ghost btn-sm">✕</button>
                </div>
              </div>
            )}
            {moves.length === 0 ? (
              <p className="text-xs text-slate-500">Nada por ahora. Anota aquí si sacas dinero para gastos o pones cambio.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {moves.map((m) => (
                  <li key={m.id} className="flex items-center gap-2 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${m.tipo === "retiro" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-800"}`}>{m.tipo === "retiro" ? "salió" : "entró"}</span>
                    <span className="min-w-0 flex-1 truncate text-slate-600">{m.note || (m.tipo === "retiro" ? "Retiro" : "Ingreso")}</span>
                    <span className="font-semibold tabular-nums">{m.tipo === "retiro" ? "−" : "+"}Bs {fmtMoney(Number(m.amount))}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="animate-in card space-y-3 p-4">
            <p className="text-sm font-bold text-ink">Cuenta el efectivo</p>
            <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2 text-sm">
              <span className="text-slate-600">Debería haber en efectivo</span>
              <span className="font-bold tabular-nums text-ink">Bs {fmtMoney(expectedCash)}</span>
            </div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              ¿Cuánto hay en la caja?
              <input type="number" min={0} step="any" inputMode="decimal" className="input mt-1 text-2xl font-bold tabular-nums" placeholder="0" value={counted} onChange={(e) => setCounted(e.target.value)} />
            </label>
            {diff !== null && (
              <p className={`rounded-2xl px-3 py-2 text-sm font-semibold ${diff === 0 ? "bg-emerald-50 text-emerald-800" : diff > 0 ? "bg-amber-50 text-amber-800" : "bg-rose-50 text-rose-800"}`}>
                {diff === 0 ? "✓ Cuadra perfecto" : diff > 0 ? `Hay Bs ${fmtMoney(diff)} de más` : `Faltan Bs ${fmtMoney(-diff)}`}
              </p>
            )}
            <input className="input" placeholder="Nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
          </section>

          {closings.length > 0 && (
            <section className="animate-in card p-3">
              <h2 className="mb-2 text-sm font-bold text-ink">Cierres anteriores</h2>
              <ul className="divide-y divide-slate-100 text-sm">
                {closings.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-ink">{new Date(c.day + "T00:00:00").toLocaleDateString("es", { weekday: "short", day: "2-digit", month: "short" })}</span>
                      <span className="block text-xs text-slate-500">{c.sales_count} venta{c.sales_count === 1 ? "" : "s"} · ganancia Bs {fmtMoney(Number(c.profit))}</span>
                    </span>
                    <span className="font-bold tabular-nums">Bs {fmtMoney(Number(c.total_sales))}</span>
                    {c.difference !== null && (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${Number(c.difference) === 0 ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{Number(c.difference) === 0 ? "cuadró" : `${Number(c.difference) > 0 ? "+" : ""}${fmtMoney(Number(c.difference))}`}</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <div className="sticky-action">
        <button onClick={close} disabled={saving || loading} className="btn-success btn-lg w-full">
          {saving ? <Spinner /> : <IconCheck size={20} />} {todayClosing ? "Volver a cerrar la caja" : "Cerrar caja de hoy"}
        </button>
      </div>
    </div>
  );
}
