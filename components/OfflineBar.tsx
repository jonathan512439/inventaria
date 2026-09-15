"use client";

import { useOffline } from "@/lib/offline";

/** Aviso fijo: sin conexión y/o cambios guardados en el celular pendientes de enviar. */
export default function OfflineBar() {
  const { online, pending } = useOffline();
  if (online && pending === 0) return null;
  return (
    <div className={`-mx-4 mb-3 rounded-b-2xl px-4 py-2 text-center text-xs font-semibold md:mx-0 md:rounded-2xl ${online ? "bg-amber-100 text-amber-900" : "bg-slate-800 text-white"}`}>
      {online
        ? `Enviando ${pending} cambio${pending === 1 ? "" : "s"} guardado${pending === 1 ? "" : "s"} sin conexión…`
        : `Sin conexión · puedes consultar y mover stock; ${pending ? `${pending} cambio${pending === 1 ? "" : "s"} se enviará${pending === 1 ? "" : "n"} al reconectar` : "los cambios se guardan en el celular"}`}
    </div>
  );
}
