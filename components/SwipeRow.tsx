"use client";

import { useRef, useState } from "react";
import { IconX } from "./ui/Icons";

interface Props {
  children: React.ReactNode;
  /** Se llama al deslizar la fila hacia la izquierda más allá del umbral */
  onDismiss: () => void;
  label?: string;
  rounded?: boolean;
}

const THRESHOLD = 90;

/** Fila que se descarta deslizándola a la izquierda (con botón de respaldo para ratón y accesibilidad). */
export default function SwipeRow({ children, onDismiss, label = "No avisar", rounded }: Props) {
  const [dx, setDx] = useState(0);
  const [gone, setGone] = useState(false);
  const drag = useRef<{ x: number; y: number; active: boolean; horizontal: boolean | null }>({ x: 0, y: 0, active: false, horizontal: null });

  function down(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest("input,select,textarea,button,[data-no-swipe]")) return;
    drag.current = { x: e.clientX, y: e.clientY, active: true, horizontal: null };
  }
  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d.active) return;
    const mx = e.clientX - d.x;
    const my = e.clientY - d.y;
    if (d.horizontal === null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) d.horizontal = Math.abs(mx) > Math.abs(my);
    if (d.horizontal) setDx(Math.min(0, Math.max(-160, mx)));
  }
  function up() {
    const d = drag.current;
    if (!d.active) return;
    d.active = false;
    if (dx < -THRESHOLD) {
      navigator.vibrate?.(15);
      setGone(true);
      setTimeout(onDismiss, 180);
    }
    setDx(0);
  }

  return (
    <div className={`relative overflow-hidden ${rounded ? "rounded-2xl" : ""} ${gone ? "h-0 opacity-0 transition-all duration-200" : ""}`}>
      {/* Fondo que aparece al deslizar */}
      <div className="absolute inset-y-0 right-0 flex items-center gap-1 bg-slate-800 px-4 text-xs font-bold text-white">
        <IconX size={14} /> {label}
      </div>
      <div
        className="relative touch-pan-y"
        style={{ transform: `translateX(${dx}px)`, transition: drag.current.active ? "none" : "transform 0.18s ease-out" }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={up}
      >
        {children}
      </div>
      {/* Respaldo en escritorio */}
      <button
        type="button"
        onClick={() => {
          setGone(true);
          setTimeout(onDismiss, 180);
        }}
        className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded-full p-1.5 text-slate-300 hover:bg-slate-100 hover:text-slate-700 md:block"
        title={`${label} de este producto`}
        aria-label={`${label} de este producto`}
      >
        <IconX size={14} />
      </button>
    </div>
  );
}
