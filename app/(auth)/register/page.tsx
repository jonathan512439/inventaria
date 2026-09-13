"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

/** URL pública de la app: los enlaces del correo siempre apuntan aquí (se pueden abrir desde cualquier dispositivo). */
const appUrl = () => process.env.NEXT_PUBLIC_APP_URL || window.location.origin;

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) return setError("La contraseña debe tener al menos 6 caracteres.");
    if (password !== confirm) return setError("Las contraseñas no coinciden.");
    setLoading(true);
    // Registro con flujo "implicit": el enlace del correo trae los tokens y funciona desde cualquier
    // dispositivo (el flujo PKCE por defecto exige abrirlo en el mismo navegador del registro).
    const plain = createPlainClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await plain.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${appUrl()}/auth/confirm` },
    });
    setLoading(false);
    if (error) return setError(error.message);
    // Si la confirmación de correo está desactivada, ya hay sesión: la guardamos en cookies.
    if (data.session) {
      await createClient().auth.setSession(data.session);
      router.replace("/dashboard");
      router.refresh();
    } else {
      router.replace("/login?registered=1");
    }
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4">
      <h2 className="text-lg font-bold">Crear cuenta</h2>
      <div>
        <label className="label" htmlFor="email">Correo</label>
        <input id="email" type="email" className="input" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="password">Contraseña</label>
        <input id="password" type="password" className="input" autoComplete="new-password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="confirm">Repetir contraseña</label>
        <input id="confirm" type="password" className="input" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={loading}>
        {loading ? "Creando..." : "Registrarme"}
      </button>
      <p className="text-center text-sm text-slate-500">
        ¿Ya tienes cuenta?{" "}
        <Link href="/login" className="font-medium text-brand-600 hover:underline">Inicia sesión</Link>
      </p>
    </form>
  );
}
