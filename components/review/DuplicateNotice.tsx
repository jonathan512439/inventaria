"use client";

import Link from "next/link";
import { IconCheck, Spinner } from "@/components/ui/Icons";

/** «¿Ya lo tienes?»: la IA encontró un producto parecido; sumar el stock a ese o seguir como producto nuevo. */
export default function DuplicateNotice({
  dup,
  qty,
  busy,
  onMerge,
  onNotDuplicate,
}: {
  dup: { product_id: string; nombre: string; motivo: string };
  qty: number;
  busy: boolean;
  onMerge: () => void;
  onNotDuplicate: () => void;
}) {
  return (
    <section className="rounded-2xl border-2 border-warn-300 bg-warn-50 p-3">
      <p className="text-sm font-bold text-warn-900">¿Es el mismo producto que ya tienes?</p>
      <p className="mt-0.5 text-xs text-warn-800">
        <b>«{dup.nombre}»</b> · {dup.motivo}.{" "}
        <Link href={`/products/${dup.product_id}`} className="font-semibold underline">Ver ese producto</Link>
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button type="button" disabled={busy} onClick={onMerge} className="btn-success btn-sm min-h-[44px]">
          {busy ? <Spinner size={14} /> : <IconCheck size={14} />} Sí, sumar {qty} al stock
        </button>
        <button type="button" disabled={busy} onClick={onNotDuplicate} className="btn-secondary btn-sm min-h-[44px]">No, es otro</button>
      </div>
    </section>
  );
}
