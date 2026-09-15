"use client";

import { useCoach } from "@/lib/coach";
import { IconX } from "./ui/Icons";

interface Props {
  /** Clave de la pantalla (una por pantalla) */
  screen: string;
  title: string;
  children: React.ReactNode;
}

/** Burbuja de ayuda del modo asistido: aparece las primeras 3 veces que se abre la pantalla. */
export default function CoachTip({ screen, title, children }: Props) {
  const { show, dismiss } = useCoach(screen);
  if (!show) return null;
  return (
    <div className="animate-in relative rounded-2xl border-2 border-violet-300 bg-violet-50 p-3 pr-9 text-sm text-violet-950 shadow-sm">
      <span className="absolute -top-2 left-5 h-4 w-4 rotate-45 border-l-2 border-t-2 border-violet-300 bg-violet-50" />
      <p className="font-bold">💡 {title}</p>
      <div className="mt-0.5 text-[13px] leading-snug text-violet-900">{children}</div>
      <button type="button" onClick={dismiss} className="absolute right-2 top-2 rounded-full p-1 text-violet-500 hover:bg-violet-100" aria-label="Entendido, no mostrar más" title="Entendido">
        <IconX size={16} />
      </button>
    </div>
  );
}
