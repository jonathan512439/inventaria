# Auditoría técnica y plan de depuración — InventarIA

Fecha: 2026-09-13 · Alcance: todos los endpoints, flujos de interfaz y el ciclo foto → producto → Excel.
Método: lectura del código real + pruebas end-to-end contra Supabase y Gemini (usuarios temporales).

Leyenda de riesgo: **P** = probabilidad (1–5), **I** = impacto (1–5), **R = P×I**.

---

## 1. Trazabilidad por endpoint

### 1.1 `POST /api/analyze` — foto → producto pendiente
| Paso | Éxito | Fracaso posible | Cómo se ve | R |
|---|---|---|---|---|
| Sesión (`getUser`) | usuario válido | cookie caducada/ausente | 401 "No autenticado"; la cola marca error | 6 |
| Lectura del formulario | `image`, `category_id?`, `product_id?` | imagen ausente / >2 MB / formato HEIC-BMP | 400/413 con mensaje | 8 |
| Categorías + datos del usuario | listas | RLS/BD caída | 500 | 4 |
| Subida a Storage `{uid}/{id}.jpg` | URL pública | **reintento con el mismo id → "already exists" (upsert:false)** | 500 "Error subiendo imagen" | **12** |
| Gemini (cadena de modelos) | JSON válido | cupo diario agotado en todos | 429 `daily:true` → cola en pausa hasta reinicio | 9 |
| | | saturación / 503 | 429 → reintento en 20 s | 6 |
| | | imagen bloqueada por seguridad | 422 | 3 |
| | | respuesta no JSON | 502 | 4 |
| Elección de categoría | id existente | la IA devuelve ruta que ya no existe (borrada entre medias) | producto sin categoría + sugerencias | 4 |
| Datos | valores de la unión de campos IA | **nombres de campo con distinta capitalización ("Nombre" vs "nombre") → el valor se guarda con una clave y la interfaz lee otra** | campo vacío en Revisar/Excel | **15** |
| | | "No aplica" en campos de otra categoría | filtrado por regex (mitigado) | 3 |
| Inserción del producto | `draft` creado | **el cliente reenvía el mismo `product_id` tras recargar (cola en IndexedDB) → clave duplicada** | 500 "duplicate key"; miniatura en error aunque el producto existe | **12** |
| Registro de consumo | fila en `ai_usage` | fallo de inserción | silencioso (no bloquea) | 2 |

### 1.2 `POST /api/setup` — categorías preconfiguradas / IA / nombre rápido
| Paso | Éxito | Fracaso posible | R |
|---|---|---|---|
| Presets por id | categoría + subcategorías + datos | id inexistente → se ignora en silencio | 3 |
| Descripción → IA | categoría generada | cupo agotado → 429; nombres de datos con acentos/espacios normalizados a `_` | 6 |
| Nombre rápido | categoría con 7 datos básicos | nombre duplicado (misma capitalización) → se reutiliza; distinta → **se crea duplicada** | 6 |
| Perfil (`upsert`) | `business_name`, `onboarded_at` | política INSERT faltaba (corregido en 004) | 2 |

### 1.3 `POST /api/classify` — subcategoría automática
| Paso | Éxito | Fracaso posible | R |
|---|---|---|---|
| Coincidencia por texto | subcategoría | nombre parcial (p. ej. "Baño" dentro de "Bañador") → falso positivo | 6 |
| IA texto | subcategoría o "ninguna" | cupo agotado → queda en categoría general sin aviso | 6 |

### 1.4 `GET /api/usage` — medidor
| Fracaso posible | R |
|---|---|
| Consumo hecho por otros procesos (pruebas con curl, otra app con la misma clave) no se registra → el medidor subestima | 6 |
| Límite real distinto de 20 en modelos nuevos hasta que Google lo reporte | 4 |

### 1.5 Auth: `/auth/confirm`, `/auth/callback`, middleware
| Fracaso posible | R |
|---|---|
| Enlace de confirmación abierto dos veces → "expired/invalid" → mensaje en login | 4 |
| Usuario registrado con "Confirm email" activado pero sin abrir el correo → no puede entrar y no se le dice por qué (mensaje genérico) | 8 |

---

## 2. Trazabilidad por pantalla

