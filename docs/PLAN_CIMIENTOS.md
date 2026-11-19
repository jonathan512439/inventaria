# Fase 6.9 · Cimientos — plan detallado de corrección

Origen: `AUDITORIA.md` → «Auditoría 2 · 2026-11-17» (hallazgos C1–C6, S1–S12, N1–N7, E1–E6, M1–M8, V1–V8). Resumen y lugar en el calendario: `PLAN_V3.md` → «Fase 6.9». Aprobado por el usuario el 2026-11-17 («comienza con C0 y luego C1»).

**Regla de fondo:** toda escritura que mueve dinero o stock pasa por una función SQL atómica (`rpc`) que hace todo o nada. El navegador no calcula ni escribe stock, costos ni totales; solo llama a la función y muestra el resultado.

Cada paso es un despliegue propio con su entrada en `CHANGELOG.md` (17.0 = C0, 17.1 = C1, …), su migración numerada y su prueba automática.

## Estado (actualizar al cerrar cada paso)

| Paso | Estado | Migración | Prueba | CHANGELOG |
|---|---|---|---|---|
| C0 · Operación y alertas | ✅ 2026-11-17 | — | ejecución manual de `keepalive` y `backup` | 17.0 |
| C1 · Campos del sistema como columnas | ✅ 2026-11-17 | `020_campos_sistema.sql` | `npm run test:fields` + `test:variants` | 17.1 |
| C2 · Operaciones atómicas | ✅ 2026-11-17 | `021_operaciones.sql` | `npm run test:ops` | 17.2 |
| C3 · El dinero como pagos | ✅ 2026-11-18 | `022_pagos.sql` | `npm run test:ops` (ampliada) | 17.3 |
| C4 · Ajustes del negocio y zona horaria | ✅ 2026-11-18 | `023_ajustes_negocio.sql` | `npm run test:ops` + manual | 17.4 |
| C5.1 · Permisos por rol y operación, negocio activo, firma | ✅ 2026-11-18 | `024_permisos.sql` | `npm run test:access` (24) + `test:team` | 17.5 |
| C5.2 · Costos fuera del alcance del vendedor | ✅ 2026-11-18 | `025_costos.sql` | `npm run test:access` (ampliada) | 17.6 |
| C5.3 · Fotos privadas | ✅ 2026-11-18 | `026_fotos_privadas.sql` | `npm run test:access` (ampliada) | 17.7 |
| C7 · Reconstrucción visual completa (C7.1–C7.9) | ✅ 2026-11-19 (falta la prueba con 3 personas, a cargo del usuario) | `027_numeros.sql` | manual + `test:e2e` + `test:numbers` + prueba con 3 personas | 17.8–17.16 |
| C6 · Calidad continua | pendiente (al final, a pedido del usuario 2026-11-18) | `schema_migrations` | CI | — |

**Orden (2026-11-18):** el usuario pidió hacer **C7 antes que C6**; C6 queda al final. **C7 terminó el 2026-11-19: sigue C6.** Avance de C7 y decisiones de cada paso: `RECONSTRUCCION_VISUAL.md` → §7.

## Pendientes antes de C6 (2026-11-19)

El usuario pidió dejar **todo validado y funcionando** antes del proyecto de pruebas (C6). Orden propuesto (se corrige en el chat antes de empezar):

| # | Qué | Por qué | Dónde | Prueba |
|---|---|---|---|---|
| P0 | **Validación del usuario** de C7.6–C7.9 (Clientes, Números, Ajustes, menú final) y **prueba con 3 personas** (dueño, vendedor, alguien nuevo) | Criterio de cierre de C7 | `RECONSTRUCCION_VISUAL.md` §7 (anotar observaciones) | manual |
| P1 | ✅ 2026-11-19 (17.17) · **Fotos en el Excel**: la columna «Foto» exporta la ruta del bucket privado (026) → el enlace no abre | Regresión de C5.3 | `lib/export.ts` (enlace firmado de 7 días o «sí/no»), respaldo igual | `test:backup` + manual |
| P2 | ✅ 2026-11-19 (17.17, `028_costo_variante.sql`) · **Costo por variante**: hoy solo se puede poner desde «Llegó mercadería»; la ficha edita el costo del producto, no el de cada talla/color | Ganancia por variante incompleta | Ficha › Precios (dueño) → `product_costs` por variante | `test:variants` ampliada |
| P3 | ✅ 2026-11-19 (17.18; falta la prueba en modo avión del usuario) · **Vender sin conexión** (N7): Vender exige red; solo los ajustes de stock se guardan sin conexión | Criterio de la Fase 1 («venta en modo avión») | cola de ventas con `register_sale` idempotente (id del celular) + aviso «N por enviar» | `test:ops` + manual en modo avión |
| P4 | **IA: cupo agotado en memoria** (E6) y **duplicados leyendo 2.000 productos por foto** (E5) | Con varias instancias se reintentan modelos agotados; fotos lentas con inventarios grandes | tabla `ai_quota_state`; `similar_products()` con `pg_trgm` en SQL | `test:e2e` |
| P5 | **Menos peticiones al navegar** (E4): `FlowProvider` vuelve a pedir el contexto en cada cambio de pantalla | Datos móviles y velocidad | refrescar por eventos (venta, revisar, cambio de negocio), no por ruta | manual (pestaña Red) |
| P6 | ✅ 2026-11-19 (17.17, `AUDITORIA.md` §2.7; además los últimos 13 errores crudos pasan por `friendlyError`) · **AUDITORIA al día**: las tablas de la Auditoría 2 no marcan lo ya resuelto en C1–C7 | Que el documento refleje el estado real | `AUDITORIA.md` (columna Estado) | — |

