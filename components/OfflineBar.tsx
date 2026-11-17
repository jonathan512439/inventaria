"use client";

import { discardFailedMoves, useOffline } from "@/lib/offline";
import { useConfirm } from "./ui/Confirm";

/** Aviso fijo: sin conexión, cambios guardados en el celular pendientes de enviar y cambios que el servidor rechazó. */
export default function OfflineBar() {
  const { online, pending, failed } = useOffline();
  const confirm = useConfirm();
  if (online && pending === 0 && failed.length === 0) return null;

  async function discard() {
    const ok = await confirm({
      title: "¿Descartar estos cambios?",
      body: "No se pudieron guardar y ya no se volverán a intentar. Revisa el stock de esos productos.",
      details: failed.slice(0, 5).map((m) => ({ label: `${m.product_name ?? "Producto"}${m.variant_label ? ` (${m.variant_label})` : ""}`, value: m.failed ?? "" })),
      confirmLabel: "Descartar",
      tone: "danger",
    });
    if (ok) await discardFailedMoves();
  }

  return (
    <div className="space-y-1">
      {(!online || pending > 0) && (
        <div className={`-mx-4 mb-3 rounded-b-2xl px-4 py-2 text-center text-xs font-semibold md:mx-0 md:rounded-2xl ${online ? "bg-amber-100 text-amber-900" : "bg-slate-800 text-white"}`}>
          {online
            ? `Enviando ${pending} cambio${pending === 1 ? "" : "s"} guardado${pending === 1 ? "" : "s"} sin conexión…`
            : `Sin conexión · puedes consultar y mover stock; ${pending ? `${pending} cambio${pending === 1 ? "" : "s"} se enviará${pending === 1 ? "" : "n"} al reconectar` : "los cambios se guardan en el celular"}`}
        </div>
      )}
      {failed.length > 0 && (
        <div className="-mx-4 mb-3 flex items-center justify-between gap-2 rounded-b-2xl bg-rose-100 px-4 py-2 text-xs font-semibold text-rose-900 md:mx-0 md:rounded-2xl">
          <span>{failed.length} cambio{failed.length === 1 ? "" : "s"} hecho{failed.length === 1 ? "" : "s"} sin conexión no se pudo guardar.</span>
          <button onClick={discard} className="btn-ghost btn-sm text-rose-900 underline">Ver y descartar</button>
        </div>
      )}
    </div>
  );
}
