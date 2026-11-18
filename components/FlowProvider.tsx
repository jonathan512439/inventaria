"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient, getActor, setActor } from "@/lib/supabase/client";
import type { Business, BusinessMember, MemberRole, SessionContext } from "@/types/database";
import { hydrateQueue, queueSummary, useQueue } from "@/lib/queue";
import { rememberBusiness, syncMoves } from "@/lib/offline";
import { DEFAULT_ALERTS, setCurrency, type AlertSettings } from "@/lib/inventory";
import { setBusinessTz } from "@/lib/dates";
import { useToast } from "./ui/Toast";

/** Estado del flujo ① Agregar → ② Revisar → ③ Inventario, compartido por la barra de pasos, el menú y el Inicio. */
export interface FlowState {
  pending: number; // pendientes de revisar
  confirmed: number; // en inventario
  working: number; // fotos en cola / analizando
  loaded: boolean;
  /** Ajustes de avisos del negocio (mínimo por defecto y días de vencimiento) */
  alerts: AlertSettings;
  /** Negocio activo, rol de quien atiende y el equipo */
  business: Business | null;
  /** Ya se sabe el negocio y el rol (hasta entonces nada de dueño: falla cerrada) */
  ready: boolean;
  /** En cuántos negocios está la persona (selector en Ajustes si hay más de uno) */
  businesses: number;
  role: MemberRole;
  members: BusinessMember[];
  /** Quién está atendiendo en este celular (tras el PIN); por defecto, el usuario con sesión */
  actorId: string | null;
  meId: string | null;
  isOwner: boolean;
  /** Cambiar de persona: con el token de `start_shift` (024), o null para volver a la cuenta de la sesión */
  switchActor: (userId: string | null, token?: string | null) => void;
  refresh: () => void;
}

// Por defecto, rol mínimo: hasta saber quién es, nadie ve pantallas ni datos de dueño (S5)
const Ctx = createContext<FlowState>({ pending: 0, confirmed: 0, working: 0, loaded: false, alerts: DEFAULT_ALERTS, business: null, ready: false, businesses: 0, role: "vendedor", members: [], actorId: null, meId: null, isOwner: false, switchActor: () => {}, refresh: () => {} });


export function FlowProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const toast = useToast();
  const queue = useQueue();
  const q = queueSummary(queue.items);
  const [counts, setCounts] = useState({ pending: 0, confirmed: 0, loaded: false });
  const [alerts, setAlerts] = useState<AlertSettings>(DEFAULT_ALERTS);
  const [team, setTeam] = useState<{ business: Business | null; role: MemberRole; members: BusinessMember[]; meId: string | null; businesses: number; ready: boolean }>({ business: null, role: "vendedor", members: [], meId: null, businesses: 0, ready: false });
  const [actorId, setActorId] = useState<string | null>(null);

  /**
   * Negocio, rol, equipo, ajustes y conteos en UNA llamada (`session_context`, 023); antes eran ~7 consultas
   * en cada cambio de pantalla. Fija además la moneda y la zona horaria del negocio para toda la app.
   */
  const refresh = useCallback(() => {
    const supabase = createClient();
    (async () => {
      const { data, error } = await supabase.rpc("session_context");
      const ctx = data as SessionContext | null;
      if (error || !ctx) return;
      setCounts({ pending: ctx.counts?.pending ?? 0, confirmed: ctx.counts?.confirmed ?? 0, loaded: true });
      const biz = ctx.business;
      rememberBusiness(biz?.id);
      setCurrency(biz?.currency);
      setBusinessTz(biz?.timezone);
      setAlerts({
        minStock: typeof biz?.min_stock_default === "number" ? biz.min_stock_default : DEFAULT_ALERTS.minStock,
        expiryDays: typeof biz?.expiry_days === "number" ? biz.expiry_days : DEFAULT_ALERTS.expiryDays,
      });
      const members = ctx.members ?? [];
      // El rol que manda es el de quien ATIENDE según la base (con el token del turno, si lo hay)
      setTeam({ business: biz, role: ctx.acting_role ?? "vendedor", members, meId: ctx.me, businesses: ctx.businesses ?? 1, ready: true });
      if (ctx.actor && ctx.actor !== ctx.me) setActorId(ctx.actor);
      else {
        // Sin turno, o el token venció / ya no es válido: se vuelve a la cuenta de la sesión
        if (getActor()) setActor(null);
        setActorId(null);
      }
    })();
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

  const switchActor = useCallback(
    (userId: string | null, token?: string | null) => {
      setActor(userId, token ?? null);
      setActorId(userId && token ? userId : null);
      refresh(); // el rol efectivo lo confirma la base
    },
    [refresh]
  );
  // El rol efectivo es el de quien atiende (si un vendedor tomó el celular del dueño, ve como vendedor)
  const actorRole: MemberRole = !team.ready ? "vendedor" : actorId ? team.members.find((m) => m.user_id === actorId)?.role ?? "vendedor" : team.role;
  const value = useMemo<FlowState>(
    () => ({
      ...counts,
      alerts,
      business: team.business,
      ready: team.ready,
      businesses: team.businesses,
      role: actorRole,
      members: team.members,
      actorId,
      meId: team.meId,
      isOwner: team.ready && actorRole === "dueno",
      switchActor,
      working: q.queued + q.processing,
      refresh,
    }),
    [counts, alerts, team, actorRole, actorId, switchActor, q.queued, q.processing, refresh]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useFlow = () => useContext(Ctx);