Quedan para C6 (proyecto de pruebas): registro de migraciones (M7), tipos generados (M3), pruebas en CI (M6), código compartido analyze/reanalyze (M5), quitar columnas viejas de `profiles`, Next 15 (M8).

## Ronda de validación 1 (2026-11-19) — correcciones pedidas por el usuario

**Validado sin observaciones:** vender sin conexión (17.18), fotos en el Excel (17.17), clientes, entrega de mercadería y rendición de cuentas (17.13). Lo demás que no se menciona abajo, el usuario lo probó y funciona.
**Decisiones del usuario (2026-11-19):** fichas de Gestionar aprobadas, con «Llegó mercadería» renombrada **«Entrada de inventario»** en toda la app; los dos modos de uso, aprobados; borrar el «Mi negocio» vacío de su cuenta de vendedor (hecho en `029`); orden R1–R2 → R6–R8 → R3–R4 → R5 → R9 + R11 → R10.
**Orden de trabajo** (cada bloque se despliega y documenta por separado):

| # | Qué | Causa / por qué | Cómo se resuelve (dónde) | Prueba |
|---|---|---|---|---|
| R1 | ✅ 17.19 · **El enlace de invitación lleva al login y, al crear cuenta, se crea un negocio propio** | (a) `middleware.ts` guarda en `next` solo la ruta, sin `?code=` → el código se pierde. (b) El disparador `handle_new_user_business` (014) crea «Mi negocio» a **toda** cuenta nueva. Comprobado en la base: la cuenta de vendedor del usuario quedó **dueña de un «Mi negocio» vacío** y vendedora en «Importadora Rios». | `next` con ruta **y** consulta; login y registro pasan `next` entre sí y al correo de confirmación (`emailRedirectTo` → `/join?code=…`); `/join` sin sesión muestra «Crear cuenta» / «Ya tengo cuenta» conservando el código. Migración `029_invitacion.sql`: el registro manda `invite_code` en los metadatos; el disparador, si el código es válido, **une a la persona como vendedor y no crea negocio**. `accept_invite` borra el negocio propio de la persona si está **vacío** (sin productos, ventas ni clientes) y deja activo el negocio al que se une. | `test:team` ampliado: registro con código → 1 solo negocio, rol vendedor |
| R2 | ✅ 17.19 · **Cuentas de dueño y vendedor en el mismo celular se confunden** (el vendedor vio Mis datos y Mi catálogo; el respaldo dio «sin permiso» como dueño) | Lo primero se explica por R1: esa cuenta era **dueña** de su «Mi negocio» vacío. El respaldo de un dueño funciona (probado: leer las 22 tablas y guardar dos veces el mismo día). Lo que queda: al entrar o salir la app **no se recarga**, y lo de la cuenta anterior sigue en memoria hasta que llega el contexto nuevo. | Entrar y salir con **recarga completa** (`window.location`), no `router.replace`. En la cabecera, **nombre del negocio + «Dueño / Vendedor»** siempre visibles (con R11). El aviso de permiso dice qué cuenta y negocio están activos. Si el error del respaldo se repite tras R1, se pide el texto exacto. | `test:access` + manual con 2 cuentas en el mismo celular |
| R3 | ✅ 17.21 · **Vender: lista de productos para quien no recuerda el nombre** | El buscador solo muestra algo cuando se escribe. | Componente nuevo `ProductBrowser` (debajo del buscador, en Vender y en Llegó mercadería): chips de **Categorías** (y subcategorías al tocar una) + lista **paginada de 20** (nombre, precio, stock; «Ver 20 más»), ordenada por nombre, con «Más vendidos» primero. Tocar = agregar (si tiene tallas o colores, pregunta cuál). Lee `product_summaries` por categoría con `range()`; sin conexión, de la copia del celular. | manual + `test:e2e` (pantalla responde) |
| R4 | ✅ 17.21 · **Entrada de inventario (antes «Llegó mercadería») compacta, segmentada y paginada** | Con muchas líneas, «Guardar entrada» y las últimas opciones quedan lejos. | Nueva entrada: el mismo `ProductBrowser` (R3); cada línea en **una fila compacta** (foto 40 px, nombre, «tenías 4 → 7», − n +); costo y vencimiento se abren por línea; después de 10 líneas se pliegan las anteriores («ver las otras N»); resumen fijo arriba del botón: «5 productos · 32 unidades». Pestaña **Entradas**: agrupadas **Hoy · Esta semana · Antes**, cada entrada en una fila («Hoy 10:32 · Proveedor · 5 productos · 32 u.») que se abre con sus productos; 20 por página. | manual |
| R5 | **Qué hacer con los productos por vencer** | Solo se avisa. | Hoja **«Por vencer»** (desde Inicio y el filtro de Productos) con 4 acciones por producto: **Ponerlo en oferta** (nuevo precio, queda en el historial de precios), **Retirar del stock** (salida con motivo «Vencido»), **Devolver al proveedor** (salida con ese motivo) y **Cambiar la fecha** (llegó otro lote). Motivo «Vencido» nuevo en `MOTIVOS_SALIDA`. | manual |
| R6 | ✅ 17.20 · **Opciones separadas por coma sin ejemplo** | — | En Mi catálogo y donde se definen opciones: texto de ayuda «Separa cada opción con una coma. Ej.: fresa, uva, menta» y vista previa de chips mientras se escribe. | manual |
| R7 | ✅ 17.20 · **Vender: «cliente para quedar a cuenta» poco claro** | El selector de cliente es igual para «opcional» y «obligatorio». | Con «Paga una parte» o «A cuenta», aparece una tarjeta ámbar **«¿Quién queda debiendo?»** con buscador y botón grande **«+ Cliente nuevo»** (solo el nombre; el teléfono es opcional). El botón de cobrar dice **«Elige quién debe»** y está apagado hasta elegirlo. Con «Paga todo», el cliente es un enlace plegado «Agregar cliente (opcional)». | manual |
| R8 | ✅ 17.20 · **Entrega de mercadería: unidades y precio ambiguos** | — | Etiquetas **«Unidades»** y **«Precio por unidad»** y total en vivo: «5 u. × Bs 10 = Bs 50». Igual en «Rendir cuentas»: «vendió 3 × Bs 10 = Bs 30». | manual |
| R9 | **Logo del negocio, y que el nombre y el logo se vean más** | — | Ajustes › Negocio: «Logo» (foto o galería, recorte cuadrado, comprimido a 256 px WebP). Bucket **público** `business-logos/<negocio>/logo.webp` (un logo no es un dato sensible y así sale en el ticket impreso). Columna `businesses.logo_url` (migración `030`). Se muestra en la cabecera (móvil y barra lateral de escritorio, junto al nombre), en Inicio (tarjeta de bienvenida) y en el ticket impreso. Sin logo: círculo con la inicial y el color de la marca. | manual |
| R10 | **Botón central «Gestionar» y modo de uso** | El usuario aclara la idea del producto: lo principal es **ingresar mercadería (nueva o existente) rápido y fluido**, no solo vender ni llevar contabilidad; y algunos lo quieren **solo para controlar productos**. | Ver `RECONSTRUCCION_VISUAL.md` §8: botón central **Gestionar** (Vender · Llegó mercadería · Producto nuevo · Contar) y **modo de uso del negocio** («Solo inventario» / «Inventario y ventas»), elegido al empezar y cambiable en Ajustes. | `test:e2e` + manual con los dos modos |
| R11 | **Cabecera con identidad** | Junto con R2 y R9. | Cabecera móvil: logo + nombre del negocio (toca → Ajustes › Negocio) y una etiqueta pequeña con el rol. | manual |