| Pantalla | Éxito | Fallos detectados | R |
|---|---|---|---|
| **Agregar** (cola) | fotos en segundo plano, cancelación, pausa por cupo | Tras recargar, las fotos rehidratadas **reintentan con el mismo id** (ver 1.1) | 12 |
| | | En iPhone, la galería puede entregar HEIC; `createImageBitmap` falla en algunos Android antiguos → "No se pudo leer" | 8 |
| | | Sin categorías configuradas la IA solo propone nombres; la tarjeta de aviso existe pero no bloquea | 4 |
| **Revisar** | tarjeta, confirmar, deshacer, gestos | **Campos numéricos: al escribir "12." o "0," el valor se convierte al instante y se pierde el separador → no se pueden teclear decimales** | **20** |
| | | Producto sin categoría: no se muestran campos hasta elegirla (esperado, pero no se explica que precio/stock aparecerán después) | 6 |
| | | "Guardar sin confirmar" no avanza a la siguiente tarjeta (sensación de que "no hizo nada") | 6 |
| | | Deshacer tras confirmar devuelve el producto a pendientes pero la tarjeta no vuelve a la posición anterior | 3 |
| **Inventario → producto** | edición completa | Mismo problema de decimales en campos numéricos | 20 |
| | | "Otros datos guardados" (claves huérfanas) se ven pero no se editan ni exportan | 6 |
| | | No existe **crear producto manualmente** (sin foto): todo entra por IA | **12** |
| **Tabla** (escritorio) | edición masiva | Mismo problema de decimales; sin columna Categoría/Subcategoría editable | 12 |
| **Exportar Excel** | .xlsx por categoría o todo | **Solo exporta las columnas definidas como "datos" de la categoría del producto: los productos sin categoría o con datos de otra categoría pierden valores** | **20** |
| | | **Cabeceras en `snake_case` (`precio_compra`) en vez de "Precio compra"** | 8 |
| | | Una sola columna "Subcategoría" con la ruta "A > B" en lugar de dos columnas Categoría / Subcategoría | 8 |
| | | "Una hoja por categoría" crea una hoja por **subcategoría** (demasiadas hojas) | 8 |
| | | Números guardados como texto por versiones antiguas → Excel no suma | 6 |
| | | Sin columnas Modelo IA / Etiqueta leída (útiles para auditar) | 3 |
| **Mi tienda** | categorías, subcategorías, renombrar | Renombrar una categoría no actualiza las rutas que la IA memorizó (no afecta datos) | 2 |
| | | Eliminar categoría → sus datos (`field_templates`) se borran en cascada → **los valores de esos productos quedan huérfanos** (no visibles, no exportables) | 10 |
| **Datos de mis productos** | crear/editar | Se pueden crear nombres con mayúsculas/espacios que no coinciden con las claves de la IA (ver 1.1) | 15 |
| **Inicio** | progreso, guía, consumo | Medidor subestima si se usa la clave fuera de la app | 6 |

---

## 3. Fallos ordenados por potencia de riesgo (R)

| # | R | Fallo | Efecto para el usuario |
|---|---|---|---|
| 1 | 20 | Campos numéricos no admiten decimales al teclear (Revisar, Producto, Tabla) | Precios mal guardados (12 en vez de 12.50) |
| 2 | 20 | Excel pierde valores de productos sin categoría / con datos de otra categoría | Inventario incompleto en el archivo |
| 3 | 15 | Claves de datos sensibles a mayúsculas ("Nombre" ≠ "nombre") | Campos aparentemente vacíos |
| 4 | 12 | Rehidratación de la cola reenvía el mismo `product_id` → duplicado / "already exists" | Fotos en error tras recargar |
| 5 | 12 | No hay alta manual de productos | Imposible registrar sin foto o corregir un olvido |
| 6 | 10 | Eliminar categoría borra sus datos y deja valores huérfanos | Pérdida silenciosa de información |
| 7 | 9 | Cupo diario de IA agotado en todos los modelos | Pausa hasta reinicio (ya avisado) |
| 8 | 8 | Excel: cabeceras técnicas, una columna de ruta, hoja por subcategoría | Archivo poco legible |
| 9 | 8 | Imágenes HEIC / decodificación en Android antiguo | "No se pudo leer" |
| 10 | 8 | Registro sin confirmar correo → login sin explicación | Usuario bloqueado |
| 11 | 6 | Coincidencia parcial de texto en clasificación automática | Subcategoría equivocada |
| 12 | 6 | "Guardar sin confirmar" no avanza | Sensación de bloqueo |
| 13 | 6 | Medidor de IA subestima consumo externo | Sorpresa al agotarse |
| 14 | 6 | Categoría duplicada por capitalización distinta | Desorden |

