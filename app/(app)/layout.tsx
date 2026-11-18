import AppShell from "@/components/AppShell";
import AuthGuard from "@/components/AuthGuard";
import WhatsNew from "@/components/WhatsNew";
import { FlowProvider } from "@/components/FlowProvider";
import { ConfirmProvider } from "@/components/ui/Confirm";

/**
 * Capa de la app. No consulta la sesión en el servidor: el middleware valida al usuario en cada
 * petición y RLS protege los datos, así que estas pantallas se sirven estáticas (una sola función
 * en Cloudflare en vez de una por ruta) y piden sus datos desde el navegador.
 * Armazón (C7.1): AppShell con los 5 lugares; ya no hay barra de pasos.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <FlowProvider>
      <ConfirmProvider>
        <AuthGuard />
        <AppShell>{children}</AppShell>
        <WhatsNew />
      </ConfirmProvider>
    </FlowProvider>
  );
}