Después de esta ronda siguen **P4** (IA) y **P5** (menos peticiones), y luego C6.

## Contexto para retomar (decisiones tomadas)

- **Transición `data` → columnas (C1).** `products` gana columnas del sistema. Un solo disparador (`products_sync_fields`) las sincroniza **en los dos sentidos**: si cambia la columna, se copia a `data` (con la clave que ya usa el producto: `stock`/`cantidad`/`existencias`…); si cambia `data`, se copia a la columna. Así el código actual (que escribe `data`) sigue funcionando y las funciones de C2 escriben la columna directamente. Con variantes, el stock siempre es la suma de las variantes (absorbe el antiguo `products_stock_guard`).
- **`data` deja de ser la fuente en C2.** Desde C2 nadie escribe stock por `data`; el formulario de producto sigue pudiendo editar `data` (el disparador lo refleja). Retirar los campos del sistema de `data` queda para después de C5 (cuando el costo salga a su propia tabla).
- **Vender sin stock registrado (C2):** se permite (la tienda no puede negarse a vender). El stock queda en 0 y el movimiento guarda `faltante` (unidades vendidas por encima de lo registrado), visible en Movimientos y en el conteo. Nunca se recorta en silencio.
- **Idempotencia (C2):** cada operación lleva un `id` generado en el celular (`crypto.randomUUID()`); repetirla devuelve el resultado ya guardado. Es lo que permite reintentar sin duplicar y la venta sin conexión.
- **Costos ocultos de verdad (C5):** el costo sale de `products.data` a la tabla `product_costs` (solo dueño). `sale_items.unit_cost` → `sale_item_costs` (solo dueño). Las vistas para el vendedor no tienen esas columnas.
- **Pruebas** contra el proyecto de producción con usuarios temporales hasta C6 (proyecto de pruebas aparte).

---

## C0 · Operación y alertas (cierra §2.0 y M8)

| Qué | Dónde |
|---|---|
| Restaurar el proyecto pausado | Hecho a mano por el usuario el 2026-11-17 (`ACTIVE_HEALTHY`). |
| Mantener la base activa: consulta real cada 2 días | `.github/workflows/keepalive.yml` (REST `businesses?select=id&limit=1` + `auth/v1/health` con la clave anónima) |
| Aviso cuando falla un workflow: abre (o comenta) un issue «Falló: <workflow>» | último paso `if: failure()` en `deploy.yml`, `backup.yml`, `keepalive.yml` (`permissions: issues: write`) |
| Node 22 en el despliegue | `deploy.yml` |
| Mensajes de error sencillos (red, cupo, permisos, duplicados, credenciales) | `lib/errors.ts` → `friendlyError(e)`; usado en login y registro (en C7 se extiende a todos los `toast`) |

**Acepta cuando:** el login funciona; `backup.yml` lanzado a mano termina en verde; `keepalive.yml` lanzado a mano termina en verde; sin red, el login dice «No pudimos conectar con el servidor…».

