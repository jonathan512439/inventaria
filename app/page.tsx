import { redirect } from "next/navigation";

export const runtime = "edge";

export default function Home() {
  // El middleware redirige según sesión; fallback por si se accede directo.
  redirect("/login");
}
