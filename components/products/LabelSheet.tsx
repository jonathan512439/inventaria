"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import type { Product, ProductVariant } from "@/types/database";
import { money, priceOf, stockOf } from "@/lib/inventory";
import { productTitle } from "@/lib/fields";
import { useFlow } from "@/components/FlowProvider";
import Sheet from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { IconPrinter, IconTag, Spinner } from "@/components/ui/Icons";

type Row = { key: string; productId: string; variantId: string | null; name: string; variant: string | null; code: string | null; price: number | null; stock: number };
type Format = "a4" | "roll";

/**
 * Etiquetas de los productos elegidos (antes /labels): código Code 128 con nombre y precio, en hoja A4
 * (24 por hoja) o rollo de 50×30 mm. A los que no tienen código se les crea uno interno (IA + 6 números)
 * que el escáner de la app reconoce igual que uno de fábrica.
 */
export default function LabelSheet({
  open,
  onClose,
  products,
  variantsOf,
  usedCodes,
  onCodesAssigned,
}: {
  open: boolean;
  onClose: () => void;
  products: Product[];
  variantsOf: Map<string, ProductVariant[]>;
  /** Todos los códigos del negocio (para que el interno nuevo no se repita) */
  usedCodes: Set<string>;
  onCodesAssigned: () => void;
}) {
  const supabase = createClient();
  const toast = useToast();
  const confirm = useConfirm();
  const flow = useFlow();
  const [copies, setCopies] = useState<Record<string, number>>({});
  const [format, setFormat] = useState<Format>("a4");
  const [showPrice, setShowPrice] = useState(true);
  const [assigning, setAssigning] = useState(false);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    products.forEach((p) => {
      const name = productTitle(p.data) || "Sin nombre";
      const price = priceOf(p);
      const vs = variantsOf.get(p.id);
      if (vs?.length) vs.forEach((v) => out.push({ key: v.id, productId: p.id, variantId: v.id, name, variant: v.label, code: v.codigo_barras || null, price: v.precio ?? price, stock: v.stock }));
      else out.push({ key: p.id, productId: p.id, variantId: null, name, variant: null, code: String(p.data.codigo_barras || "") || null, price, stock: stockOf(p) ?? 0 });
    });
    return out;
  }, [products, variantsOf]);
  const copiesOf = (r: Row) => copies[r.key] ?? 1;
  const withoutCode = rows.filter((r) => !r.code);
  const labels = useMemo(() => rows.filter((r) => r.code).flatMap((r) => Array.from({ length: copies[r.key] ?? 1 }, (_, i) => ({ ...r, i }))), [rows, copies]);

  async function assignInternalCodes() {
    const ok = await confirm({ title: `¿Crear código interno para ${withoutCode.length}?`, body: "Se guarda como su código de barras (IA + 6 números). La cámara de la app lo reconocerá al vender o contar.", confirmLabel: "Crear códigos" });
    if (!ok) return;
    setAssigning(true);
    const used = new Set(usedCodes);
    const fresh = () => {
      for (;;) {
        const c = "IA" + String(Math.floor(100000 + Math.random() * 900000));
        if (!used.has(c)) {
          used.add(c);
          return c;
        }
      }
    };
    let done = 0;
    for (const r of withoutCode) {
      const code = fresh();
      // Columna del sistema (020): la base lo copia a `data` con la clave que ya use el producto
      const { error } = r.variantId
        ? await supabase.from("product_variants").update({ codigo_barras: code }).eq("id", r.variantId)
        : await supabase.from("products").update({ codigo_barras: code }).eq("id", r.productId);
      if (!error) done++;
    }
    setAssigning(false);
    toast(done ? "success" : "error", done ? `${done} código${done === 1 ? "" : "s"} interno${done === 1 ? "" : "s"} creado${done === 1 ? "" : "s"}` : "No se pudieron crear los códigos");
    onCodesAssigned();
  }

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        wide
        title={`Etiquetas · ${labels.length}`}
        footer={
          <button onClick={() => window.print()} disabled={!labels.length} className="btn-primary btn-lg w-full">
            <IconPrinter size={20} /> Imprimir {labels.length} etiqueta{labels.length === 1 ? "" : "s"}
          </button>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setFormat("a4")} className={`chip min-h-[40px] ${format === "a4" ? "chip-active" : ""}`}>Hoja A4 (24)</button>
            <button onClick={() => setFormat("roll")} className={`chip min-h-[40px] ${format === "roll" ? "chip-active" : ""}`}>Rollo 50×30</button>
            <label className="ml-auto flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} /> Con precio</label>
          </div>
          {withoutCode.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-warn-50 px-3 py-2 text-sm text-warn-800">
              <span className="flex-1">{withoutCode.length} no tiene{withoutCode.length === 1 ? "" : "n"} código y no se imprime{withoutCode.length === 1 ? "" : "n"} todavía.</span>
              <button onClick={assignInternalCodes} disabled={assigning} className="btn-primary btn-sm">{assigning ? <Spinner size={14} /> : <IconTag size={14} />} Crear códigos internos</button>
            </div>
          )}
          <ul className="max-h-[45vh] divide-y divide-slate-100 overflow-y-auto rounded-2xl ring-1 ring-slate-900/10">
            {rows.map((r) => (
              <li key={r.key} className={`flex items-center gap-2 px-3 py-2 ${r.code ? "" : "opacity-60"}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{r.name}{r.variant ? <span className="font-normal text-muted"> · {r.variant}</span> : null}</span>
                  <span className="block truncate text-xs text-muted">{r.code ? <span className="font-mono">{r.code}</span> : <span className="text-warn-700">sin código</span>}{r.price !== null ? ` · ${money(r.price)}` : ""} · {r.stock} en stock</span>
                </span>
                {r.code && (
                  <span className="flex shrink-0 items-center gap-1">
                    <input type="number" inputMode="numeric" min={1} max={200} aria-label="Copias" className="input h-11 w-16 py-1 text-center" value={copiesOf(r)} onChange={(e) => setCopies({ ...copies, [r.key]: Math.max(1, Math.min(200, Number(e.target.value) || 1)) })} />
                    <button onClick={() => setCopies({ ...copies, [r.key]: Math.max(1, Math.min(200, r.stock)) })} className="btn-ghost btn-sm min-h-[44px]" title="Una por unidad en stock">= stock</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          {labels.length > 0 && (
            <details>
              <summary className="cursor-pointer py-2 text-sm font-semibold text-brand-700">Ver cómo quedan</summary>
              <div className={`origin-top-left ${format === "a4" ? "labels-a4" : "labels-roll"}`}>
                {labels.slice(0, 6).map((l) => (
                  <Label key={`p-${l.key}-${l.i}`} code={l.code!} name={l.name} variant={l.variant} price={showPrice ? l.price : null} business={flow.business?.name ?? ""} />
                ))}
              </div>
            </details>
          )}
        </div>
      </Sheet>

      {/* Hoja que se imprime: fuera de la hoja inferior, invisible en pantalla */}
      {open && labels.length > 0 && typeof document !== "undefined" &&
        createPortal(
          <div id="labels-sheet" className={`hidden print:block ${format === "a4" ? "labels-a4" : "labels-roll"}`}>
            {labels.map((l) => (
              <Label key={`${l.key}-${l.i}`} code={l.code!} name={l.name} variant={l.variant} price={showPrice ? l.price : null} business={flow.business?.name ?? ""} />
            ))}
          </div>,
          document.body
        )}

      <style jsx global>{`
        .label { display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; background: #fff; color: #000; box-sizing: border-box; padding: 2mm 2.5mm; break-inside: avoid; }
        .label .l-name { font: 700 9.5pt/1.1 system-ui, sans-serif; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
        .label .l-sub { font: 500 7.5pt/1.1 system-ui, sans-serif; color: #444; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .label .l-price { font: 800 11pt/1 system-ui, sans-serif; white-space: nowrap; }
        .label svg { width: 100%; height: 11mm; }
        .labels-a4 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2mm; }
        .labels-a4 .label { height: 34mm; border: 1px dashed #ddd; }
        .labels-roll { display: grid; grid-template-columns: repeat(auto-fill, 50mm); gap: 2mm; }
        .labels-roll .label { width: 50mm; height: 30mm; border: 1px dashed #ddd; }
        @media print {
          @page { margin: 8mm; }
          body * { visibility: hidden !important; }
          #labels-sheet, #labels-sheet * { visibility: visible !important; }
          #labels-sheet { position: absolute; left: 0; top: 0; width: 100%; margin: 0; padding: 0; }
          .labels-a4 { gap: 0; }
          .labels-a4 .label { border: none; height: 35mm; }
          .labels-roll { display: block; }
          .labels-roll .label { border: none; page-break-after: always; }
        }
      `}</style>
      <style jsx global>{`
        ${format === "roll" ? "@media print { @page { size: 50mm 30mm; margin: 0; } }" : "@media print { @page { size: A4 portrait; } }"}
      `}</style>
    </>
  );
}

/** Una etiqueta: nombre, variante, precio y el código en Code 128 (la app lo lee con la cámara). */
function Label({ code, name, variant, price, business }: { code: string; name: string; variant: string | null; price: number | null; business: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    let alive = true;
    import("jsbarcode").then(({ default: JsBarcode }) => {
      if (!alive || !ref.current) return;
      try {
        JsBarcode(ref.current, code, { format: "CODE128", displayValue: true, fontSize: 10, height: 34, width: 1.4, margin: 0, textMargin: 1, font: "system-ui" });
      } catch {
        /* código con caracteres raros: se deja vacío */
      }
    });
    return () => {
      alive = false;
    };
  }, [code]);
  return (
    <div className="label">
      <div>
        <div className="l-name">{name}</div>
        {(variant || business) && <div className="l-sub">{[variant, business].filter(Boolean).join(" · ")}</div>}
      </div>
      <svg ref={ref} />
      {price !== null && <div className="l-price">{money(price)}</div>}
    </div>
  );
}
