/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Cloudflare Pages no soporta el optimizador de imágenes de Next.js
  images: { unoptimized: true },
  // Reconstrucción visual (C7 · RECONSTRUCCION_VISUAL.md §3.3): las direcciones antiguas siguen funcionando
  async redirects() {
    return [
      { source: "/cash", destination: "/sell/cash", permanent: false },
      // C7.3 · Productos: una sola lista con filtros
      { source: "/products/c/:id", destination: "/products?category=:id", permanent: false },
      { source: "/products/table", destination: "/products?view=table", permanent: false },
      { source: "/restock", has: [{ type: "query", key: "tab", value: "vencer" }], destination: "/products?filter=expiring", permanent: false },
      { source: "/restock", destination: "/products?filter=restock", permanent: false },
      { source: "/trash", destination: "/products?filter=trash", permanent: false },
      { source: "/prices", destination: "/products?select=1", permanent: false },
      { source: "/labels", destination: "/products?select=1", permanent: false },
    ];
  },
};

export default nextConfig;
