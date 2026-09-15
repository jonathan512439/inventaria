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
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioRef.current ??= new Ctx();
      await audioRef.current.resume();
    } catch {
      /* sin audio */
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } } });
      streamRef.current = stream;
      setOn(true);
      const video = videoRef.current!;
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
    } catch {
      setOn(false);
      setError("No se pudo abrir la cámara.");
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
      {on ? (
        <div className={`relative overflow-hidden rounded-2xl bg-black ring-4 transition ${flash ? "ring-emerald-400" : "ring-transparent"}`}>
          <video ref={videoRef} className="block h-44 w-full object-cover" muted playsInline />
          <button type="button" onClick={stop} className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white"><IconX size={16} /></button>
          <p className="absolute inset-x-0 bottom-0 bg-black/50 py-1 text-center text-[11px] text-white">Apunta al código · beep = leído</p>
        </div>
      ) : (
        <button type="button" onClick={start} className="btn-secondary w-full"><IconCamera size={18} /> {label}</button>
      )}
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  );
}