---

## 4. Plan de depuración

### Fase 1 — Integridad de datos (bloqueante) ✅ aplicada en este commit
1. **Decimales**: los campos guardan texto mientras se escribe y se convierten solo al guardar (`coerceValue` en save). Revisar, Producto y Tabla.
2. **Claves de datos normalizadas**: los nombres de datos se guardan en minúsculas sin espacios; lectura tolerante a mayúsculas (`getValue` insensible a capitalización) para lo ya guardado.
3. **Cola idempotente**: `/api/analyze` devuelve el producto existente si el `product_id` ya está creado; la subida usa `upsert: true`.
4. **Excel completo**: columnas = datos definidos **+ cualquier clave presente en los productos exportados**; cabeceras legibles ("Precio compra"); columnas **Categoría** y **Subcategoría** separadas; "una hoja por categoría" agrupa por categoría principal con columna Subcategoría; números como números; columnas Modelo IA y Etiqueta al final.

### Fase 2 — Flujo de creación ✅ aplicada
5. **Alta manual de producto**: botón "+ Producto" en Inventario y Revisar → formulario con foto opcional, categoría y datos.
6. **Eliminar categoría**: aviso explícito "se borrarán sus datos: X, Y" y opción de mover productos a otra categoría antes.
7. "Guardar sin confirmar" avanza a la siguiente tarjeta; "Deshacer" vuelve a la tarjeta deshecha.
8. Producto sin categoría: texto "Elige la categoría para completar precio y stock".

### Fase 3 — Robustez ✅ aplicada
9. Conversión HEIC → JPEG en el cliente (heic2any) y fallback a `<img>` cuando `createImageBitmap` falle.
10. Login: si el correo no está confirmado, mensaje "Revisa tu correo" + botón *Reenviar confirmación*.
11. Clasificación por texto solo con coincidencia de palabra completa.
12. Medidor: opción "Ajustar consumo" manual y registro de llamadas externas por `GEMINI_API_KEY` compartida (documentado).

### Fase 4 — Pruebas automatizadas ✅ aplicada (`npm run test:e2e`, `npm run ai:probe`)
13. Script `npm run test:e2e` (ya existen scripts ad hoc): registro → categoría → foto sintética → revisar → exportar y comprobar el .xlsx (columnas y valores).
14. Verificación semanal del cupo y modelos disponibles (`scripts/gemini-probe.mjs`).

---

## 5. Cómo reproducir los fallos críticos (antes de la corrección)
- **Decimales**: Revisar → precio → teclear `1`, `2`, `.`, `5` → el campo muestra `125`.
- **Excel**: producto sin categoría con nombre y marca → Exportar "Todo" → fila sin nombre ni marca.
- **Claves**: dato "Nombre" (mayúscula) en Juguetes → la IA guarda `Nombre`, la tarjeta busca `nombre` → vacío.
- **Cola**: tomar 3 fotos, recargar la app a mitad → las que ya se habían creado reaparecen en error "duplicate key".

---

# Auditoría 2 · 2026-11-17 — Fases 0–6 en producción

Alcance: migraciones `001`–`019`, `lib/`, rutas `app/api/*`, pantallas `(app)`, flujos de CI. Método: lectura del código + comprobación del estado real de Supabase y de GitHub Actions. `npx tsc --noEmit` y `npm run lint` pasan sin errores. Las pruebas `test:*` no se pudieron correr porque la base está pausada (§2.0).

Gravedad: **C** = crítico (datos o seguridad), **A** = alto (cifras de negocio incorrectas), **M** = medio (escala, rendimiento, mantenimiento), **B** = bajo. El plan de corrección y el **estado de cada hallazgo** están en `PLAN_CIMIENTOS.md` (resueltos al 2026-11-17: §2.0 y M8 en C0; S11, E1, E2 y la base de M2 en C1; C1, C2, C3, C4, C5, N4 y N7 en C2; C6, N1, N2 y N6 en C3; N3, N5, V6 y E4 —1 llamada por pantalla— en C4; S2–S10, S12 (consumo de IA) y los respaldos de S1 en C5.1).

