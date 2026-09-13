import { redirect } from "next/navigation";
import Nav from "@/components/Nav";
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
    <div className="min-h-screen overflow-x-hidden pb-24 md:pb-10">
      <Nav />
      <main className="mx-auto w-full max-w-6xl px-4 py-5 md:px-6 md:py-8">{children}</main>
    </div>
  );
}
