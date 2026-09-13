"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Destino del enlace de confirmación de correo (flujo implicit).
 * Supabase redirige aquí con #access_token=...&refresh_token=... → creamos la sesión en cookies.
 * Funciona desde cualquier dispositivo, no depende del navegador donde se hizo el registro.
 */
export default function ConfirmEmail() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const query = new URLSearchParams(window.location.search);

      const errDesc = hash.get("error_description") || query.get("error_description");
      if (errDesc) {
        setError(/expired|invalid/i.test(errDesc) ? "El enlace expiró o ya fue usado. Inicia sesión o regístrate de nuevo." : errDesc);
        return;
      }

      const access_token = hash.get("access_token");
      const refresh_token = hash.get("refresh_token");
      if (access_token && refresh_token) {
        const { error } = await supabase.auth.setSession({ access_token, refresh_token });
        if (error) return setError(error.message);
        window.history.replaceState(null, "", "/auth/confirm");
        router.replace("/dashboard");
        router.refresh();
        return;
      }

      // Por si el cliente ya consumió el fragmento automáticamente
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        router.replace("/dashboard");
        router.refresh();
        return;
      }
      setError("El enlace de confirmación no es válido.");
    })();
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm text-center">
        <h1 className="text-lg font-bold text-brand-700">InventarIA</h1>
        {error ? (
          <>
            <p className="mt-3 text-sm text-red-600">{error}</p>
            <Link href="/login" className="btn-primary mt-4 w-full">Ir a iniciar sesión</Link>
          </>
        ) : (
          <p className="mt-3 text-sm text-slate-500">Confirmando tu correo...</p>
        )}
      </div>
    </main>
  );
}
