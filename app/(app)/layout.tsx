import { redirect } from "next/navigation";
import Nav from "@/components/Nav";
import { createClient } from "@/lib/supabase/server";

export const runtime = "edge";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  // El middleware ya validó la sesión contra Supabase (getUser); aquí solo leemos la cookie
  // para no hacer una segunda llamada de red en cada navegación.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) redirect("/login");

  return (
    <div className="min-h-screen pb-20 md:pb-8">
      <Nav email={user.email ?? ""} />
      <main className="mx-auto max-w-6xl px-4 py-5">{children}</main>
    </div>
  );
}
