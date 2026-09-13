# InventarIA

MVP SaaS de inventario: el usuario define sus propias columnas por categoría, toma una foto del producto y **Gemini** rellena los campos que puede inferir visualmente. El resultado queda como **borrador** en una tabla editable; el usuario corrige, confirma y exporta a **Excel (.xlsx)**.

**Stack (100 % capa gratuita):** Next.js 14 (App Router) + TypeScript + Tailwind · Supabase (Postgres, Auth, Storage) · Google Gemini (structured output, solo desde backend) · Cloudflare Pages (`@cloudflare/next-on-pages`) · SheetJS (`xlsx`) en el cliente.

---

## Estructura del proyecto

```
├── app/
│   ├── (auth)/            login, register (páginas públicas)
│   ├── (app)/             layout protegido + navegación
│   │   ├── dashboard/     resumen
│   │   ├── categories/    árbol de categorías / subcategorías
│   │   ├── templates/     constructor de campos (plantillas)
│   │   ├── capture/       cámara / galería → IA → borrador
│   │   ├── drafts/        tabla editable de borradores + confirmar
│   │   ├── products/      inventario confirmado (+ /products/[id] detalle)
│   │   └── export/        exportar a Excel con filtro por categoría
│   ├── api/analyze/       POST: sube foto a Storage, llama a Gemini, crea borrador
│   └── auth/callback/     intercambio de código de confirmación de email
├── components/            Nav, CategorySelect, FieldInput, ProductTable, ProductListPage
├── lib/
│   ├── supabase/          client.ts (browser) · server.ts (SSR/route) · admin.ts (service role)
│   ├── gemini/index.ts    prompt + JSON schema dinámico + reintentos 429
│   ├── categories.ts      árbol, ancestros, descendientes, ruta "A > B > C"
│   ├── fields.ts          campos efectivos (globales + categoría + heredados)
│   ├── image.ts           redimensiona a 800px / JPEG en el navegador
│   ├── queue.ts           cola de fotos en lote (IndexedDB, ritmo, reintentos 429)
│   └── export.ts          generación .xlsx
├── supabase/migrations.sql   tablas, RLS, trigger de perfil, bucket de fotos
├── supabase/002_lote_defaults.sql   business_name, default_value, ai_meta, índice GIN
├── middleware.ts          refresca sesión y protege rutas
├── wrangler.toml          config Cloudflare Pages
└── .env.example
```

---

## 1. Crear el proyecto en Supabase

