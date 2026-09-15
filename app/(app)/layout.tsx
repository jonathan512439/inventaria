import Nav from "@/components/Nav";
import StepBar from "@/components/StepBar";
import OfflineBar from "@/components/OfflineBar";
import AuthGuard from "@/components/AuthGuard";
import WhatsNew from "@/components/WhatsNew";
import { FlowProvider } from "@/components/FlowProvider";

/**
 * Capa de la app. No consulta la sesión en el servidor: el middleware valida al usuario en cada
 * petición y RLS protege los datos, así que estas pantallas se sirven estáticas (una sola función
 * en Cloudflare en vez de una por ruta) y piden sus datos desde el navegador.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <FlowProvider>
      <div className="min-h-screen overflow-x-hidden pb-28 md:pb-10">
        <AuthGuard />
        <Nav />
        <main className="mx-auto w-full px-4 py-4 md:px-6 md:py-6 xl:px-10 2xl:px-14">
          <OfflineBar />
          <StepBar />
          {children}
        </main>
        <WhatsNew />
      </div>
    </FlowProvider>
  );
}
