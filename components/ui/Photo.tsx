"use client";

import { useState } from "react";

interface Props extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  wrapperClassName?: string;
}

/** Imagen con fondo suave (shimmer) mientras carga y aparición en fundido. */
export default function Photo({ src, alt = "", className = "", wrapperClassName = "", ...rest }: Props) {
  const [loaded, setLoaded] = useState(false);
  return (
    <span className={`relative block overflow-hidden ${loaded ? "" : "shimmer"} ${wrapperClassName}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className={`img-fade ${loaded ? "loaded" : ""} ${className}`} onLoad={() => setLoaded(true)} {...rest} />
    </span>
  );
}
