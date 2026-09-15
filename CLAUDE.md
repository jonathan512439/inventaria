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
