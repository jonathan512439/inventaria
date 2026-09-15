import { redirect } from "next/navigation";
import Nav from "@/components/Nav";
import StepBar from "@/components/StepBar";
import WhatsNew from "@/components/WhatsNew";
import { FlowProvider } from "@/components/FlowProvider";
import { createClient } from "@/lib/supabase/server";

export const runtime = "edge";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  // El middleware ya validó la sesión contra Supabase; aquí solo leemos la cookie.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) redirect("/login");

  return (
    <FlowProvider>
      <div className="min-h-screen overflow-x-hidden pb-28 md:pb-10">
        <Nav />
        <main className="mx-auto w-full px-4 py-4 md:px-6 md:py-6 xl:px-10 2xl:px-14">
          <StepBar />
          {children}
        </main>
        <WhatsNew />
      </div>
    </FlowProvider>
  );
}
