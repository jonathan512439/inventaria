"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Respaldo de seguridad en el navegador: el middleware ya valida la sesión en cada petición
 * (y RLS protege los datos). Esto solo evita ver la cáscara de la app si la sesión caducó.
 */
export default function AuthGuard() {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") router.replace("/login");
    });
    return () => sub.subscription.unsubscribe();
  }, [router, pathname]);
  return null;
}
