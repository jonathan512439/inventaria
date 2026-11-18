# Reglas de trabajo en InventarIA (leer primero)

## Documentación y planificación
- **No crear páginas ni informes externos** (artefactos, documentos fuera del repo). Toda planificación nueva o modificación de una planificación anterior se documenta en los `.md` del repo que correspondan (`docs/PLAN_V3.md`, `docs/CHANGELOG.md`, `docs/AUDITORIA.md`, `README.md`), redactada para que pueda leerse, interpretarse e implementarse directamente en el código.
- Además de escribirla en el `.md`, la planificación (o el cambio) **se lista en el chat**; si el usuario pide correcciones, se aplican **antes** de comenzar el despliegue.

## Ciclo de cada cambio
1. Implementar.
2. `npx tsc --noEmit`, `npm run lint`, `npx next build`; pruebas (`npm run test:variants`, `npm run test:e2e` cuando aplique).
3. Documentar en `docs/CHANGELOG.md` con **Qué** y **Validar**.
4. `git commit` + `git push origin main` → GitHub Actions despliega a Cloudflare Pages. Migraciones: `npm run db:sql supabase/<archivo>.sql`.
5. Sin preguntar entre pasos; el usuario valida cada despliegue.
6. Si una migración quita o cambia algo que usa la versión publicada (índices únicos, firmas de funciones, columnas), aplicarla **justo al publicar** el código que la usa, no antes: entre ambos momentos la app en producción falla (pasó con `022` y «Cerrar caja»).

## Restricciones técnicas
- Nunca construir para Cloudflare desde Windows (`vercel build` mezcla bundles): el despliegue es solo por GitHub Actions.
- Nunca usar `wrangler login` / `supabase login` globales: tokens por proyecto en `.env.local` (el usuario tiene otras cuentas para otro proyecto).
- Gemini solo desde el servidor; cupo gratuito de 20 peticiones/día por modelo (cadena de modelos en `lib/gemini`).
- Cloudflare limita el Worker a 25 MiB: las pantallas de `(app)` deben ser estáticas (sin `runtime = "edge"`; las rutas con parámetro van envueltas en un server component edge) y las librerías pesadas se importan dinámicamente. Ver «Restricciones de despliegue» en `docs/PLAN_V3.md`.
- Todo panel o lista que pueda crecer (menús, hojas inferiores, desplegables) lleva altura máxima y desplazamiento propio; la acción principal fija va con fondo sólido para no dejar ver el contenido por debajo.
- Confirmaciones siempre con `useConfirm()` (components/ui/Confirm.tsx), nunca `confirm()` del navegador; la acción principal fija usa `.sticky-action` y la página añade `has-action` para reservar su altura.
- Datos por **negocio** (`business_id`, RLS por pertenencia): las inserciones desde el navegador no envían `business_id` (lo rellena un disparador con la sesión); las rutas con service role deben enviarlo (`lib/business.ts`). El costo (`precio_compra`) y la ganancia solo se muestran al dueño (`useFlow().isOwner`).
- Prioridad móvil; el escritorio debe seguir funcional. Lenguaje sin tecnicismos para usuarios no técnicos; vocabulario fijo: Categoría, Subcategoría, Variante, Pendiente, En inventario, Agotado.

## Plan vigente
- `docs/PLAN_V3.md` (Fases 0–8). Cada fase se despliega y documenta por separado.
- **En curso: Fase 6.9 · Cimientos** (`docs/PLAN_CIMIENTOS.md`, pasos C0–C7, con tabla de estado y decisiones). Leerlo antes de tocar stock, ventas, pagos o permisos: toda escritura de dinero/stock va por funciones SQL atómicas (`rpc`), nunca «leer → escribir» desde el navegador.
- **Reconstrucción visual (C7, tras C5):** `docs/RECONSTRUCCION_VISUAL.md` (5 áreas, 38 → 16 pantallas, trazabilidad de funciones, sistema visual). Hasta entonces no se rediseñan pantallas: solo se cambian por dentro.
- Stock y dinero solo por `lib/data/ops.ts` (funciones SQL de `021`, idempotentes con `newOpId()`); al guardar `data` de un producto, usar `withoutStock()` y `setStock()` si cambió el stock.
- Importes siempre con `money(n)` (y `currencyLabel()` en etiquetas), nunca «Bs» escrito a mano; «hoy» / «este mes» con `lib/dates.ts` (zona del negocio), nunca `setHours(0,0,0,0)` ni `toISOString().slice(0,10)`. Nombre y ajustes del negocio desde `useFlow().business` (no del perfil).
- Permisos (024): la base decide por rol de quien atiende (`is_owner()`); la interfaz solo oculta. Rutas /api que exigen rol: `requireMember(request, { owner })` de `lib/access.ts`, y el cliente las llama con `actorHeaders()`. Nada escribe el stock de un confirmado fuera de las funciones. Probar cada cambio de permisos con `npm run test:access`.
- Costos (025): nunca en tablas que lee el vendedor. Leer costo/ganancia solo de `product_costs`, `sales_v`, `sale_items_v`, `cash_closings_v` o `product_summaries`; en pantallas del dueño que cargan `products` completos, pasar por `withCosts()`.
- Fotos de productos (026): bucket privado; mostrarlas siempre con `Photo` o `StoredImg` (`components/ui/Photo.tsx`), nunca `<img src={image_url}>` directo.
- Errores al usuario siempre con `friendlyError()` (`lib/errors.ts`), nunca `error.message` crudo.