## 2.0 Incidente: «no puedo iniciar sesión» (`POST /auth/v1/token?grant_type=password` sin respuesta)

| Dato | Evidencia |
|---|---|
| Estado del proyecto Supabase `vqsktzeujuphbfzprmhe` | API de gestión: `"status":"INACTIVE"` (**pausado**). Health, REST y token no responden (HTTP 000). |
| Desde cuándo | Respaldo semanal `backup.yml`: éxito el 2026-10-04; **falla desde el 2026-10-11** con `TypeError: fetch failed` (6 semanas seguidas, sin aviso a nadie). |
| Causa | Supabase Free pausa el proyecto tras ~7 días sin actividad. Último uso real: 2026-09-23. El respaldo semanal (cada 7 días, solo lectura con service role) no basta para mantenerlo activo. |
| Por qué el navegador solo muestra «URL de solicitud / Política de referente» | El dominio pausado no responde con cabeceras CORS: `supabase-js` recibe un fallo de red («Failed to fetch» / `AuthRetryableFetchError`), no un 400. El login muestra ese texto crudo: `app/(auth)/login/page.tsx:43-49` solo traduce «Invalid login credentials» y «Email not confirmed». |

**Solución inmediata:** panel de Supabase → proyecto → **Restore project** (o `POST https://api.supabase.com/v1/projects/vqsktzeujuphbfzprmhe/restore` con `SUPABASE_ACCESS_TOKEN` de `.env.local`). Tarda unos minutos y conserva los datos. Un proyecto Free pausado se puede restaurar desde el panel durante ~90 días (aprox. hasta principios de enero de 2027).

**Para que no vuelva a pasar** (paso C0 de la Fase 6.9):
1. `.github/workflows/keepalive.yml`: cron cada 2 días con una consulta real a la base (`rpc('ping')` con la clave anónima).
2. Los workflows que fallan abren un issue o avisan por correo. Un respaldo roto 6 semanas sin que nadie lo sepa es en sí un hallazgo crítico.
3. Login: traducir los errores de red («No pudimos conectar con el servidor. Revisa tu internet o intenta en unos minutos») en vez de mostrar el mensaje técnico.
4. Antes del primer cliente de pago: Supabase Pro (brecha A4 ya aprobada), que no se pausa.

## 2.1 Críticos — integridad de datos

| # | Hallazgo | Evidencia | Efecto | Corrección |
|---|---|---|---|---|
| C1 | **Operaciones de varios pasos sin transacción.** Venta = insertar ticket → líneas → por cada línea leer stock, escribir stock, insertar movimiento. Igual en entregas, liquidaciones, compras, conteos y abonos. Los errores de los pasos intermedios se ignoran. | `lib/sales.ts:56-120`, `app/(app)/consign/page.tsx:121-145`, `lib/customers.ts:29-44` | Un corte de red a mitad deja tickets sin líneas, stock sin descontar o abonos aplicados sin registro. | Funciones SQL atómicas (`rpc`): `register_sale`, `register_payment`, `register_purchase`, `consign_out`, `consign_settle`, `apply_count`, `adjust_stock`. El cliente solo llama a la función. |
| C2 | **Stock con «leer → calcular → escribir» desde el navegador** (12 sitios distintos) sobre `products.data` (jsonb) completo. | `lib/sales.ts:99-104`, `lib/offline.ts:131-140`, `consign`, `count`, `prices`, `purchases`, `review`, `scan`, `labels` | Dos celulares vendiendo a la vez pierden descuentos (actualización perdida); además se reescribe todo `data` y se pisan otros cambios hechos entre medio. | Columna `products.stock numeric` real y actualización atómica en SQL (`update … set stock = stock - $qty returning stock`). `data.stock` deja de ser la fuente (vista de compatibilidad durante la transición). |
| C3 | **Vender más de lo que hay recorta el stock a 0 en silencio** (`Math.max(0, …)`), pero el movimiento registra la cantidad completa. | `lib/sales.ts:96,103`; entrega `consign/page.tsx:133,140`, y la devolución suma la cantidad completa | Historial que no cuadra con el stock; en consignación, entregar más de lo que hay y luego devolver **infla** el stock. | En la función SQL: permitir negativo explícito o rechazar; nunca recortar sin registrar la diferencia. |
| C4 | **El costo de la venta lo calcula el navegador.** El vendedor lee `product_summaries`, donde `precio_compra` es nulo para él. | `app/(app)/sell/page.tsx:71` + `014_negocios.sql:225` + `lib/sales.ts:53,85` | Las ventas hechas por un vendedor desde su cuenta quedan con `unit_cost = null` y `cost_total = 0` → **la ganancia del negocio sale inflada**. | `register_sale` toma el costo vigente en el servidor (`security definer`). |
| C5 | **Correlativo de venta con `max(number)+1`** sin bloqueo ni índice único. | `014_negocios.sql:147-154` | Dos ventas simultáneas reciben el mismo N.º. | Contador por negocio (`business_counters`, `update … returning`) + `unique (business_id, number)`. |
| C6 | **Cierre de caja calculado en el cliente** y guardado tal cual con `upsert`, que sobreescribe el anterior. | `app/(app)/cash/page.tsx:53-115` | Cualquier miembro puede guardar totales arbitrarios; se pierde el cierre previo del día. | `close_cash(day, counted)` en SQL que calcula los totales; historial de cierres (sin `upsert`). |

