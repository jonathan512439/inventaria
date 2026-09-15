"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { hydrateQueue, queueSummary, useQueue } from "@/lib/queue";
import { syncMoves } from "@/lib/offline";
import { useToast } from "./ui/Toast";

/** Estado del flujo ① Agregar → ② Revisar → ③ Inventario, compartido por la barra de pasos, el menú y el Inicio. */
export interface FlowState {
  pending: number; // pendientes de revisar
  confirmed: number; // en inventario
  working: number; // fotos en cola / analizando
  loaded: boolean;
  refresh: () => void;
  /** Paso actual según la ruta: 1 agregar, 2 revisar, 3 inventario, 0 otra */
  step: 0 | 1 | 2 | 3;
}

const Ctx = createContext<FlowState>({ pending: 0, confirmed: 0, working: 0, loaded: false, refresh: () => {}, step: 0 });

export function stepOf(pathname: string): 0 | 1 | 2 | 3 {
  if (pathname.startsWith("/capture") || pathname.startsWith("/scan") || pathname.startsWith("/products/new")) return 1;
  if (pathname.startsWith("/review")) return 2;
  if (["/products", "/movements", "/restock", "/purchases", "/count", "/prices", "/trash"].some((p) => pathname.startsWith(p))) return 3;
  return 0;
}

export function FlowProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const toast = useToast();
  const queue = useQueue();
  const q = queueSummary(queue.items);
  const [counts, setCounts] = useState({ pending: 0, confirmed: 0, loaded: false });

  const refresh = useCallback(() => {
    const supabase = createClient();
    Promise.all([
      supabase.from("products").select("id", { count: "exact", head: true }).eq("status", "draft").is("deleted_at", null),
      supabase.from("products").select("id", { count: "exact", head: true }).eq("status", "confirmed").is("deleted_at", null),
    ]).then(([d, c]) => setCounts({ pending: d.count ?? 0, confirmed: c.count ?? 0, loaded: true }));
  }, []);

  // Recupera fotos guardadas en el teléfono si la app se cerró a mitad de un lote
  useEffect(() => {
    hydrateQueue();
  }, []);
  // Movimientos de stock hechos sin conexión: se envían al abrir la app y al reconectar
  useEffect(() => {
    const run = async () => {
      if (!navigator.onLine) return;
      const { sent, failed } = await syncMoves(createClient());
      if (sent) {
        toast("success", `${sent} cambio${sent === 1 ? "" : "s"} de stock hecho${sent === 1 ? "" : "s"} sin conexión ya se enviaron`);
        refresh();
      }
      if (failed && !sent) toast("error", "Algunos cambios sin conexión no se pudieron enviar; se reintentará");
    };
    run();
    window.addEventListener("online", run);
    return () => window.removeEventListener("online", run);
  }, [refresh, toast]);
  // Se refresca al navegar y cuando termina un análisis
  useEffect(() => {
    refresh();
  }, [pathname, q.done, refresh]);

  const value = useMemo<FlowState>(
    () => ({ ...counts, working: q.queued + q.processing, refresh, step: stepOf(pathname) }),
    [counts, q.queued, q.processing, refresh, pathname]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useFlow = () => useContext(Ctx);
