import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { MemberRole, SessionContext } from "@/types/database";

/**
 * Control de acceso de las rutas /api (Fase 6.9 · C5.1). Valida la sesión, el negocio ACTIVO y el rol de quien
 * ATIENDE: la pantalla manda el token del turno (`x-actor-token`, ver lib/supabase/client) y se reenvía a la base,
 * así un vendedor en el celular del dueño no tiene permisos de dueño en el servidor.
 * Uso:
 *   const acc = await requireMember(request, { owner: true });
 *   if (acc instanceof NextResponse) return acc;
 *   acc.businessId, acc.role, acc.supabase …
 */
export type Access = {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  businessId: string;
  role: MemberRole;
  ctx: SessionContext;
};

export async function requireMember(request: Request, opts: { owner?: boolean } = {}): Promise<Access | NextResponse> {
  const token = request.headers.get("x-actor-token");
  const supabase = createClient(token ? { "x-actor-token": token } : undefined);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { data: ctx } = await supabase.rpc("session_context");
  if (!ctx?.business) return NextResponse.json({ error: "No perteneces a ningún negocio" }, { status: 403 });
  const role = (ctx.acting_role ?? "vendedor") as MemberRole;
  if (opts.owner && role !== "dueno") return NextResponse.json({ error: "Esto lo hace el dueño del negocio" }, { status: 403 });
  return { supabase, userId: user.id, businessId: ctx.business.id, role, ctx };
}
