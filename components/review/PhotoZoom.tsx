"use client";

import { StoredImg } from "@/components/ui/Photo";
import { IconX } from "@/components/ui/Icons";

/** Foto ampliada a pantalla completa (pellizca para hacer zoom), con lo que se lee en la etiqueta. */
export default function PhotoZoom({ src, caption, onClose }: { src: string; caption?: string | null; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90" onClick={onClose}>
      <div className="h-full w-full overflow-auto" style={{ touchAction: "pinch-zoom" }}>
        <StoredImg src={src} alt="" className="mx-auto h-full w-auto max-w-none object-contain" />
      </div>
      <button type="button" className="absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white backdrop-blur" onClick={onClose} aria-label="Cerrar">
        <IconX size={22} />
      </button>
      {caption && <p className="absolute inset-x-4 bottom-6 rounded-2xl bg-black/60 p-3 text-center text-xs text-white/90">{caption}</p>}
    </div>
  );
}
