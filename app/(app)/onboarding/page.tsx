"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PresetPicker from "@/components/PresetPicker";
import { IconArrowRight, IconCamera } from "@/components/ui/Icons";

/** Asistente inicial: 3 pantallas, 1 minuto. */
export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [business, setBusiness] = useState("");
  const [types, setTypes] = useState<string[]>([]);

  return (
    <div className="mx-auto max-w-lg space-y-6">
      {/* Indicador */}
      <div className="flex items-center gap-2">
        {[1, 2, 3].map((n) => (
          <span key={n} className={`h-1.5 flex-1 rounded-full transition ${n <= step ? "bg-brand-500" : "bg-slate-200"}`} />
        ))}
      </div>

      {step === 1 && (
        <section className="animate-in space-y-5">
          <div>
            <p className="text-sm font-semibold text-brand-600">Paso 1 de 3</p>
            <h1 className="text-2xl font-bold tracking-tight text-ink">¿Cómo se llama tu negocio?</h1>
          </div>
          <input
            className="input-lg"
            placeholder="Ej. Librería San Martín"
            value={business}
            onChange={(e) => setBusiness(e.target.value)}
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && setStep(2)}
          />
          <button onClick={() => setStep(2)} className="btn-primary btn-lg w-full">
            Continuar <IconArrowRight size={18} />
          </button>
        </section>
      )}

      {step === 2 && (
        <section className="animate-in space-y-5">
          <div>
            <p className="text-sm font-semibold text-brand-600">Paso 2 de 3</p>
            <h1 className="text-2xl font-bold tracking-tight text-ink">¿Qué vendes?</h1>
            <p className="text-sm text-slate-500">Toca uno o varios. Cada uno trae sus secciones y datos listos.</p>
          </div>
          <PresetPicker
            businessName={business}
            submitLabel="Preparar mi inventario"
            onDone={({ types }) => {
              setTypes(types);
              setStep(3);
            }}
          />
          <div className="flex justify-between">
            <button onClick={() => setStep(1)} className="btn-ghost text-slate-500">Atrás</button>
            <button
              onClick={async () => {
                await fetch("/api/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ business_name: business, onboarded: true }) });
                router.replace("/dashboard");
              }}
              className="btn-ghost text-slate-400"
            >
              Omitir por ahora
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="animate-in space-y-5 text-center">
          <span className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-emerald-100 text-4xl">🎉</span>
          <div>
            <p className="text-sm font-semibold text-brand-600">Paso 3 de 3</p>
            <h1 className="text-2xl font-bold tracking-tight text-ink">¡Listo{business ? `, ${business}` : ""}!</h1>
            <p className="mt-1 text-sm text-slate-500">
              Tu inventario ya tiene {types.length === 1 ? "el rubro" : "los rubros"} <b>{types.join(", ")}</b> con sus secciones. Ahora toma la primera foto.
            </p>
          </div>
          <button onClick={() => router.replace("/capture")} className="btn-primary btn-lg w-full">
            <IconCamera size={20} /> Tomar mi primera foto
          </button>
          <button onClick={() => router.replace("/dashboard")} className="btn-ghost w-full text-slate-500">Ir al inicio</button>
        </section>
      )}
    </div>
  );
}