## 2.2 Críticos — seguridad y permisos (adelantan parte de la Fase 7)

| # | Hallazgo | Evidencia | Efecto | Corrección |
|---|---|---|---|---|
| S1 | **El vendedor recibe costos y ganancia del servidor.** RLS da `for all` a cualquier miembro en todas las tablas; solo la vista `product_summaries` oculta el costo. | `014_negocios.sql:118-121`; `products.data.precio_compra`, `sale_items.unit_cost`, `sales.cost_total`, `cash_closings.profit`, `purchases`, `price_history`; bucket `backups` (Excel completo con costos) legible por todos los miembros (`019_respaldos.sql`) | El criterio de la Fase 6 «el vendedor no ve costos» solo se cumple en la interfaz (`ProductDetailClient.tsx:355`). | Costo fuera de `data` (columna propia), vistas por rol, RLS por rol en las tablas de costo, `backups` solo para el dueño. |
| S2 | **El vendedor puede borrar o editar todo** (productos, ventas, clientes, categorías, cierres) con la clave anónima. | RLS `for all` sin `my_role` | Pérdida de datos o fraude sin rastro. | Políticas separadas `select/insert/update/delete` por rol; borrados solo del dueño; ventas inmutables (anulación = A8). |
| S3 | **La firma («quién lo hizo») se puede falsificar.** El `insert` acepta cualquier `user_id`; la cabecera `x-actor` se acepta sin verificar el PIN en la base; en `update` el `user_id` se puede cambiar. | `015_firma.sql:17-28` (solo actúa si hay cabecera); la política `with check` solo mira `business_id` | El registro de quién vendió o ajustó no es prueba de nada. | `user_id` lo pone siempre un disparador (ignora lo que mande el cliente) y es inmutable en `update`; `verify_pin` devuelve un **token firmado** de corta duración y `set_actor` lo valida, en lugar de aceptar un uuid suelto. |
| S4 | **Volver al dueño no pide PIN.** En un celular con la sesión del dueño, quien atiende como vendedor toca «Volver a mi cuenta» y recupera el rol de dueño. | `components/WhoIsServing.tsx:27-31` | Anula el propósito del PIN en el celular compartido. | Pedir el PIN del dueño también para volver. |
| S5 | **La interfaz falla abierta:** rol por defecto `"dueno"`, y `OwnerOnly` muestra el contenido mientras `business` no ha cargado. | `components/FlowProvider.tsx:35,51`; `components/OwnerOnly.tsx:10` | El vendedor ve un instante las pantallas del dueño, y estas lanzan sus consultas. | Estado `loading` explícito; rol mínimo (`vendedor`) por defecto hasta saberlo. |
| S6 | **El dueño puede cambiarse el plan** (`businesses_owner_update` sin restricción de columnas). | `014_negocios.sql:132` | Rompe la Fase 7 antes de empezar. | `update` del dueño limitado a `name` (y ajustes); `plan` y `plan_until` solo por service role. |
| S7 | **`/api/cleanup` sin control de rol**, con service role y sobre **todos** los negocios del usuario. El `GET` borra la papelera vencida (efecto secundario). | `app/api/cleanup/route.ts:23-39,167-177` | Un vendedor puede vaciar la papelera y borrar categorías y campos del negocio. | Exigir rol dueño + solo el negocio activo; la purga pasa a un cron. |
| S8 | **`/api/usage POST` afecta a todos los clientes:** cualquiera inserta hasta 1.000 filas de «ajuste» en el contador global o borra ajustes de otros (el `delete` no filtra `user_id`). | `app/api/usage/route.ts:30-37` | Puede marcar el cupo compartido como agotado para toda la app. | Permitirlo solo con clave propia (BYOK) o a un administrador del servicio; filtrar por `user_id`. |
| S9 | **Datos de varios negocios mezclados.** RLS devuelve filas de *todos* los negocios del usuario (`my_business_ids()`) y ninguna consulta del navegador filtra por `business_id`. | `014_negocios.sql:118-121`; en `app/(app)` solo `cash` y `team` usan `business_id` | Quien pertenece a dos negocios (p. ej. un dueño invitado a otro) ve inventarios, ventas y caja combinados. | Lectura limitada al negocio activo (`current_business_id()`) en RLS o en la capa de datos; selector de negocio. |
| S10 | **Los datos sin conexión no se borran al cerrar sesión** (IndexedDB `inventaria-offline`, cola de fotos, actor en `sessionStorage`), y la caché no lleva usuario ni negocio en la clave. | `app/(app)/settings/page.tsx:54-58`; `lib/offline.ts:12` | En un celular compartido, la siguiente cuenta ve el inventario anterior y la cola intenta aplicar movimientos ajenos. | `signOut` limpia IndexedDB, cola y actor; claves `inventory:{business_id}`. |
| S11 | **Código de barras de variante único por `user_id`**, no por negocio. | `007_variantes.sql:36` | Dos miembros pueden registrar el mismo código; un usuario con dos negocios choca consigo mismo. | `unique (business_id, codigo_barras)`. |
| S12 | Fotos en bucket público (ya registrado como A3). El registro de consumo de IA usa un arreglo global del módulo, compartido entre peticiones concurrentes. | `migrations.sql:134-144`; `lib/gemini/index.ts:272-275` | Fotos accesibles con la URL; consumo atribuido al usuario equivocado. | URLs firmadas; los intentos se devuelven por petición desde `generateContent`. |

