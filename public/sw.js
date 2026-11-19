/*
 * Service worker (P3 · venta sin conexión): permite instalar la app y ABRIRLA SIN SEÑAL.
 * - Archivos de la app (/_next/static, con nombre único por versión): primero lo guardado.
 * - Pantallas (navegación): primero la red; si no hay señal, la última copia guardada de esa pantalla.
 *   Las pantallas de la app son estáticas (sin datos de nadie): los datos sin conexión viven en IndexedDB
 *   (lib/offline.ts) y se borran al cerrar sesión.
 * - Nunca se guardan /api, /auth, ni respuestas de Supabase (otro dominio).
 */
const SHELL = "inventaria-shell-v2";
const PAGES = "inventaria-pages-v1";
const STATIC = "inventaria-static-v1";
const KEEP = [SHELL, PAGES, STATIC];
const ASSETS = ["/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];
/**
 * Pantallas que se guardan con sus archivos aunque nunca se hayan abierto con recarga (la app navega sin recargar).
 * La app pide «warm» con sesión iniciada, como mucho cada 12 h (components/PwaRegister.tsx).
 */
const WARM = ["/sell", "/dashboard", "/products"];
const MAX_STATIC = 400;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .catch(() => undefined)
  );
});

/**
 * Guarda una pantalla y los archivos que usa (scripts y estilos de /_next/static), solo si respondió bien y sin
 * redirección (sin sesión la red manda a /login: no se guarda nada).
 */
async function savePage(path) {
  try {
    const res = await fetch(path, { credentials: "same-origin" });
    if (!res.ok || res.redirected) return;
    const html = await res.clone().text();
    await (await caches.open(PAGES)).put(path, res);
    const files = Array.from(new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) || []));
    const st = await caches.open(STATIC);
    for (const u of files) {
      if (await st.match(u)) continue;
      const r = await fetch(u).catch(() => null);
      if (r && r.ok) await st.put(u, r);
    }
    await trimStatic();
  } catch {
    /* sin señal */
  }
}

self.addEventListener("message", (e) => {
  if (e.data === "warm") e.waitUntil(Promise.all(WARM.map((p) => savePage(p))));
});

async function trimStatic() {
  const c = await caches.open(STATIC);
  const keys = await c.keys();
  if (keys.length > MAX_STATIC) await Promise.all(keys.slice(0, keys.length - MAX_STATIC).map((k) => c.delete(k)));
}

const OFFLINE_HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sin conexión</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:32px 16px;background:#f8fafc;color:#0f172a;text-align:center}a{display:inline-block;margin-top:16px;padding:14px 22px;border-radius:16px;background:#16a34a;color:#fff;font-weight:700;text-decoration:none}</style></head>
<body><h1>Sin conexión</h1><p>Esta pantalla todavía no se guardó en el celular. Puedes vender igual: las ventas se envían al volver la señal.</p><a href="/sell">Ir a Vender</a></body></html>`;

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  const p = url.pathname;
  if (p.startsWith("/api/") || p.startsWith("/auth/")) return;

  if (p.startsWith("/icons/") || p === "/manifest.webmanifest") {
    e.respondWith(caches.match(req).then((r) => r || fetch(req)));
    return;
  }
  if (p.startsWith("/_next/static/")) {
    e.respondWith(
      caches.open(STATIC).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone()).then(trimStatic).catch(() => undefined);
        return res;
      })
    );
    return;
  }
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && !res.redirected) {
            const copy = res.clone();
            caches.open(PAGES).then((c) => c.put(p, copy)).catch(() => undefined);
          }
          return res;
        })
        .catch(async () => (await caches.match(p, { cacheName: PAGES })) || new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } }))
    );
  }
});