**Resultado (2026-11-17):** proyecto `ACTIVE_HEALTHY`; despliegue con Node 22 en verde; `keepalive` y `backup` lanzados a mano en verde (primer respaldo correcto desde el 2026-10-04).

## C1 · Campos del sistema como columnas (cierra C2-base, M2, E1, E2, S11)

**Migración `020_campos_sistema.sql`:**
1. `pg_trgm` en el esquema `extensions`.
2. Columnas en `products`: `nombre text`, `marca text`, `precio`, `precio_compra`, `precio_mayorista`, `stock`, `unidades_por_paquete` (`numeric` sin precisión fija: `data` es texto libre y un valor raro no debe romper un guardado; al escribir a `data` se usa `trim_scale`), `codigo_barras text`, `codigo_norm text` (= `upper(btrim(codigo_barras))`, para buscar por código), `search text` (nombre, marca, descripción, etiqueta leída y código en minúsculas).
3. Relleno desde `data` con los alias de siempre (`jkey`/`safe_num`) con los disparadores apagados (no toca `updated_at`).
4. Disparador `products_sync_fields` (BEFORE INSERT OR UPDATE) descrito arriba; se elimina `products_stock_guard_trg`.
5. Índices: `(business_id, status) where deleted_at is null`, `(business_id, codigo_norm) where codigo_norm is not null`, GIN trigram sobre `search`.
6. `product_summaries` lee las columnas (mismas columnas y orden; el costo sigue oculto al vendedor).
7. Variantes: el código de barras pasa a ser único **por negocio** (`unique (business_id, codigo_barras)`).

**Código:** `app/api/barcode/route.ts` busca por `codigo_norm` (una fila, no todo el inventario); `types/database.ts` con las columnas nuevas; `scripts/test-variants.mjs` crea sus filas con el negocio del usuario temporal; prueba nueva `scripts/test-fields.mjs`.

**Verificación de la migración:** para cada producto, columna = valor leído de `data` (0 diferencias); suma de stock igual antes y después; `product_summaries` devuelve las mismas filas.

**Acepta cuando:** `test:fields` y `test:variants` en verde; escanear un código encuentra el producto con una sola consulta; la búsqueda sigue funcionando.

**Resultado (2026-11-17):** aplicada en producción (55 productos, 2 negocios). Huella de `product_summaries` idéntica antes y después (`md5` de todas las filas, también la búsqueda), stock total 348 = 348, `updated_at` sin tocar. `test:fields` 19/19, `test:variants` 10/10, `test:team` y `test:import` en verde.

**Pendiente heredado a C2:** los 12 sitios que escriben stock por `data` siguen funcionando gracias al disparador, pero conservan la carrera «leer → escribir»; C2 los reemplaza por funciones atómicas que escriben la columna. `/api/barcode` busca por el primer código con valor (`codigo_barras` › `codigo` › `sku` › `barcode` › `ean`), igual que etiquetas y conteo; un producto con dos códigos distintos en dos claves solo se encuentra por el primero.

## C2 · Operaciones atómicas (cierra C1, C3, C4, C5, N4, N7, M1)

**Migración `021_operaciones.sql`** (todas `security definer`, con `set search_path = public`, comprobando que quien llama es miembro activo de `current_business_id()` y que cada producto/variante pertenece a ese negocio):

| Función | Reemplaza a | Notas |
|---|---|---|
| `next_number(bid, kind)` sobre `business_counters(business_id, kind, value)` | `sales_number()` con `max+1` | `update … returning`; `unique (business_id, number)` en `sales` |
| `adjust_stock(p_id, p_product, p_variant, p_delta, p_tipo, p_motivo, p_precio, p_at)` | `StockAdjust`, `lib/offline.syncMoves`, `scan` (+N), `review` (sumar al existente) | `stock_movements.client_id uuid unique` para idempotencia; `p_at` conserva la hora real del movimiento sin conexión |
| `register_sale(p_id, p_lines, p_method, p_status, p_paid, p_discount, p_customer, p_note)` | `lib/sales.registerSale` | costo vigente leído en el servidor; número por contador; stock por `update … set stock = stock - qty`; `faltante` si no alcanzaba |
| `register_purchase(p_id, p_supplier, p_doc, p_note, p_lines)` | `purchases/page.tsx` | actualiza costo, `price_history`, vencimiento |
| `consign_out(p_id, p_customer, p_lines)` / `consign_settle(p_consignment, p_rows, p_pay, p_method)` | `consign/page.tsx` | la liquidación crea la venta **sin** volver a mover stock (corrige el doble conteo) |
| `apply_count(p_count, p_rows)` | `count/page.tsx` | ajuste por diferencia, motivo y acta en una transacción |
| `set_prices(p_rows, p_source)` | `prices/page.tsx`, `ProductDetailClient` (precios) | escribe `price_history` |

`stock_movements` gana `client_id uuid unique` y `faltante integer not null default 0`.

**Código:** `lib/data/ops.ts` (un solo módulo: una función tipada por `rpc`, `newOpId()` para la idempotencia y `withoutStock()` para guardar formularios sin pisar el stock). Se eliminan los 12 sitios con «leer → escribir»: `lib/sales.ts`, `lib/offline.ts`, `consign`, `count` (2), `prices`, `purchases`, `review`, `scan` (2), `labels` (código interno: pasa a `set_product_code`). La cola sin conexión pasa a llamar `adjust_stock` con el mismo `id` (reintento seguro) y marca como `fallido` tras 5 rechazos del servidor (visible en la barra sin conexión, con «Descartar»).

