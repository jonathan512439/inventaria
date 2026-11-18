"use client";

import { useState } from "react";
import { useStoredImage } from "@/lib/photos";

interface Props extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  wrapperClassName?: string;
}

/**
 * Imagen con fondo suave (shimmer) mientras carga y aparición en fundido.
 * Las fotos de productos son privadas (026): se muestran con un enlace firmado (lib/photos).
 */
export default function Photo({ src, alt = "", className = "", wrapperClassName = "", ...rest }: Props) {
  const [loaded, setLoaded] = useState(false);
  const url = useStoredImage(src);
  return (
    <span className={`relative block overflow-hidden ${loaded ? "" : "shimmer"} ${wrapperClassName}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url && <img src={url} alt={alt} className={`img-fade ${loaded ? "loaded" : ""} ${className}`} onLoad={() => setLoaded(true)} {...rest} />}
    </span>
  );
}

/** <img> simple para fotos de productos (enlace firmado); mismo uso que <img src=…>. */
export function StoredImg({ src, alt = "", ...rest }: React.ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  const url = useStoredImage(src);
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt={alt} {...rest} /> : <span aria-hidden className={`inline-block bg-slate-100 ${rest.className ?? ""}`} />;
}
