"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient, getActor, setActor } from "@/lib/supabase/client";
import type { Business, BusinessMember, MemberRole } from "@/types/database";
import { hydrateQueue, queueSummary, useQueue } from "@/lib/queue";
import { syncMoves } from "@/lib/offline";
import { DEFAULT_ALERTS, type AlertSettings } from "@/lib/inventory";
import { useToast } from "./ui/Toast";

/** Estado del flujo ① Agregar → ② Revisar → ③ Inventario, compartido por la barra de pasos, el menú y el Inicio. */
export interface FlowState {
  pending: number; // pendientes de revisar
  confirmed: number; // en inventario
  working: number; // fotos en cola / analizando
  loaded: boolean;
  /** Ajustes de avisos del negocio (mínimo por defecto y días de vencimiento) */
  alerts: AlertSettings;
  /** Negocio activo, mi rol y el equipo */
  business: Business | null;
  role: MemberRole;
  members: BusinessMember[];
  /** Quién está atendiendo en este celular (tras el PIN); por defecto, el usuario con sesión */
  actorId: string | null;
  meId: string | null;
  isOwner: boolean;
  /** Cambiar de persona (ya verificada con PIN) */
  switchActor: (userId: string | null) => void;
  refresh: () => void;
  /** Paso actual según la ruta: 1 agregar, 2 revisar, 3 inventario, 0 otra */
  step: 0 | 1 | 2 | 3;
}

const Ctx = createContext<FlowState>({ pending: 0, confirmed: 0, working: 0, loaded: false, alerts: DEFAULT_ALERTS, business: null, role: "dueno", members: [], actorId: null, meId: null, isOwner: true, switchActor: () => {}, refresh: () => {}, step: 0 });

export function stepOf(pathname: string): 0 | 1 | 2 | 3 {
  if (pathname.startsWith("/capture") || pathname.startsWith("/scan") || pathname.startsWith("/products/new")) return 1;
  if (pathname.startsWith("/review")) return 2;
  if (["/products", "/movements", "/restock", "/purchases", "/count", "/prices", "/trash", "/sell", "/cash", "/customers", "/consign", "/reports", "/digest", "/ask"].some((p) => pathname.startsWith(p))) return 3;
  return 0;
}

export function FlowProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const toast = useToast();
  const queue = useQueue();
  const q = queueSummary(queue.items);
  const [counts, setCounts] = useState({ pending: 0, confirmed: 0, loaded: false });
  const [alerts, setAlerts] = useState<AlertSettings>(DEFAULT_ALERTS);
  const [team, setTeam] = useState<{ business: Business | null; role: MemberRole; members: BusinessMember[]; meId: string | null }>({ business: null, role: "dueno", members: [], meId: null });
  const [actorId, setActorId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    const supabase = createClient();
    Promise.all([
      supabase.from("products").select("id", { count: "exact", head: true }).eq("status", "draft").is("deleted_at", null),
      supabase.from("products").select("id", { count: "exact", head: true }).eq("status", "confirmed").is("deleted_at", null),
    ]).then(([d, c]) => setCounts({ pending: d.count ?? 0, confirmed: c.count ?? 0, loaded: true }));
    // Negocio, rol y equipo
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: bid } = await supabase.rpc("current_business_id");
      if (!bid) return;
      const [{ data: biz }, { data: mem }] = await Promise.all([
        supabase.from("businesses").select("*").eq("id", bid).maybeSingle(),
        supabase.from("business_members").select("*").eq("business_id", bid).order("created_at"),
      ]);
      const members = (mem ?? []) as BusinessMember[];
      const me = members.find((m) => m.user_id === user.id);
      setTeam({ business: (biz as Business | null) ?? null, role: me?.role ?? "dueno", members, meId: user.id });
      // Actor guardado en este celular: solo vale si sigue siendo miembro activo
      const saved = getActor();
      if (saved && members.some((m) => m.user_id === saved && m.active)) setActorId(saved);
      else {
        setActor(null);
        setActorId(null);
      }
    })();
    supabase
      .from("profiles")
      .select("min_stock_default,expiry_days")
      .maybeSingle()
      .then(({ data }) =>
        setAlerts({
          minStock: typeof data?.min_stock_default === "number" ? data.min_stock_default : DEFAULT_ALERTS.minStock,
          expiryDays: typeof data?.expiry_days === "number" ? data.expiry_days : DEFAULT_ALERTS.expiryDays,
        })
      );
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

  const switchActor = useCallback((userId: string | null) => {
    setActor(userId);
    setActorId(userId);
  }, []);
  // El rol efectivo es el de quien atiende (si un vendedor tomó el celular del dueño, ve como vendedor)
  const actorRole: MemberRole = actorId ? team.members.find((m) => m.user_id === actorId)?.role ?? team.role : team.role;
  const value = useMemo<FlowState>(
    () => ({
      ...counts,
      alerts,
      business: team.business,
      role: actorRole,
      members: team.members,
      actorId,
      meId: team.meId,
      isOwner: actorRole === "dueno",
      switchActor,
      working: q.queued + q.processing,
      refresh,
      step: stepOf(pathname),
    }),
    [counts, alerts, team, actorRole, actorId, switchActor, q.queued, q.processing, refresh, pathname]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useFlow = () => useContext(Ctx);
