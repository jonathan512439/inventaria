"use client";

import { useRef, useState } from "react";

export const SWIPE = 110;

/** Gesto de la tarjeta de Revisar: deslizar a la derecha = confirmar, a la izquierda = siguiente. */
export function useSwipe(onRight: () => void, onLeft: () => void) {
  const [dragX, setDragX] = useState(0);
  const drag = useRef<{ x: number; y: number; active: boolean; horizontal: boolean | null }>({ x: 0, y: 0, active: false, horizontal: null });

  function onPointerDown(e: React.PointerEvent) {
    const t = e.target as HTMLElement;
    if (t.closest("input,select,textarea,button,a,[data-no-swipe]")) return;
    drag.current = { x: e.clientX, y: e.clientY, active: true, horizontal: null };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d.active) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (d.horizontal === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) d.horizontal = Math.abs(dx) > Math.abs(dy);
    if (d.horizontal) setDragX(Math.max(-160, Math.min(160, dx)));
  }
  function onPointerUp() {
    const d = drag.current;
    if (!d.active) return;
    d.active = false;
    const dx = dragX;
    setDragX(0);
    if (dx > SWIPE) onRight();
    else if (dx < -SWIPE) onLeft();
  }
  return { dragX, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp } };
}
