"use client";

import { discardFailedMoves, useOffline } from "@/lib/offline";
import { useConfirm } from "./ui/Confirm";
import { IconRefresh, IconWifiOff, IconAlert } from "./ui/Icons";

/**
 * Indicador único de conexión en la cabecera (C7.1 · F41): sin conexión, cambios por enviar y cambios que el
 * servidor rechazó (con «Ver y descartar»). Con todo al día no ocupa lugar.
 */
export default function ConnectionChip() {
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

  if (failed.length) {
    return (
      <button type="button" onClick={discard} className="flex min-h-[36px] items-center gap-1.5 rounded-full bg-danger-100 px-3 text-xs font-bold text-danger-800" title="Cambios hechos sin conexión que no se pudieron guardar">
        <IconAlert size={16} /> {failed.length} sin guardar
      </button>
    );
  }
  if (!online) {
    return (
      <span className="flex min-h-[36px] items-center gap-1.5 rounded-full bg-slate-800 px-3 text-xs font-bold text-white" title="Puedes consultar y mover stock; se envía al reconectar">
        <IconWifiOff size={16} /> Sin conexión{pending ? ` · ${pending} por enviar` : ""}
      </span>
    );
  }
  return (
    <span className="flex min-h-[36px] items-center gap-1.5 rounded-full bg-warn-100 px-3 text-xs font-bold text-warn-900">
      <IconRefresh size={16} className="animate-spin" /> Enviando {pending}
    </span>
  );
}
