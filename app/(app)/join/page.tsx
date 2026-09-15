"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { IconCheck, Spinner } from "@/components/ui/Icons";

export default function JoinPage() {
  return (
    <Suspense>
      <Join />
    </Suspense>
  );
}

/** Unirse a un negocio con el código de invitación (6 letras). */
function Join() {
  const params = useSearchParams();
  const router = useRouter();
  const supabase = createClient();
  const toast = useToast();
  const [code, setCode] = useState(params.get("code")?.toUpperCase() ?? "");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setName(data.user?.email?.split("@")[0] ?? ""));
  }, [supabase]);

  async function join() {
    setBusy(true);
    const { error } = await supabase.rpc("accept_invite", { p_code: code.trim().toUpperCase(), p_display_name: name.trim() || null });
    setBusy(false);
    if (error) return toast("error", error.message.includes("válido") ? "Ese código no vale o ya venció. Pide uno nuevo." : error.message);
    toast("success", "¡Listo! Ya formas parte del negocio.");
    router.push("/dashboard");
    router.refresh();
    setTimeout(() => location.reload(), 300);
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="animate-in card space-y-3">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Unirme a un negocio</h1>
        <p className="text-sm text-slate-500">Escribe el código de 6 letras que te pasó el dueño. Entrarás con tu propia cuenta y todo lo que hagas quedará a tu nombre.</p>
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
          Código
          <input className="input mt-1 text-center font-mono text-2xl font-bold uppercase tracking-[0.4em]" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="ABC123" autoFocus />
        </label>
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
          Cómo quieres que te vean
          <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="Tu nombre" />
        </label>
        <button onClick={join} disabled={busy || code.length < 6} className="btn-primary btn-lg w-full">{busy ? <Spinner /> : <IconCheck size={20} />} Entrar al negocio</button>
      </div>
    </div>
  );
}