## 2.3 Altos — cifras de negocio incorrectas

| # | Hallazgo | Evidencia | Efecto | Corrección |
|---|---|---|---|---|
| N1 | **Los abonos no entran a la caja.** El abono modifica `sales.paid` de ventas antiguas; la caja suma `paid` solo de las ventas de hoy y no lee `payments`. | `lib/customers.ts:29-44`; `app/(app)/cash/page.tsx:37-64` | El efectivo esperado no incluye lo cobrado de fiados, y los días pasados cambian sus cifras después del cierre. | Registrar el dinero como **pagos** (`payments` con `sale_id` opcional, incluido el pago al vender); la caja suma los pagos del día por medio; `sales.paid` se deriva. |
| N2 | **El pago «mixto» no se puede cuadrar:** todo el monto va al cubo «mixto», que no cuenta como efectivo. | `cash/page.tsx:53-64` | Descuadre en cada venta mixta. | Venta con varios pagos (efectivo + QR) en la tabla de pagos. |
| N3 | **El nombre del negocio y los ajustes de avisos se leen del perfil del usuario**, no del negocio. | `profiles.business_name` en `sell:41`, `dashboard:49`, `digest:36`, `customers/detail:51`, `api/ask:36`; `profiles.min_stock_default/expiry_days` en `FlowProvider.tsx:83-92` | El vendedor ve «Mi negocio» en tickets y recordatorios, y otros mínimos de reposición. | Leer y editar `businesses.name`; mover los ajustes a `businesses` con una migración que copie los del dueño. |
| N4 | **La consignación cuenta doble salida.** La entrega registra «salida»; al liquidar se repone el stock sin movimiento y `registerSale` registra «venta». | `consign/page.tsx:200-214` | Reportes de rotación y movimientos con unidades duplicadas. | `consign_settle` crea la venta **sin** tocar stock ni generar una salida adicional. |
| N5 | **«Hoy» depende del reloj y la zona del celular** (`setHours(0,0,0,0)`), y otros puntos usan UTC (`toISOString().slice(0,10)`). | `cash/page.tsx:16,35`; `lib/reports.ts:96`; `api/ask:69` | En Bolivia (UTC−4), las ventas después de las 20:00 caen en otro día según la pantalla. | Zona horaria del negocio (`businesses.timezone`, por defecto `America/La_Paz`) y cortes de día calculados en SQL. |
| N6 | **El sobrepago queda solo como texto** en la nota del abono. | `lib/customers.ts:43` | El saldo a favor no existe para el sistema. | Saldo del cliente = ventas − pagos (vista), con saldo a favor. |
| N7 | **Cola sin conexión: un rechazo permanente se reintenta para siempre**, y la cola solo cubre ajustes de stock, no ventas (el criterio de la Fase 1 hablaba de «registrar una venta en modo avión»). | `lib/offline.ts:160-163`; `sell/page.tsx` no usa la cola | Aviso de error perpetuo; la venta sin conexión no existe. | Movimientos con estado (`fallido` tras N intentos, visible para revisar); venta sin conexión vía `register_sale` idempotente (id generado en el cliente). |

