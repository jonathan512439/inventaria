"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(
        error.message === "Invalid login credentials"
          ? "Correo o contraseña incorrectos."
          : error.message === "Email not confirmed"
            ? "Debes confirmar tu correo antes de iniciar sesión."
            : error.message
      );
      return;
    }
    router.replace(params.get("next") || "/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4">
      <h2 className="text-lg font-bold">Iniciar sesión</h2>
      {params.get("registered") && (
        <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">
          Cuenta creada. Te enviamos un correo: abre el enlace de confirmación (desde cualquier dispositivo) y entrarás
          directamente.
        </p>
      )}
      {params.get("error") && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {params.get("error") === "link_invalido"
            ? "El enlace de confirmación no es válido."
            : /expired|invalid/i.test(params.get("error") ?? "")
              ? "El enlace de confirmación expiró o ya fue usado. Inicia sesión; si no puedes, regístrate de nuevo."
              : params.get("error")}
        </p>
      )}
      <div>
        <label className="label" htmlFor="email">Correo</label>
        <input id="email" type="email" className="input" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="password">Contraseña</label>
        <input id="password" type="password" className="input" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={loading}>
        {loading ? "Entrando..." : "Entrar"}
      </button>
      <p className="text-center text-sm text-slate-500">
        ¿No tienes cuenta?{" "}
        <Link href="/register" className="font-medium text-brand-600 hover:underline">Regístrate</Link>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