1. Entra en [supabase.com](https://supabase.com) → **New project** (plan Free). Guarda la contraseña de la BD.
2. Abre **SQL Editor → New query**, pega el contenido completo de [`supabase/migrations.sql`](supabase/migrations.sql) y pulsa **Run**. Esto crea:
   - Tablas `profiles`, `categories`, `field_templates`, `products` con **RLS** (`auth.uid() = user_id`).
   - Trigger que crea el `profile` al registrarse.
   - Bucket público `product-images` con políticas por carpeta de usuario.
3. **Autenticación → Providers → Email**: deja Email habilitado.
   - Para probar rápido sin correo: desactiva **Confirm email** (Authentication → Providers → Email → *Confirm email* OFF).
   - Si lo dejas activado, añade `http://localhost:3000/auth/callback` y la URL de producción en **Authentication → URL Configuration → Redirect URLs**.
4. Copia las credenciales en **Project Settings → API**:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY` (**secreto, solo backend**)

## 2. Obtener la API key de Gemini

1. Ve a [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → **Create API key**.
2. Cópiala en `GEMINI_API_KEY`. Opcionalmente ajusta `GEMINI_MODEL` (por defecto `gemini-3.6-flash`; cualquier modelo Flash del free tier sirve, p. ej. `gemini-3.5-flash-lite`).

## 3. Variables de entorno

```bash
cp .env.example .env.local
```

Rellena `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...       # solo backend
GEMINI_API_KEY=AIza...                 # solo backend
GEMINI_MODEL=gemini-3.6-flash
```

> Las variables sin prefijo `NEXT_PUBLIC_` nunca se envían al navegador.

## 4. Correr en local

```bash
npm install
npm run dev
```

Abre <http://localhost:3000>. Flujo:

1. **Regístrate** → Ajustes → **Usar la configuración básica** (nombre, descripción, marca, color, precio, precio de compra, stock).
2. **Agregar productos**: cámara (foto tras foto) o galería (varias a la vez). La cola procesa en segundo plano respetando el límite de Gemini; sobrevive a recargas (IndexedDB).
3. La IA elige la **sección** (o propone una nueva), rellena los datos marcados como IA y lee el texto de la etiqueta.
4. **Revisar pendientes**: una tarjeta por producto, completa precio/stock → **Confirmar y siguiente** (con Deshacer). En escritorio también hay vista de tabla.
5. **Mi inventario**: búsqueda, chips por sección, tarjetas o tabla. **Exportar** a Excel.

Comprobaciones útiles:

```bash
npx tsc --noEmit     # tipos
npm run lint         # eslint (incluye reglas next-on-pages)
npm run build        # build Next.js
```

## 5. Desplegar en Cloudflare Pages

El despliegue es automático con **GitHub Actions** ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)): cada `git push` a `main` construye en Linux (`npx @cloudflare/next-on-pages`) y publica con `wrangler pages deploy` en `https://inventaria.pages.dev`.

Configuración inicial (una vez):

1. **Cloudflare**: crea el proyecto Pages (`POST /pages/projects` o dashboard → *Upload assets* → `inventaria`) y un API token con permiso *Cloudflare Pages: Edit*.
2. En `.env.local` añade `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_PAGES_PROJECT=inventaria` y ejecuta `npm run cf:env` → sube las variables de la app y activa `nodejs_compat`.
3. **GitHub secrets** del repo (Settings → Secrets → Actions, o `gh secret set`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. Las variables `NEXT_PUBLIC_*` se incrustan en el build; las secretas (service role, Gemini) solo viven en Cloudflare.
4. **Supabase**: `npm run supabase:auth` (necesita `SUPABASE_ACCESS_TOKEN`) fija la *Site URL* y las *Redirect URLs* de producción y localhost.

Cambios de base de datos: `npm run db:sql supabase/<archivo>.sql` (usa `SUPABASE_ACCESS_TOKEN`).

> ⚠️ No construyas para Cloudflare desde Windows: `vercel build` mezcla los bundles de las rutas (una ruta sirve el código de otra). `npm run deploy` (manual) solo debe usarse en Linux/macOS/WSL.

---

## Cómo funciona la IA

`POST /api/analyze` (edge runtime):

1. Verifica la sesión del usuario (cookies de Supabase).
2. Carga categorías y `field_templates`; calcula los **campos efectivos** de la categoría (globales + de la categoría + heredados de sus ancestros) y filtra los `is_ai_fillable`.
3. Sube la imagen a `product-images/{user_id}/{uuid}.jpg`.
4. Construye dinámicamente un **`responseSchema`** (OBJECT con una propiedad por campo; `NUMBER` para numéricos, `enum` para listas) y el prompt:
   > *"Analiza la foto de este producto. Devuelve SOLO un JSON que siga exactamente el schema dado, en español, con tus mejores estimaciones visuales. Si no puedes determinar un campo con confianza razonable, usa cadena vacía…"*
5. Llama a Gemini con `responseMimeType: application/json`. Ante **429/503** reintenta con backoff exponencial (2s, 4s, 8s). Si persiste, igual crea el borrador (vacío) y devuelve un aviso claro al usuario.
6. Inserta el producto en `products` con `status = 'draft'` y los valores de la IA; los campos manuales quedan vacíos.

## Límites del free tier considerados

| Recurso | Límite | Medida en el MVP |
|---|---|---|
| Gemini Flash | ~10–15 req/min, ~1 000–1 500/día | Reintento con backoff en 429, mensaje claro, 1 llamada por foto |
| Supabase Storage | 1 GB | Fotos redimensionadas a ≤800 px JPEG (~60–120 KB c/u), límite 2 MB por archivo en el bucket |
| Supabase DB | 500 MB | Datos en `jsonb` compacto, índices mínimos |
| Supabase | pausa tras 7 días inactivo | Reactivar desde el dashboard si ocurre |
| Cloudflare Pages Functions | 100 000 req/día | Solo `/api/analyze`, `/auth/callback` y páginas SSR pasan por Functions |

## Modelo de datos

- `profiles (id → auth.users, email, created_at)`
- `categories (id, user_id, parent_id → categories, name, created_at)` — árbol
- `field_templates (id, user_id, category_id nullable, name, field_type text|number|select, options jsonb, is_ai_fillable, sort_order)` — `category_id = null` = campo global
- `products (id, user_id, category_id, status draft|confirmed, data jsonb, image_url, created_at, updated_at)`

Todas con RLS: cada usuario solo ve/edita sus filas.