**Prueba `scripts/test-ops.mjs`:** 10 ventas simultáneas de 1 unidad sobre stock 10 → stock 0 y números 1…10 sin repetir; la misma venta enviada dos veces → una sola; venta de un vendedor → `cost_total` correcto; vender 5 con stock 3 → stock 0 y `faltante = 2`; entrega 20 → liquidación 15 vendidas / 5 devueltas → stock y movimientos sin doble salida.

**Resultado (2026-11-17):** `021_operaciones.sql` aplicada (huella del inventario idéntica antes y después). `npm run test:ops` 30/30 (10 ventas simultáneas → stock 0 y números 1…10; venta repetida no se duplica; faltante; variantes; costo correcto cuando vende el vendedor; otro negocio y sin sesión rechazados; ajustes y conteo idempotentes; compra con historial automático; formulario sin stock no lo pisa; consignación sin doble salida y sin rendir de más). `test:fields`, `test:variants`, `test:team`, `test:import` en verde. `test:e2e` contra producción tras el despliegue: 56/58; las 2 fallas son «Pregúntale» (`/api/ask`), que recibió un **524 de Gemini** (tiempo de espera agotado del lado de Google), ruta no tocada en C2. Pendiente: repetir `test:e2e` y, si el 524 se repite, poner tiempo máximo y mensaje claro en `/api/ask` (se resuelve en B7 con consultas acotadas).

**Además de lo previsto:**
- El **historial de precios** lo escribe un disparador (`products_price_history`) con el origen en `app.price_source` (`ficha` por defecto, `masivo`, `compra`): ya no depende de que la pantalla lo anote. Los cambios de precio de variantes no se registran (igual que antes, salvo el costo por compra, que queda a nivel de producto).
- El disparador de C1 ahora **conserva la columna si la clave no viene en `data`**: la ficha, la tabla y la importación guardan `data` sin el stock (`withoutStock`) y, si la persona cambió el stock, se registra con `set_stock` (ajuste con movimiento). Antes, guardar la ficha podía pisar una venta hecha mientras se editaba.
- Una **venta rápida sin conexión** se envía como venta real (`register_sale` con su hora original), no solo como movimiento. Los cambios sin conexión rechazados 5 veces quedan como fallidos y se pueden ver y descartar desde la barra.
- Mensajes de las funciones SQL (código `P0001`) llegan tal cual a la persona por `friendlyError`.

**Fuera de alcance de C2 (siguen escribiendo `data` directamente, sin carrera de stock):** creación de productos (alta, Revisar al confirmar un pendiente, importación de filas nuevas, `/api/barcode` POST), variantes de un pendiente en Revisar.

## C3 · El dinero como pagos (cierra N1, N2, N6, C6)

**Migración `022_pagos.sql`:**
- `payments` gana `sale_id uuid null`, `kind text check (kind in ('venta','abono'))`, `client_id uuid unique`; `customer_id` pasa a opcional (venta pagada sin cliente).
- `payment_allocations(payment_id, sale_id, amount)`: cómo se repartió cada abono entre ventas (FIFO). `sales.paid` y `sales.status` se recalculan por disparador desde los pagos de la venta + asignaciones.
- **Relleno:** por cliente, se re-simulan los abonos existentes en orden FIFO para separar el pago inicial de cada venta (`sales.paid` actual − lo asignado por abonos) y se crea su pago `kind = 'venta'` con la fecha de la venta. Verificación: saldo por cliente y `paid` por venta iguales antes y después.
- Vista `customer_balances` (ventas − pagos; negativo = a favor).
- `register_sale` acepta `p_payments jsonb` (`[{method, amount}]`) → pago mixto real; `register_payment(p_id, p_customer, p_amount, p_method, p_note)` atómico.
- `cash_summary(p_day)` (pagos del día por medio + ingresos/retiros) y `close_cash(p_day, p_counted, p_note)` que guarda una fila nueva por cierre (historial; ya no `upsert`).

**Código:** caja (`cash/page.tsx`) lee `cash_summary`; clientes y Vender leen `customer_balances`; hoja de cobro con «varios medios».

**Acepta cuando:** un abono en QR de una venta de la semana pasada aparece en la caja de hoy como QR y el cierre de ayer no cambia; venta de Bs 100 con 60 efectivo + 40 QR cuadra en la caja; un sobrepago queda como saldo a favor.

**Resultado (2026-11-17/18):** `022_pagos.sql` aplicada; relleno verificado (las 3 ventas conservan exactamente su estado y lo cobrado; deuda total 325 = saldo de clientes 325; 2 pagos «venta» reconstruidos, 0 abonos previos). `npm run test:ops` 44/44 (14 nuevas de C3: pago mixto 60+40 en la caja por medio, pago incompleto sin cliente y cobro mayor al total rechazados, abono de 25 sobre deuda de 18 → 7 a favor y entra hoy como QR, abono repetido no se duplica, saldo a favor usado en la siguiente venta fiada, cierres en historial e idempotentes, un cierre no cambia con cobros posteriores, el vendedor no recibe la ganancia). `test:fields`, `test:variants`, `test:team`, `test:import` en verde.

