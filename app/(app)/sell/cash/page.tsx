"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CashClosing, CashMovement, CashSummary } from "@/types/database";
import { cashSummary, closeCash, newOpId } from "@/lib/data/ops";
import { friendlyError } from "@/lib/errors";
import { currencyLabel, fmtMoney, money } from "@/lib/inventory";
import { METHOD_LABEL } from "@/lib/sales";
import { ScreenHeader } from "@/components/ui/Screen";
import { useFlow } from "@/components/FlowProvider";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { IconCheck, IconPlus, Spinner } from "@/components/ui/Icons";
import { businessDayStart } from "@/lib/dates";

/**
 * Caja del día (022): lo calcula el servidor desde los COBROS del día por medio (ventas + abonos de fiados),
 * más ingresos y retiros. Cada cierre es una fila nueva: volver a cerrar no borra el anterior y los días
 * cerrados no cambian si después alguien paga una deuda vieja.
 */
export default function CashPage() {
  const supabase = createClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { isOwner } = useFlow();
  const [sm, setSm] = useState<CashSummary | null>(null);
  const [moves, setMoves] = useState<CashMovement[]>([]);
  const [closings, setClosings] = useState<CashClosing[]>([]);
  const [loading, setLoading] = useState(true);
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [moveForm, setMoveForm] = useState<{ tipo: "ingreso" | "retiro"; amount: string; note: string } | null>(null);
  // Id del cierre en curso (idempotencia): se renueva al guardarlo
  const [closeId, setCloseId] = useState(newOpId);

  const load = useCallback(async () => {
    const start = businessDayStart();
    try {
      const [summary, m, c] = await Promise.all([
        cashSummary(supabase),
        supabase.from("cash_movements").select("*").gte("created_at", start.toISOString()).order("created_at", { ascending: false }),
        supabase.from("cash_closings_v").select("*").order("closed_at", { ascending: false }).limit(20),
      ]);
      setSm(summary);
      setMoves((m.data ?? []) as CashMovement[]);
      setClosings((c.data ?? []) as CashClosing[]);
    } catch (e) {
      toast("error", friendlyError(e, "No se pudo cargar la caja"));
    }
    setLoading(false);
  }, [supabase, toast]);
  useEffect(() => {
    load();
  }, [load]);

  const todayClosing = sm?.last_closing ?? null;
  const byMethod = sm?.by_method ?? { efectivo: 0, qr: 0, transferencia: 0 };
  const abonos = sm?.abonos_by_method ?? { efectivo: 0, qr: 0, transferencia: 0 };
  const totalSales = Number(sm?.total_sales ?? 0);
  const collected = Number(sm?.collected_sales ?? 0) + Number(sm?.collected_abonos ?? 0);
  const pending = Number(sm?.credit_given ?? 0);
  const profit = Number(sm?.profit ?? 0);
  const salesCount = sm?.sales_count ?? 0;
  const expectedCash = Number(sm?.expected_cash ?? 0);
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
    if (error) return toast("error", friendlyError(error));
    setMoveForm(null);
    toast("success", moveForm.tipo === "retiro" ? `Retiro de ${money(amount)} anotado` : `Ingreso de ${money(amount)} anotado`);
    load();
  }

  async function close() {
    const ok = await confirm({
      title: todayClosing ? "¿Cerramos la caja otra vez?" : "¿Cerramos la caja de hoy?",
      body: countedNum === null ? "No escribiste cuánto efectivo contaste; se guardará el cierre sin comparar." : diff === 0 ? "El efectivo contado coincide con lo que debería haber." : `Hay una diferencia de ${money(Math.abs(diff!))} ${diff! > 0 ? "de más" : "de menos"}. Quedará anotada.`,
      details: [
        { label: "Ventas de hoy", value: `${salesCount} · ${money(totalSales)}` },
        ...(Number(sm?.collected_abonos ?? 0) > 0 ? [{ label: "Abonos de fiados", value: `${money(Number(sm?.collected_abonos))}` }] : []),
        { label: "Efectivo que debería haber", value: `${money(expectedCash)}` },
        ...(countedNum !== null ? [{ label: "Efectivo contado", value: `${money(countedNum)}`, tone: (diff === 0 ? "ok" : "warn") as "ok" | "warn" }] : []),
        ...(isOwner ? [{ label: "Ganancia del día", value: `${money(profit)}`, tone: "ok" as const }] : []),
      ],
      confirmLabel: "Cerrar caja",
      tone: "success",
    });
    if (!ok) return;
    setSaving(true);
    try {
      // El servidor recalcula todo al cerrar (no se guarda lo que muestra la pantalla) y guarda un cierre nuevo
      await closeCash(supabase, { id: closeId, counted: countedNum, note: note.trim() || null });
      setCloseId(newOpId());
    } catch (e) {
      setSaving(false);
      return toast("error", friendlyError(e, "No se pudo cerrar la caja"));
    }
    setSaving(false);
    setCounted("");
    setNote("");
    navigator.vibrate?.(30);
    toast("success", "Caja cerrada");
    load();
  }

  return (
    <div className="has-action mx-auto max-w-2xl space-y-4">
      <ScreenHeader
        title="Caja de hoy"
        subtitle="Cuánto entró, cuánto salió y cuánto efectivo debería haber. Al final del día, cuenta y cierra."
        back={{ href: "/sell", label: "Vender" }}
        help={<p>Anota si sacaste dinero de la caja (gastos) o pusiste cambio. Al terminar el día, cuenta el efectivo, escríbelo y toca <b>Cerrar caja</b>: la app te dice si cuadra.</p>}
      />

      {loading ? (
        <ListSkeleton rows={4} />
      ) : (
        <>
          {todayClosing && (
            <p className="animate-in rounded-2xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              Hoy ya cerraste la caja a las {new Date(todayClosing.closed_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}. Si vendiste o cobraste algo después, puedes cerrar otra vez: queda un cierre nuevo y el anterior se conserva en la lista.
            </p>
          )}

          <section className="animate-in grid grid-cols-2 gap-2">
            <div className="rounded-3xl bg-emerald-600 p-4 text-white shadow-float">
              <p className="text-xs font-semibold uppercase tracking-wide text-white/70">Vendido hoy</p>
              <p className="text-2xl font-bold tabular-nums">{money(totalSales)}</p>
              <p className="text-xs text-white/80">{salesCount} venta{salesCount === 1 ? "" : "s"}{isOwner ? ` · ganancia ${money(profit)}` : ""}</p>
            </div>
            <div className="rounded-3xl bg-white p-4 shadow-card ring-1 ring-slate-900/10">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cobrado</p>
              <p className="text-2xl font-bold tabular-nums text-ink">{money(collected)}</p>
              <p className="text-xs text-slate-500">
                {pending > 0 ? `${money(pending)} quedaron fiados` : "todo cobrado"}
                {Number(sm?.collected_abonos ?? 0) > 0 ? ` · incluye ${money(Number(sm?.collected_abonos))} de abonos` : ""}
              </p>
            </div>
          </section>

          <section className="animate-in card space-y-2 p-4">
            <p className="text-sm font-bold text-ink">Por cómo pagaron</p>
            <ul className="divide-y divide-slate-100 text-sm">
              {(["efectivo", "qr", "transferencia"] as const).map((m) => (
                <li key={m} className="flex items-center justify-between py-2">
                  <span className="text-slate-600">
                    {METHOD_LABEL[m]}
                    {Number(abonos[m]) > 0 && <span className="block text-xs text-slate-500">incluye {money(Number(abonos[m]))} de abonos de fiados</span>}
                  </span>
                  <span className="font-semibold tabular-nums">{money(Number(byMethod[m]))}</span>
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
                <input type="number" min={0} step="any" inputMode="decimal" className="input py-1.5 tabular-nums" placeholder={currencyLabel()} value={moveForm.amount} onChange={(e) => setMoveForm({ ...moveForm, amount: e.target.value })} autoFocus />
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
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${m.tipo === "retiro" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-800"}`}>{m.tipo === "retiro" ? "salió" : "entró"}</span>
                    <span className="min-w-0 flex-1 truncate text-slate-600">{m.note || (m.tipo === "retiro" ? "Retiro" : "Ingreso")}</span>
                    <span className="font-semibold tabular-nums">{m.tipo === "retiro" ? "−" : "+"}{money(Number(m.amount))}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="animate-in card space-y-3 p-4">
            <p className="text-sm font-bold text-ink">Cuenta el efectivo</p>
            <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2 text-sm">
              <span className="text-slate-600">Debería haber en efectivo</span>
              <span className="font-bold tabular-nums text-ink">{money(expectedCash)}</span>
            </div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              ¿Cuánto hay en la caja?
              <input type="number" min={0} step="any" inputMode="decimal" className="input mt-1 text-2xl font-bold tabular-nums" placeholder="0" value={counted} onChange={(e) => setCounted(e.target.value)} />
            </label>
            {diff !== null && (
              <p className={`rounded-2xl px-3 py-2 text-sm font-semibold ${diff === 0 ? "bg-emerald-50 text-emerald-800" : diff > 0 ? "bg-amber-50 text-amber-800" : "bg-rose-50 text-rose-800"}`}>
                {diff === 0 ? "✓ Cuadra perfecto" : diff > 0 ? `Hay ${money(diff)} de más` : `Faltan ${money(-diff)}`}
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
                      <span className="block font-semibold text-ink">{new Date(c.day + "T00:00:00").toLocaleDateString("es", { weekday: "short", day: "2-digit", month: "short" })} · {new Date(c.closed_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}</span>
                      <span className="block text-xs text-slate-500">{c.sales_count} venta{c.sales_count === 1 ? "" : "s"}{isOwner ? ` · ganancia ${money(Number(c.profit))}` : ""}</span>
                    </span>
                    <span className="font-bold tabular-nums">{money(Number(c.total_sales))}</span>
                    {c.difference !== null && (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${Number(c.difference) === 0 ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{Number(c.difference) === 0 ? "cuadró" : `${Number(c.difference) > 0 ? "+" : ""}${fmtMoney(Number(c.difference))}`}</span>
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
