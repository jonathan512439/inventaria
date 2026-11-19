"use client";

import type { Product, ProductVariant } from "@/types/database";
import { productTitle } from "@/lib/fields";
import Sheet from "./ui/Sheet";

/** «¿Cuál?»: elegir la talla, color… de un producto con variantes (buscador, escáner y lista de productos). */
export default function VariantPickSheet({
  picking,
  onPick,
  onClose,
  showStock = true,
  disableOutOfStock = false,
}: {
  picking: { product: Product; variants: ProductVariant[] } | null;
  onPick: (product: Product, variant: ProductVariant) => void;
  onClose: () => void;
  showStock?: boolean;
  /** En Vender, las variantes en 0 se muestran apagadas (igual se pueden elegir con el escáner) */
  disableOutOfStock?: boolean;
}) {
  return (
    <Sheet open={!!picking} onClose={onClose} title={picking ? `${productTitle(picking.product.data)} · ¿cuál?` : ""}>
      {picking && (
        <div className="grid grid-cols-2 gap-2">
          {picking.variants.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => onPick(picking.product, v)}
              disabled={disableOutOfStock && v.stock <= 0}
              className="min-h-[56px] rounded-2xl border-2 border-violet-300 bg-white px-3 py-2 text-left font-semibold text-violet-900 transition hover:bg-violet-50 disabled:opacity-40"
            >
              <span className="block">{v.label}</span>
              {showStock && <span className={`block text-xs font-normal ${v.stock <= 0 ? "text-danger-600" : "text-muted"}`}>{v.stock} en stock</span>}
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}
