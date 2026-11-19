"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Product, ProductVariant } from "@/types/database";
import { stockOf } from "@/lib/inventory";
import { productTitle } from "@/lib/fields";
import { bizKey } from "@/lib/offline";
import { adjustStock, newOpId } from "@/lib/data/ops";
import { friendlyError } from "@/lib/errors";
import ProductFinder from "@/components/ProductFinder";
import ProductBrowser from "@/components/ProductBrowser";
import Photo from "@/components/ui/Photo";
import { EmptyState, ScreenHeader } from "@/components/ui/Screen";
import { QtyStepper } from "@/components/ui/NumberPad";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { IconArrowRight, IconBox, IconCheck, IconChevronRight, IconTrash, Spinner } from "@/components/ui/Icons";

interface Line {
  key: string;
  /** Id de la operación de esta línea (reintentar no resta dos veces) */
  opId: string;
  product: Product;
  variant: ProductVariant | null;
  qty: number;
}

const MOTIVOS = ["Vendido", "Uso interno", "Merma o rotura", "Vencido", "Devolución al proveedor", "Regalo o muestra"];
const SHOW_LINES = 10;

/**
 * Sacar del stock (R10 · modo «Solo inventario», RECONSTRUCCION_VISUAL.md §8.2): lo que sale del negocio SIN dinero
 * (no hay ventas, caja ni clientes). Buscar, escanear o elegir de la lista → cantidad → motivo → Guardar.
 * Cada línea es una salida (`adjust_stock`, 021) con su id: si se corta la red y se reintenta, no resta dos veces.
 * La lista en curso queda guardada en el teléfono hasta guardarla.
 */
