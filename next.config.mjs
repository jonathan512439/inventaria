/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Cloudflare Pages no soporta el optimizador de imágenes de Next.js
  images: { unoptimized: true },
  // Reconstrucción visual (C7 · RECONSTRUCCION_VISUAL.md §3.3): las direcciones antiguas siguen funcionando
  async redirects() {
    return [{ source: "/cash", destination: "/sell/cash", permanent: false }];
  },
};

export default nextConfig;