**Detalles de implementación:**
- `sales.status` se deduce siempre de lo cobrado (`pagado` / `parcial` / `fiado`), también al vender: con «Varios medios» la pantalla no pregunta «¿paga todo?», lo calcula igual que el servidor.
- La zona horaria de la caja es `America/La_Paz` fija en `lib/data/ops.ts` (`BUSINESS_TZ`) hasta C4, que la pasa a ajuste del negocio.
- La lista de ingresos/retiros de la caja aún filtra «hoy» con la hora del celular (solo para mostrarla; los totales vienen del servidor). Se unifica en C4.
- `test:e2e` contra producción tras el despliegue: dos corridas, 57/58 cada una; en cada corrida falló una ruta de IA distinta por **524 (tiempo de espera agotado) de Gemini**: «Pregúntale» (`/api/ask`) y «Foto de estante» (`/api/detect`). Toda comprobación pasó al menos una vez. La comprobación del cierre de caja se actualizó al modelo de historial.
- **Pendiente detectado (IA):** las rutas de IA no tienen tiempo máximo propio ni pasan al siguiente modelo ante un 524/timeout; se cubre en B9 (`lib/ai` con respaldo) y A5 (monitoreo). Mientras tanto, si se repite en el uso real, adelantar: `AbortController` de 25 s por intento en `lib/gemini` y tratar 5xx/timeout como «probar el siguiente modelo».
- Entre la aplicación de `022` y el despliegue del código, «Cerrar caja» de la versión anterior fallaba (usaba `upsert` sobre el índice único por día, que se quitó). Lección: desplegar el código **antes o junto** con una migración que cambia restricciones usadas por la pantalla.

## C4 · Ajustes del negocio y zona horaria (cierra N3, N5, E4, V6)

**Migración `023_ajustes_negocio.sql`:** `businesses` gana `timezone text default 'America/La_Paz'`, `currency text default 'Bs'`, `min_stock_default`, `expiry_days`; se copian del perfil del dueño (`profiles.business_name` → `businesses.name` si el negocio se llama «Mi negocio»). `business_day(ts)` = fecha en la zona del negocio. `session_context()` devuelve en una llamada: negocio, mi rol, miembros, ajustes, conteos de pendientes/inventario.

**Código:** `FlowProvider` usa `session_context()` al abrir y tras cambios (no en cada ruta); se reemplazan las lecturas de `profiles.business_name` (`sell`, `dashboard`, `digest`, `customers/detail`, `settings`, `api/ask`, `api/setup`, `PresetPicker`); `fmtMoney(n)` usa la moneda del negocio; cortes de día de caja y reportes en SQL con `business_day`.

**Acepta cuando:** el vendedor ve el nombre real del negocio en el ticket; una venta a las 21:00 (hora de Bolivia) cae en el día correcto; navegar entre pantallas no repite las 7 consultas.

**Resultado (2026-11-18):** `023_ajustes_negocio.sql` aplicada (solo agrega: la versión publicada siguió funcionando). Los 2 negocios quedaron con zona `America/La_Paz` y moneda «Bs»; «Importadora Rios» ya tenía su nombre; el otro sigue «Mi negocio» porque su perfil no tenía nombre. `npm run test:ops` 50/50 (6 nuevas de C4: el vendedor recibe nombre y moneda del negocio y su rol; `session_context` trae equipo y conteos; el vendedor no puede cambiar el negocio; zona inválida rechazada; una venta a las 21:30 de Bolivia cae en su día en la caja y en otro si el negocio está en España). `test:fields`, `test:variants`, `test:team`, `test:import`, `test:backup` en verde. `test:e2e` contra producción tras el despliegue: **58/58** (incluye onboarding con nombre del negocio, «Pregúntale» y foto de estante: esta vez sin 524 de Gemini).

**Cómo quedó (y diferencias con lo previsto):**
- `lib/dates.ts`: «hoy», «hace N días» y «este mes» en la zona del negocio (`businessDayStart`, `businessMonthStart`, `businessDayKey`), usado en caja, inicio, resumen, movimientos, reportes, clientes, filtro «hoy» del inventario y nombres de archivos. **Los reportes siguen calculándose en el navegador** (con la zona correcta); pasarlos a SQL queda en E3 (C7 · Números). **Hecho en C7.7 (027):** `today_summary()`, `insights_report()`, `restock_lines()`.
- `money(n)` / `currencyLabel()` en `lib/inventory.ts`: 144 importes y 10 etiquetas dejaron de tener «Bs» escrito a mano.
- `FlowProvider` sigue refrescando al cambiar de pantalla, pero con **1 llamada** (`session_context`) en lugar de ~7.
- `profiles.business_name`, `profiles.min_stock_default` y `profiles.expiry_days` quedan en la tabla sin uso (no se borran; se pueden quitar en C6 con el registro de migraciones).
- Ajustes: el dueño edita nombre, moneda y zona horaria; el vendedor los ve sin poder cambiarlos (RLS ya lo impedía; ver test).

## C5 · Permisos en la base (cierra S1–S10, S12; adelanta la Fase 7)

**División (2026-11-18):** por tamaño y riesgo, C5 se publica en tres pasos, cada uno con su migración y su prueba: **C5.1** permisos por rol y operación, negocio activo, firma, guardas, rutas API e interfaz (`024`); **C5.2** costos y ganancia en tablas solo del dueño (`025_costos.sql`); **C5.3** fotos privadas con enlaces firmados (`026_fotos_privadas.sql`). La numeración de migraciones de abajo se corre en consecuencia.

