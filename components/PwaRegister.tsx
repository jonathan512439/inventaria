"use client";

import { useEffect } from "react";

const WARM_KEY = "inventaria.sw-warm";
const WARM_EVERY_MS = 12 * 3600_000;

/**
 * Registra el service worker (app instalable y que abre sin señal, public/sw.js). En las pantallas de la app (con
 * sesión) le pide guardar Vender, Inicio y Productos con sus archivos, como mucho cada 12 h.
 */
export default function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (!navigator.onLine || /^\/(login|register|auth)/.test(window.location.pathname)) return;
    try {
      const last = Number(localStorage.getItem(WARM_KEY) || 0);
      if (Date.now() - last < WARM_EVERY_MS) return;
      navigator.serviceWorker.ready
        .then((r) => {
          r.active?.postMessage("warm");
          localStorage.setItem(WARM_KEY, String(Date.now()));
        })
        .catch(() => {});
    } catch {
      /* sin almacenamiento */
    }
  }, []);
  return null;
}
