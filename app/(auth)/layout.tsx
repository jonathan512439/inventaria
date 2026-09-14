import { LogoMark } from "@/components/ui/Logo";

/** Pantallas de acceso: panel de marca + formulario. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* Fondo con manchas difuminadas */}
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
        <div className="absolute -left-24 -top-24 h-96 w-96 rounded-full bg-brand-300/40 blur-3xl" />
        <div className="absolute -right-24 top-1/3 h-96 w-96 rounded-full bg-violet-300/40 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-fuchsia-200/40 blur-3xl" />
      </div>

      <div className="mx-auto grid min-h-screen max-w-5xl grid-cols-1 items-center gap-8 px-4 py-8 md:grid-cols-2 md:px-8">
        {/* Panel de marca */}
        <section className="animate-in text-center md:text-left">
          <div className="mb-5 inline-flex items-center gap-3">
            <LogoMark size={56} className="drop-shadow-lg" />
            <span className="text-3xl font-bold tracking-tight text-ink">
              Inventar<span className="ai-glow">IA</span>
            </span>
          </div>
          <h1 className="text-2xl font-bold leading-tight text-ink md:text-4xl">Tu inventario, con una foto.</h1>
          <p className="mt-3 text-slate-600 md:text-lg">
            Fotografía tus productos y la IA los reconoce, los describe y los ordena en categorías. Tú solo confirmas el precio.
          </p>

          <ol className="mx-auto mt-6 hidden max-w-sm space-y-3 text-left md:block">
            {[
              ["📷", "Toma fotos en ráfaga", "desde el celular, sin escribir"],
              ["✨", "La IA hace el trabajo", "nombre, marca, descripción y categoría"],
              ["📊", "Exporta a Excel", "cuando quieras, por categoría"],
            ].map(([icon, t, d]) => (
              <li key={t} className="flex items-center gap-3 rounded-2xl bg-white/70 p-3 ring-1 ring-slate-900/5 backdrop-blur">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-xl">{icon}</span>
                <span>
                  <span className="block font-semibold text-ink">{t}</span>
                  <span className="block text-xs text-slate-500">{d}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        {/* Formulario */}
        <section className="animate-in mx-auto w-full max-w-sm">{children}</section>
      </div>
    </main>
  );
}
