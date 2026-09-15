"use client";

import { useEffect, useRef, useState } from "react";
import { cleanCode, scanFrame } from "@/lib/barcode";
import { IconCamera, IconX } from "./ui/Icons";

interface Props {
  /** Cada lectura (con pausa de 1,5 s; el mismo código se repite solo tras 4 s) */
  onCode: (code: string) => void;
  label?: string;
}

/** Cámara de códigos de barras reutilizable (conteo, compras): beep, destello y pausa entre lecturas. */
export default function BarcodeCamera({ onCode, label = "Escanear" }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopRef = useRef<number | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const pausedUntil = useRef(0);
  const lastSeen = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const [on, setOn] = useState(false);
  const [flash, setFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function beep(low = false) {
    try {
      const ctx = audioRef.current;
      if (!ctx) return;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = low ? 520 : 1040;
      g.gain.value = 0.15;
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.12);
    } catch {
      /* sin audio */
    }
  }

  async function start() {
    setError(null);
    // El <video> debe estar montado ANTES de pedir la cámara (si no, videoRef es null y fallaba)
    setOn(true);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioRef.current ??= new Ctx();
      await audioRef.current.resume();
    } catch {
      /* sin audio */
    }
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Este navegador no permite usar la cámara. Abre la app en Chrome o Safari.");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } } });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("No se pudo preparar la vista de la cámara. Vuelve a intentarlo.");
      video.srcObject = stream;
      await video.play();
      const tick = async () => {
        if (!streamRef.current) return;
        const now = Date.now();
        if (video.readyState >= 2 && now >= pausedUntil.current) {
          const found = await scanFrame(video);
          if (found) {
            const code = cleanCode(found);
            const repeat = code === lastSeen.current.code && now - lastSeen.current.at < 4000;
            if (!repeat) {
              lastSeen.current = { code, at: now };
              beep();
              setFlash(true);
              pausedUntil.current = now + 1500;
              setTimeout(() => setFlash(false), 400);
              onCode(code);
            }
          }
        }
        loopRef.current = requestAnimationFrame(tick);
      };
      loopRef.current = requestAnimationFrame(tick);
    } catch (e) {
      setOn(false);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      const name = (e as { name?: string })?.name;
      setError(
        name === "NotAllowedError"
          ? "Diste «bloquear» a la cámara. Tócalo en el candado de la barra de direcciones y permite la cámara."
          : name === "NotFoundError"
            ? "No se encontró ninguna cámara en este dispositivo."
            : name === "NotReadableError"
              ? "La cámara está ocupada por otra app. Ciérrala y vuelve a intentarlo."
              : e instanceof Error && e.message
                ? e.message
                : "No se pudo abrir la cámara. Si la página no es segura (https), el navegador no la permite."
      );
    }
  }
  function stop() {
    if (loopRef.current) cancelAnimationFrame(loopRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setOn(false);
  }
  useEffect(() => () => stop(), []);

  return (
    <div>
      {/* El vídeo se mantiene montado: así la referencia existe cuando se concede el permiso */}
      <div className={`relative overflow-hidden rounded-2xl bg-black ring-4 transition ${on ? "" : "hidden"} ${flash ? "ring-emerald-400" : "ring-transparent"}`}>
        <video ref={videoRef} className="block h-44 w-full object-cover" muted playsInline autoPlay />
        <button type="button" onClick={stop} className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white"><IconX size={16} /></button>
        <p className="absolute inset-x-0 bottom-0 bg-black/50 py-1 text-center text-[11px] text-white">Apunta al código · beep = leído</p>
      </div>
      {!on && (
        <button type="button" onClick={start} className="btn-secondary w-full"><IconCamera size={18} /> {label}</button>
      )}
      {error && (
        <p className="mt-1 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error} <button type="button" onClick={start} className="font-semibold underline">Reintentar</button>
        </p>
      )}
    </div>
  );
}