**Migración `024_permisos.sql`:**
- `is_owner(bid)`; políticas separadas por operación en lugar de `for all`:
  - catálogo (`categories`, `field_templates`, `variant_axes`, `suppliers`, `purchases*`): lectura miembros (proveedores/compras solo dueño), escritura dueño.
  - `products`/`product_variants`: lectura e inserción/edición miembros; borrar y mandar a la papelera solo dueño (disparador sobre `deleted_at`).
  - `sales`, `sale_items`, `payments`, `stock_movements`, `consignment*`, `cash_closings`, `stock_count*`: sin `insert/update/delete` directos (solo por las funciones de C2/C3); anulación (A8) solo dueño.
  - `customers`: miembros crean/editan; borrar solo dueño.
- **Costos:** tabla `product_costs(business_id, product_id, variant_id, precio_compra)` y `sale_item_costs(sale_item_id, unit_cost)`, solo dueño; el disparador de C1 saca `precio_compra/costo` de `data` hacia `product_costs`; `cash_closings.profit` y `sales.cost_total` pasan a vistas del dueño; `price_history` del costo solo dueño; bucket `backups` solo dueño.
- **Negocio activo:** lectura y escritura limitadas a `current_business_id()`; `switch_business(bid)` + selector en Ajustes si hay más de uno.
- **Firma:** `user_id` lo fija un disparador (actor válido o `auth.uid()`) e inmutable en `update`; `verify_pin` devuelve un token firmado (HMAC con secreto en tabla privada, 12 h) que viaja en `x-actor-token`; `set_actor` solo acepta tokens válidos.
- `businesses`: el dueño solo cambia `name` y ajustes (disparador rechaza `plan`, `plan_until`, `owner_id`); no se puede quitar al último dueño.

**Rutas API:** `lib/access.ts` con `requireMember()` / `requireRole('dueno')` (negocio activo); `/api/cleanup` exige dueño, trabaja solo el negocio activo y la purga de la papelera pasa al cron de respaldos; `/api/usage POST` solo con clave propia y filtrando `user_id`; consumo de IA contado por petición (sin arreglo global).

**Interfaz:** `FlowProvider` con `ready`; rol por defecto `vendedor` hasta saberlo; `OwnerOnly` espera; «Volver a mi cuenta» pide PIN; cerrar sesión borra IndexedDB (`inventaria-offline` y cola de fotos) y el actor; caché con clave por negocio.

**`025_fotos_privadas.sql` (A3/S12):** bucket `product-images` privado; `lib/photos.ts` firma URLs por lote (1 h) y las guarda en memoria; `Photo` las usa.

**Prueba `scripts/test-access.mjs`:** con la clave anónima, un vendedor no lee `precio_compra`/`unit_cost`/ganancia, no borra productos ni ventas, no cambia `user_id`, no cambia el plan; un usuario en dos negocios solo ve el activo; `x-actor` sin token se ignora.

**Resultado C5.1 (2026-11-18):** `024_permisos.sql` aplicada antes de publicar el código (compatible: la versión publicada ya no escribía stock ni ventas directo; durante el despliegue el celular compartido firmó como la cuenta de la sesión). `npm run test:access` 24/24 contra la base: lectura del negocio activo y no de otro; sin sesión nada; proveedores y compras solo dueño; el vendedor no borra ni manda a la papelera confirmados pero sí descarta pendientes; **nadie** cambia el stock de un confirmado sin operación (ni el dueño); firma y negocio de una fila inmutables y puestos por la base; ventas/cobros/movimientos sin escritura directa; compras y precios en lote solo dueño; catálogo: el vendedor crea categorías pero no las cambia ni borra; clientes: no los quita; nadie cambia el plan; el único dueño no se quita el rol; negocio activo con dos negocios y `switch_business`; respaldos solo dueño. `test:team` ampliado a 22 (token de turno: firma, permisos de vendedor en el celular del dueño, uuid suelto y token alterado ignorados). `test:ops`, `test:fields`, `test:variants`, `test:import`, `test:backup` en verde. Tras el despliegue: `BASE_URL=… npm run test:access` **27/27** (incluye /api/cleanup y /api/usage: 403 al vendedor, 200 al dueño); `test:e2e` 57/58: falló «posible duplicado» porque los modelos principales de IA ya estaban agotados por las corridas del día y el modelo ligero de respaldo nombró distinto la misma foto (la detección compara por nombre; no es un tema de permisos). Repetir `test:e2e` mañana con cupo nuevo; si se repite, la detección de duplicados por similitud (E5, `pg_trgm`) lo resuelve.

**Cómo quedó:**
- Rol efectivo = el de quien **atiende**: `start_shift` (PIN) devuelve un token HMAC de 12 h; la app lo manda en `x-actor-token` (Supabase y rutas /api con `actorHeaders()`); `is_owner()` / `acting_role()` lo usan en RLS, funciones y `lib/access.ts`.
- «Volver a mi cuenta» pide el PIN de la cuenta mientras atiende otra persona; para pasar el celular, la cuenta debe tener PIN.
- Interfaz con falla cerrada: `useFlow().ready`; rol `vendedor` hasta saberlo; `OwnerOnly` espera.
- Cerrar sesión borra IndexedDB (inventario, cambios sin conexión, cola de fotos), el turno y el negocio recordado; la caché va por negocio (`bizKey`).
- `/api/cleanup`: solo dueño, solo negocio activo; el GET ya no borra; las fotos «sin producto» se cuentan contra todos los negocios de quien las subió; la purga de 30 días pasó al respaldo semanal (`scripts/backup.mts`).
- `/api/usage` POST: solo con clave propia y solo filas propias. Consumo de IA por petición (`key.usage`), sin arreglo global.
- Selector de negocio en Ajustes (si la persona está en más de uno).
- Pendiente para C5.2: el vendedor todavía puede leer el costo con la clave anónima (en `products.data`, `products.precio_compra`, `product_variants.costo`, `sale_items.unit_cost`, `sales.cost_total`, `cash_closings.profit`, historial de precios del costo y `precio_unitario` de las entradas por compra). Las rutas API de IA siguen validando solo la sesión (RLS hace el resto).

