"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Category, Product, ProductVariant } from "@/types/database";
import { categoryPath } from "@/lib/categories";
import { categoryAlertsOff, minStockOf, needsRestock, stockOf } from "@/lib/inventory";
import { productTitle } from "@/lib/fields";
import { businessDayKey } from "@/lib/dates";
import { friendlyError } from "@/lib/errors";
import { useFlow } from "@/components/FlowProvider";
import Sheet from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { IconDownload, IconX } from "@/components/ui/Icons";

interface Line {
  key: string;
  productId: string;
  name: string;
  variant: string | null;
  where: string;
  stock: number;
  min: number;
  suggested: number;
  supplier: string | null;
}

/** Líneas por reponer: por producto o, si tiene variantes, por cada variante bajo su mínimo. */
export function restockLines(products: Product[], variantsOf: Map<string, ProductVariant[]>, categories: Category[], alerts: ReturnType<typeof useFlow>["alerts"], supplierOf: Map<string, string> = new Map()): Line[] {
  const out: Line[] = [];
  for (const p of products) {
    if (p.status !== "confirmed") continue;
    const name = productTitle(p.data) || "Sin nombre";
    const where = p.category_id ? categoryPath(categories, p.category_id) : "Sin categoría";
    const vs = variantsOf.get(p.id);
    if (vs?.length) {
      if (p.alerts_off || categoryAlertsOff(categories, p.category_id)) continue; // silenciado
      // El mínimo del producto aplica a cada variante salvo que la variante tenga el suyo
      const pmin = minStockOf(p, categories, alerts);
      vs.forEach((v) => {
        const min = typeof v.min_stock === "number" ? v.min_stock : pmin;
        if (v.stock <= min) out.push({ key: v.id, productId: p.id, name, variant: v.label, where, stock: v.stock, min, suggested: Math.max(1, min * 2 - v.stock), supplier: supplierOf.get(p.id) ?? null });
      });
    } else if (needsRestock(p, categories, alerts)) {
      const min = minStockOf(p, categories, alerts);
      const stock = stockOf(p) ?? 0;
      out.push({ key: p.id, productId: p.id, name, variant: null, where, stock, min, suggested: Math.max(1, min * 2 - stock), supplier: supplierOf.get(p.id) ?? null });
    }
  }
  return out.sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name, "es"));
}

/**
 * Lista de pedido (antes /restock): lo que está bajo su mínimo, agrupado por el último proveedor,
 * con la cantidad sugerida editable; se comparte por WhatsApp o se descarga en Excel.
 */