## 2.4 Medios — escala y rendimiento

| # | Hallazgo | Evidencia | Corrección |
|---|---|---|---|
| E1 | Escanear un código descarga **todos los productos con todo `data`** en cada lectura (también desde Vender). | `app/api/barcode/route.ts:28-48` | Columna `codigo_barras` con índice `(business_id, codigo_barras)` y búsqueda directa. |
| E2 | La búsqueda usa `ilike '%x%'` sobre una columna **calculada** de la vista (`jkey` + `jsonb_each_text` por fila): recorre toda la tabla. Los índices siguen siendo por `user_id`, no por negocio. | `product_summaries.search` (`008`–`014`); `products_user_status` | Columnas reales mantenidas por disparador + índice `pg_trgm` GIN sobre `search` + índices `(business_id, status, deleted_at)`. |
| E3 | Inicio, Reposición, Reportes, Resumen y Etiquetas cargan **todos** los productos y calculan en el navegador. | `dashboard:50`, `restock:54`, `reports:35`, `digest:31`, `labels:45` | Agregados en SQL (`dashboard_summary()`, `restock_list()`, `report_*()`) y paginación. |
| E4 | `FlowProvider.refresh` hace ~7 peticiones **en cada cambio de ruta** (2 conteos, `getUser` contra Auth, `rpc`, negocio, miembros, perfil). El middleware también llama a `getUser` en cada petición, y cada ruta API lo vuelve a hacer. | `components/FlowProvider.tsx:54-117`; `middleware.ts:27` | Una `rpc('session_context')` al abrir y tras los cambios; refresco por eventos; validar el JWT localmente en el middleware. |
| E5 | «Pregúntale» resume ≤400 productos y 90 días (ya B7); el detector de duplicados lee hasta 2.000 productos por foto. | `api/ask:32`; `api/analyze:210` | Funciones SQL con parámetros; duplicados con `pg_trgm` `similarity()` en SQL. |
| E6 | El estado de cupo agotado vive en la memoria del isolate (ya A1). | `lib/gemini/index.ts:204` | Tabla `ai_quota_state`. |

## 2.5 Arquitectura y mantenibilidad