export default function StockOutPage() {
  const supabase = createClient();
  const toast = useToast();
  const confirm = useConfirm();
  const draftKey = bizKey("stock-out-draft");
  const [lines, setLines] = useState<Line[]>([]);
  const [motivo, setMotivo] = useState(MOTIVOS[0]);
  const [restored, setRestored] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const linesRef = useRef(lines);
  linesRef.current = lines;

  useEffect(() => {
    try {
      const d = JSON.parse(localStorage.getItem(draftKey) ?? "null") as { lines?: Line[]; motivo?: string } | null;
      if (d?.lines?.length) setLines(d.lines);
      if (d?.motivo) setMotivo(d.motivo);
    } catch {
      /* sin almacenamiento */
    }
    setRestored(true);
  }, [draftKey]);
  useEffect(() => {
    if (!restored) return;
    try {
      if (lines.length) localStorage.setItem(draftKey, JSON.stringify({ lines, motivo }));
      else localStorage.removeItem(draftKey);
    } catch {
      /* sin almacenamiento */
    }
  }, [restored, lines, motivo, draftKey]);

  function add(p: Product, v: ProductVariant | null) {
    const key = v ? v.id : p.id;
    if (linesRef.current.some((l) => l.key === key)) {
      setLines((ls) => {
        const l = ls.find((x) => x.key === key);
        return l ? [{ ...l, qty: l.qty + 1 }, ...ls.filter((x) => x.key !== key)] : ls;
      });
      return;
    }
    const line: Line = { key, opId: newOpId(), product: p, variant: v, qty: 1 };
    linesRef.current = [line, ...linesRef.current];
    setLines((ls) => (ls.some((l) => l.key === key) ? ls : [line, ...ls]));
  }

  const units = lines.reduce((s, l) => s + l.qty, 0);

  async function save() {
    if (!lines.length) return;
    const ok = await confirm({
      title: "¿Sacamos del stock?",
      body: "Se resta del inventario. No es una venta: no suma dinero.",
      details: [
        { label: "Motivo", value: motivo },
        { label: "Productos", value: String(lines.length) },
        { label: "Unidades que salen", value: `−${units}`, tone: "warn" as const },
      ],
      confirmLabel: "Sí, sacar",
      cancelLabel: "Revisar otra vez",
    });
    if (!ok) return;
    setSaving(true);
    const failed: Line[] = [];
    let firstError: unknown = null;
    for (const l of lines) {
      try {
        await adjustStock(supabase, { id: l.opId, productId: l.product.id, variantId: l.variant?.id ?? null, delta: -l.qty, tipo: "salida", motivo });
      } catch (e) {
        failed.push(l);
        firstError ??= e;
      }
    }
    setSaving(false);
    if (failed.length) {
      setLines(failed);
      return toast("error", `${failed.length} producto${failed.length === 1 ? "" : "s"} no se guardaron: ${friendlyError(firstError)}`);
    }
    navigator.vibrate?.(30);
    toast("success", `Listo: −${units} unidad${units === 1 ? "" : "es"} (${motivo.toLowerCase()})`);
    setLines([]);
  }

  async function discard() {
    const ok = await confirm({ title: "¿Vaciar la lista?", body: "Se quitan todos los productos. El stock no cambia.", confirmLabel: "Vaciar", tone: "danger" });
    if (ok) setLines([]);
  }

  return (
    <div className="has-action mx-auto max-w-2xl space-y-4">
      <ScreenHeader
        title="Sacar del stock"
        subtitle="Lo que sale sin cobrar en la app: vendido, uso interno, merma…"
        back={{ href: "/products", label: "Productos" }}
        help={
          <>
            <p>Busca, escanea o elige de la lista lo que sale. Si lees el mismo producto otra vez, suma 1.</p>
            <p>Elige el <b>motivo</b> y toca <b>Guardar</b>: se resta del stock y queda en el Historial con quién lo hizo.</p>
            <p>No suma dinero. Si quieres cobrar ventas, activa «Inventario y ventas» en Ajustes › Modo de uso.</p>
          </>
        }
      />

      <ProductFinder onPick={add} placeholder="Buscar o escanear lo que sale…" />

      {lines.length === 0 ? (
        <EmptyState icon={<IconArrowRight size={26} />} title="Todavía no agregaste nada" body="Busca o escanea arriba, o toca un producto en la lista." />
      ) : (
        <section className="animate-in card p-0">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
            <p className="text-sm font-bold text-ink">{lines.length} producto{lines.length === 1 ? "" : "s"} · −{units} u.</p>
            <button type="button" onClick={discard} className="btn-ghost btn-sm min-h-[44px] text-danger-700">Vaciar</button>
          </div>
          <ul className="divide-y divide-slate-100">
            {(showAll ? lines : lines.slice(0, SHOW_LINES)).map((l) => {
              const now = (l.variant ? l.variant.stock : stockOf(l.product)) ?? 0;
              return (
                <li key={l.key} className="flex items-center gap-2 px-3 py-2">
                  {l.product.image_url ? (
                    <Photo src={l.product.image_url} wrapperClassName="h-10 w-10 shrink-0 rounded-lg" className="h-10 w-10 object-cover" />
                  ) : (
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-400"><IconBox size={18} /></span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{productTitle(l.product.data) || "Sin nombre"}{l.variant ? <span className="text-violet-800"> · {l.variant.label}</span> : null}</span>
                    <span className={`block text-xs ${l.qty > now ? "font-semibold text-danger-600" : "text-muted"}`}>{now} → <b>{Math.max(0, now - l.qty)}</b>{l.qty > now ? " (no alcanza)" : ""}</span>
                  </span>
                  <QtyStepper value={l.qty} onChange={(n) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: n } : x)))} />
                  <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-danger-50 hover:text-danger-600" aria-label="Quitar de la lista"><IconTrash size={18} /></button>
                </li>
              );
            })}
          </ul>
          {lines.length > SHOW_LINES && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="flex min-h-[44px] w-full items-center justify-center gap-1 border-t border-slate-100 text-sm font-semibold text-brand-700">
              {showAll ? "Mostrar solo los últimos 10" : `Ver los otros ${lines.length - SHOW_LINES} productos`}
              <IconChevronRight size={16} className={showAll ? "-rotate-90" : "rotate-90"} />
            </button>
          )}
        </section>
      )}

      <section className="card space-y-2 p-3">
        <p className="text-sm font-bold text-ink">Motivo</p>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Motivo">
          {MOTIVOS.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={motivo === m} onClick={() => setMotivo(m)} className={`chip min-h-[40px] ${motivo === m ? "chip-active" : ""}`}>{m}</button>
          ))}
        </div>
      </section>

      <ProductBrowser onPick={add} showPrice={false} title="Elegir de la lista" inList={(id) => lines.filter((l) => l.product.id === id).reduce((s, l) => s + l.qty, 0)} />

      <div className="sticky-action">
        <button type="button" onClick={save} disabled={saving || !lines.length} className="btn-primary btn-lg mx-auto flex w-full max-w-2xl">
          {saving ? <Spinner /> : <IconCheck size={20} />} {lines.length ? `Guardar · ${motivo} · −${units} u.` : "Agrega productos para sacar"}
        </button>
      </div>
    </div>
  );
}
