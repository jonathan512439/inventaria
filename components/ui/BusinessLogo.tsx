"use client";

/* eslint-disable @next/next/no-img-element */

/**
 * Logo del negocio (R9): la imagen que subió el dueño (bucket público `business-logos`, 030) o, si no hay,
 * un círculo con la inicial del nombre en el color de la marca. No es una foto de producto: no pasa por Photo.
 */
export default function BusinessLogo({ name, url, size = 36, className = "" }: { name?: string | null; url?: string | null; size?: number; className?: string }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  const style = { width: size, height: size };
  if (url) return <img src={url} alt={name ? `Logo de ${name}` : "Logo"} style={style} className={`shrink-0 rounded-xl bg-white object-cover ring-1 ring-slate-900/10 ${className}`} />;
  return (
    <span aria-hidden style={{ ...style, fontSize: Math.round(size * 0.45), backgroundImage: "linear-gradient(135deg,#6366f1,#8b5cf6)" }} className={`grid shrink-0 place-items-center rounded-xl font-bold text-white ${className}`}>
      {initial}
    </span>
  );
}
