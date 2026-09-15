"use client";

import { useEffect, useState } from "react";

/** Modo asistido: cada pantalla muestra sus burbujas de ayuda las primeras 3 veces que se abre. */
const MAX_SHOWS = 3;
const KEY = "inventaria.coach.v1";

function read(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, number>;
  } catch {
    return {};
  }
}
function write(v: Record<string, number>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* privado / sin espacio: sin ayuda persistente */
  }
}

/** true mientras la pantalla `screen` deba mostrar ayuda; `dismiss()` la apaga para siempre en esta pantalla. */
export function useCoach(screen: string): { show: boolean; dismiss: () => void } {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const v = read();
    const n = v[screen] ?? 0;
    if (n < MAX_SHOWS) {
      setShow(true);
      write({ ...v, [screen]: n + 1 });
    }
  }, [screen]);
  return {
    show,
    dismiss: () => {
      setShow(false);
      write({ ...read(), [screen]: MAX_SHOWS });
    },
  };
}

/** Reactiva las burbujas en todas las pantallas (desde Ajustes). */
export function resetCoach() {
  write({});
}

/** ¿Ya vio el recorrido de novedades de esta versión? */
const TOUR_KEY = "inventaria.tour.v3";
export function tourSeen(): boolean {
  try {
    return localStorage.getItem(TOUR_KEY) === "1";
  } catch {
    return true;
  }
}
export function markTourSeen() {
  try {
    localStorage.setItem(TOUR_KEY, "1");
  } catch {
    /* ignorar */
  }
}
export function resetTour() {
  try {
    localStorage.removeItem(TOUR_KEY);
  } catch {
    /* ignorar */
  }
}
