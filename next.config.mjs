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
      // C7.4 · Agregar: un solo punto de entrada
      { source: "/capture", destination: "/add?mode=photo", permanent: false },
      { source: "/scan", destination: "/add?mode=code", permanent: false },
      { source: "/products/new", destination: "/add?mode=manual", permanent: false },
      { source: "/import", destination: "/add?mode=excel", permanent: false },
      { source: "/review", destination: "/add/review", permanent: false },
      { source: "/drafts", destination: "/add/review", permanent: false },
      // C7.5 · Mercadería: entrada y conteo dentro de Productos
      { source: "/purchases", destination: "/stock/in", permanent: false },
      { source: "/count", destination: "/stock/count", permanent: false },
      { source: "/stock", destination: "/stock/in", permanent: false },
      // C7.6 · Clientes: la mercadería entregada vive en la ficha de cada cliente
      { source: "/consign", destination: "/customers?filter=consign", permanent: false },
    ];
  },
};

export default nextConfig;