| # | Hallazgo | Evidencia | Recomendación |
|---|---|---|---|
| M1 | **Sin capa de datos:** 338 llamadas `supabase.from(...)` repartidas en 48 pantallas y componentes; la misma lógica (clave de stock `["stock","cantidad","existencias"]`) está copiada ~12 veces. | `grep 'from("'` | `lib/data/<dominio>.ts` (productos, ventas, clientes, caja…) que envuelve las `rpc`; las pantallas no hablan directamente con las tablas. |
| M2 | **Campos clave dentro de `data` jsonb** con nombres libres (`precio`/`precio_venta`/`price`, `stock`/`cantidad`/`existencias`). | `lib/inventory.ts:49-51`, `jkey()` en SQL | Campos del sistema como columnas (`nombre, marca, precio, precio_compra, precio_mayorista, stock, codigo_barras, unidades_por_paquete`); `data` solo para los datos propios de cada categoría. Migración que copia los valores + vista de compatibilidad. |
| M3 | Tipos escritos a mano (`types/database.ts`, 678 líneas). | — | `supabase gen types typescript` en `npm run db:types` y comprobación en CI. |
| M4 | Pantallas muy grandes que mezclan datos, reglas y vista: `review` 872 líneas, `scan` 568, `ProductDetailClient` 436, `consign` 426. | `wc -l` | Separar hooks de datos (`useReviewQueue`), reglas puras (testeables) y componentes. |
| M5 | Código duplicado entre `api/analyze` y `api/reanalyze` (`unionAiFields`, `bytesToBase64`, normalización de datos). | ambos `route.ts` | `lib/ai/productAnalysis.ts` compartido. |
| M6 | Sin validación de entrada en las rutas (ya A2/zod) y sin pruebas en CI (ya A6). Las pruebas existentes corren contra **producción**. | `deploy.yml` | Proyecto Supabase de pruebas (o `supabase start` en CI) + pruebas unitarias de reglas puras (`lib/inventory`, `lib/import`, `parseExpiry`) con `vitest`. |
| M7 | Migraciones aplicadas a mano, sin registro de cuáles están aplicadas; `product_summaries` se redefine 4 veces. | `supabase/0*.sql` | Tabla `schema_migrations` (o la CLI de Supabase con `supabase/migrations/<fecha>_*.sql`) y `npm run db:migrate` idempotente. |
| M8 | Avisos de obsolescencia: Node 20 en `deploy.yml`, `actions/*@v4` corriendo sobre Node 20, Next 14.2. | logs de Actions | Node 22 en todos los workflows; planificar la subida a Next 15 cuando el adaptador de Cloudflare lo permita. |

## 2.6 Visual y experiencia de uso

| # | Observación | Recomendación |
|---|---|---|
| V1 | La barra inferior está pensada para **cargar inventario** (Inicio · Revisar · Agregar · Inventario), pero el uso diario de una tienda es **vender**; «Vender» está dentro de «Más», junto a ~30 entradas. | Barra según rol y etapa: con el inventario cargado → Inicio · **Vender** · Escanear · Inventario · Más; durante la carga inicial, la actual. El vendedor no ve «Revisar» si no hay pendientes. |
| V2 | Menú «Más» con ~30 destinos en 4 grupos e **iconos repetidos** (IconHome para Inicio, Clientes y Equipo; IconTag para Vender, Escanear, Precios y Etiquetas; IconBox ×3). | Un icono propio por destino; agrupar por tarea (Vender y cobrar · Mercadería · Números · Configurar) y mover lo ocasional (Importar, Etiquetas, Respaldos) a Configurar. Buscador en el menú. |
| V3 | Texto muy pequeño: 101 usos de `text-[11px]`, 25 de `text-[10px]` y 4 de `text-[9px]`, para un público no técnico en celular. | Mínimo 12 px para texto informativo y 14 px para acciones; escala tipográfica en `tailwind.config.ts` en lugar de tamaños arbitrarios. |
| V4 | Accesibilidad: 19 `aria-label` en toda la app; botones de solo icono (cerrar, borrar, +/−) sin etiqueta. | `aria-label` obligatorio en botones de icono (regla de lint `jsx-a11y`), foco visible, contraste AA. |
| V5 | Errores técnicos mostrados tal cual (`toast("error", error.message)`, en inglés: «duplicate key…», «Failed to fetch»). | `lib/errors.ts`, que traduce errores de red, permisos, duplicados y cupo a mensajes simples, usado por todos los `toast` y por el login. |
| V6 | Moneda «Bs» escrita en el código (~87 apariciones) con formato `es` genérico. | `businesses.currency` + `fmtMoney(n, currency)` (ya previsto en la Fase 8). |
| V7 | Al vendedor se le muestran pantallas que luego dicen «Esto lo maneja el dueño». | Ocultarlas desde el menú y la barra (ya parcial con `ownerOnly`) y evitar el destello inicial (S5). |
| V8 | Cobro sin teclado numérico propio y sin cálculo de vuelto. | Hoja de cobro con teclado grande, «efectivo recibido → vuelto». |