export default function RestockSheet({
  open,
  onClose,
  products,
  variantsOf,
  categories,
  onDismissed,
}: {
  open: boolean;
  onClose: () => void;
  products: Product[];
  variantsOf: Map<string, ProductVariant[]>;
  categories: Category[];
  /** Se dejó de avisar de este producto (alerts_off); `false` = se deshizo */
  onDismissed: (productId: string, off: boolean) => void;
}) {
  const supabase = createClient();
  const toast = useToast();
  const { alerts } = useFlow();
  const [supplierOf, setSupplierOf] = useState<Map<string, string>>(new Map());
  const [qty, setQty] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    supabase
      .from("purchase_items")
      .select("product_id,created_at,purchases(supplier_name)")
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data }) => {
        const m = new Map<string, string>();
        (data ?? []).forEach((r) => {
          const name = (r as unknown as { purchases?: { supplier_name?: string | null } | null }).purchases?.supplier_name;
          if (r.product_id && name && !m.has(r.product_id)) m.set(r.product_id, name);
        });
        setSupplierOf(m);
      });
  }, [open, supabase]);

  const lines = useMemo(() => restockLines(products, variantsOf, categories, alerts, supplierOf), [products, variantsOf, categories, alerts, supplierOf]);
  const grouped = useMemo(() => {
    const g = new Map<string, Line[]>();
    lines.forEach((l) => g.set(l.supplier ?? "Sin proveedor", [...(g.get(l.supplier ?? "Sin proveedor") ?? []), l]));
    return Array.from(g.entries()).sort(([a], [b]) => (a === "Sin proveedor" ? 1 : b === "Sin proveedor" ? -1 : a.localeCompare(b, "es")));
  }, [lines]);
  const qtyOf = (l: Line) => Math.max(0, parseInt(qty[l.key] ?? String(l.suggested), 10) || 0);

  async function dismiss(l: Line) {
    const { error } = await supabase.from("products").update({ alerts_off: true }).eq("id", l.productId);
    if (error) return toast("error", friendlyError(error));
    onDismissed(l.productId, true);
    toast("success", `«${l.name}» ya no aparecerá en los avisos`, {
      label: "Deshacer",
      onClick: async () => {
        await supabase.from("products").update({ alerts_off: false }).eq("id", l.productId);
        onDismissed(l.productId, false);
      },
    });
  }

  function share(only?: string) {
    const parts: string[] = ["*Pedido de reposición*", new Date().toLocaleDateString("es"), ""];
    grouped
      .filter(([sup]) => !only || sup === only)
      .forEach(([sup, ls]) => {
        if (!only) parts.push(`*${sup}*`);
        ls.forEach((l) => qtyOf(l) > 0 && parts.push(`• ${l.name}${l.variant ? ` (${l.variant})` : ""} × ${qtyOf(l)}`));
        parts.push("");
      });
    window.open(`https://wa.me/?text=${encodeURIComponent(parts.join("\n").trim())}`, "_blank");
  }

  async function excel() {
    const XLSX = await import("xlsx");
    const rows = lines.map((l) => ({ Proveedor: l.supplier ?? "", Producto: l.name, Variante: l.variant ?? "", Ubicación: l.where, "Stock actual": l.stock, Mínimo: l.min, "Cantidad a pedir": qtyOf(l) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Reposición");
    XLSX.writeFile(wb, `reposicion-${businessDayKey()}.xlsx`);
    toast("success", "Excel descargado");
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      wide
      title={`Lista de pedido · ${lines.length}`}
      footer={
        lines.length > 0 && (
          <div className="flex gap-2">
            <button onClick={() => share()} className="btn-success flex-1">Compartir por WhatsApp</button>
            <button onClick={excel} className="btn-secondary"><IconDownload size={16} /> Excel</button>
          </div>
        )
      }
    >
      {lines.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">Nada por reponer: todo está por encima de su mínimo.</p>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-muted">
            La cantidad sugerida alcanza para el doble del mínimo; cámbiala antes de compartir. Toca <b>×</b> para dejar de avisar de un producto (se vuelve a activar en{" "}
            <Link href="/alerts" className="font-semibold text-brand-700 underline">Cuándo avisarme</Link>).
          </p>
          {grouped.map(([sup, ls]) => (
            <section key={sup} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-ink">{sup} <span className="font-normal text-muted">· {ls.length}</span></h3>
                {sup !== "Sin proveedor" && <button onClick={() => share(sup)} className="btn-ghost btn-sm">WhatsApp</button>}
              </div>
              <ul className="divide-y divide-slate-100 rounded-2xl ring-1 ring-slate-900/10">
                {ls.map((l) => (
                  <li key={l.key} className="flex items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{l.name}{l.variant ? <span className="text-violet-800"> · {l.variant}</span> : null}</span>
                      <span className="block truncate text-xs text-muted">stock <b className={l.stock <= 0 ? "text-danger-700" : "text-warn-700"}>{l.stock}</b> · mín. {l.min}</span>
                    </span>
                    <label className="flex items-center gap-1 text-xs text-muted">
                      pedir
                      <input type="number" min={0} inputMode="numeric" className="input h-11 w-16 py-1 text-center text-sm font-bold tabular-nums" value={qty[l.key] ?? String(l.suggested)} onChange={(e) => setQty({ ...qty, [l.key]: e.target.value })} />
                    </label>
                    <button onClick={() => dismiss(l)} className="btn-ghost btn-sm h-11 w-11 p-0 text-muted" aria-label="No avisar más de este producto" title="No avisar más"><IconX size={16} /></button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Sheet>
  );
}
