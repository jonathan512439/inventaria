"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { hydrateQueue, queueSummary, useQueue } from "@/lib/queue";

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
  if (pathname.startsWith("/products") || pathname.startsWith("/movements")) return 3;
  return 0;
}

export function FlowProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const queue = useQueue();
  const q = queueSummary(queue.items);
  const [counts, setCounts] = useState({ pending: 0, confirmed: 0, loaded: false });

  const refresh = useCallback(() => {
    const supabase = createClient();
    Promise.all([
      supabase.from("products").select("id", { count: "exact", head: true }).eq("status", "draft"),
      supabase.from("products").select("id", { count: "exact", head: true }).eq("status", "confirmed"),
    ]).then(([d, c]) => setCounts({ pending: d.count ?? 0, confirmed: c.count ?? 0, loaded: true }));
  }, []);

  // Recupera fotos guardadas en el teléfono si la app se cerró a mitad de un lote
  useEffect(() => {
    hydrateQueue();
  }, []);
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
