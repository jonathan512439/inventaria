/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Cloudflare Pages no soporta el optimizador de imágenes de Next.js
  images: { unoptimized: true },
};

export default nextConfig;