**Resultado C5.2 (2026-11-18):** `025_costos.sql` aplicada **justo antes** de publicar (quita columnas que leía la versión anterior; ~3 min sin código acorde). Verificación dentro de la migración: las sumas de costos copiadas coinciden con las originales (si no, se deshacía todo); inventario idéntico. `npm run test:access` **34/34** con API (10 nuevas: el dueño fija el costo desde el formulario y el del vendedor se descarta; `data` sin costo; producto, vista, ventas, líneas, historial del costo, tablas de costos y cierres: el vendedor no recibe el costo/ganancia; las entradas por compra ya no muestran el costo en Movimientos). `test:ops` 50/50 (lee los costos de las tablas nuevas; la respuesta de la venta ya no trae el costo), `test:team`, `test:fields`, `test:variants`, `test:import`, `test:backup` en verde; `test:e2e` 58/58.

**Cómo quedó:**
- Tablas solo del dueño: `product_costs` (producto y variante), `sale_costs`, `sale_item_costs`, `cash_closing_profits`. Sin escritura directa: las llenan las funciones y disparadores.
- Se quitaron `products.precio_compra`, `product_variants.costo`, `sales.cost_total`, `sale_items.unit_cost`, `cash_closings.profit` y el costo de `products.data`; `stock_movements.precio_unitario` de las entradas por compra quedó vacío (el costo sigue en `purchase_items`, solo dueño).
- Vistas con los mismos nombres de columna: `product_summaries.precio_compra`, `sales_v.cost_total`, `sale_items_v.unit_cost`, `cash_closings_v.profit` (al vendedor le llegan vacías). Inicio, Resumen, Movimientos, Reportes, Caja, «Pregúntale» y el respaldo las usan.
- Formularios del dueño (ficha, tabla, Revisar, categoría, exportar): `withCosts()` (`lib/data/costs.ts`) vuelve a poner el costo en `data.precio_compra`; al guardar, el disparador `products_cost_out/save` lo pasa a `product_costs`. El historial del costo se escribe desde `product_costs`.
- Pendiente menor: el costo por variante solo se fija con compras (no hay campo en la ficha de la variante, igual que antes).

**Resultado C5.3 (2026-11-18):** orden inverso a C5.2: primero se publicó el código (enlaces firmados, funciona también con el bucket público) y después se aplicó `026_fotos_privadas.sql`. `npm run test:access` **35/35** contra producción (sin enlace firmado la foto da 400; el equipo la ve con enlace; otro negocio no obtiene enlace). Las 27 fotos existentes quedan visibles para su negocio (la carpeta de cada una es de un miembro del negocio del producto).

**Cómo quedó:** `lib/photos.ts` convierte `image_url` (dirección de siempre) en un enlace firmado de 1 h, juntando las fotos de una lista en una sola petición y guardándolas en memoria; `Photo` y `StoredImg` lo usan. Política `product_images_member_read`: se firman fotos de carpetas de personas del negocio activo. Limitaciones: el Excel exportado trae la dirección de la foto, que fuera de la app ya no abre; sin conexión solo se ven las fotos que el navegador tenga en caché.

## C6 · Calidad continua (cierra M3, M6, M7)

- Proyecto Supabase de pruebas (tokens propios en `.env.local` como `TEST_*`, nunca login global).
- `schema_migrations(name, applied_at)` + `scripts/db-migrate.mjs` (`npm run db:migrate`): aplica en orden los `supabase/0*.sql` que falten.
- `npm run db:types` → `supabase gen types typescript` con el token del proyecto; `types/database.ts` pasa a generado + alias propios en `types/app.ts`.
- `vitest` para reglas puras (`lib/inventory`, `lib/import`, `parseExpiry`, `lib/customers`, `lib/errors`).
- `deploy.yml`: job `test` (unitarias + `test:variants`, `test:fields`, `test:ops`, `test:access` contra el proyecto de pruebas) del que depende el despliegue; `test:e2e` (con IA) una vez al día.

## C7 · Reconstrucción visual y funcional completa (cierra V1–V8, M4, M5 y el pedido del 2026-11-17)

Plan completo, diagnóstico, trazabilidad de las 42 funciones actuales, mapa de pantallas (38 → 16), navegación por rol, redirecciones, sistema visual y pasos C7.1–C7.9: **[RECONSTRUCCION_VISUAL.md](RECONSTRUCCION_VISUAL.md)**.

Regla para C2–C5: las pantallas actuales solo cambian por dentro (pasan a usar `lib/data/*` y las funciones SQL); no se rediseñan, para no hacer el trabajo dos veces. Partir `review`, `scan`, `consign` y `ProductDetailClient` y crear `lib/ai/productAnalysis.ts` (compartido por `analyze` y `reanalyze`) se hace dentro de C7.
