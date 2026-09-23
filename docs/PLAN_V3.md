# Plan v3 — de inventario por foto a herramienta completa de la tienda

Fecha: 15 sep 2026 · Base: Plan v2 (Fases 1–3) en producción · Sin integración con MiPuesto · Estimación total ≈ 15 semanas (1 desarrollador con agente).

Cierra los huecos de la promesa central, hace confiable el stock, agrega ventas y clientes (fiado y entregas, **sin fidelización**), reportes, equipo y datos; y termina con la división en planes con acceso controlado desde el servidor.

## Estado del Plan v2

| Fase v2 | Estado |
|---|---|
| 1 · Inventario visual | Desplegada y validada (CHANGELOG 7.x) |
| 2 · Variantes | Desplegada (CHANGELOG 8.x) |
| 3 · Rediseño secuencial | Desplegada (CHANGELOG 9.x) |
| 4 · Cierre (pruebas e2e, verificación, CHANGELOG) | **Pendiente → pasa a ser la Fase 0 de este plan** |

## Principios que rigen todas las fases

1. **El cliente es opcional.** Ninguna venta obliga a elegir cliente; aparece solo cuando aporta (fiado, entrega, cliente frecuente).
2. **Una acción por pantalla.** Se mantiene el rediseño secuencial: barra de pasos, acción principal fija, vocabulario fijo (Categoría, Subcategoría, Variante, Pendiente, En inventario, Agotado).
3. **El servidor manda.** Rol, plan y permisos se deciden en base de datos (RLS) y en las rutas API. La interfaz solo oculta; nunca protege.
4. **Cada fase se despliega sola.** Migración aplicada, CHANGELOG con «Validar», prueba automática ampliada. Nada queda a medias.

## Calendario

| Fase | Nombre | Tiempo |
|---|---|---|
| 0 | Cierre del Plan v2 y correcciones | 4 días |
| 1 | Cerrar la promesa central | 2 semanas |
| 2 | Control real de stock | 2 semanas |
| 3 | Ventas para decidir | 2 semanas |
| 4 | Clientes: fiado, entregas y reportes | 2 semanas |
| 5 | Información que hoy no existe | 1,5 semanas |
| 6 | Equipo y datos | 2 semanas |
| 7 | División en planes con acceso controlado | 2 semanas |
| 8 | Lanzamiento | 1 semana |

---

## Fase 0 · Cierre del Plan v2 y correcciones (4 días)

Lo que quedó sin culminar de v2 más lo que salga de las pruebas funcionales del usuario.

- ✅ (10.1) Pruebas e2e de variantes y escáner dentro de `npm run test:e2e` (hoy solo `test:variants` a nivel de base de datos): ejes → producto con variantes → `/api/barcode` por código de variante → alta sin IA → movimiento por variante.
- ✅ Verificación de productos existentes (sin variantes → siguen igual; cubierto en e2e) y vista ligera para estantes con cientos de productos.
- ⏳ Correcciones reportadas en las pruebas funcionales del usuario (lista abierta; se anota aquí al recibirla).
- ✅ (10.2) Paginación real del inventario y de la búsqueda (hoy el nivel 1 carga todos los productos con todos sus datos): consultas ligeras (`id, category_id, image_url, created_at, stock, precio, precio_compra, nombre`), búsqueda en servidor con `ilike` sobre nombre/marca/etiqueta y `limit`, lista por categoría con `range` + «Ver más».

**Acepta cuando** `npm run test:e2e` cubre foto → variantes → escáner por variante, la lista de correcciones queda en cero y un inventario de 500 productos abre en menos de 2 s en 3G.

## Fase 1 · Cerrar la promesa central (2 semanas) — desplegada 2026-09-15 (CHANGELOG 11.x)

«Foto → inventario ordenado» tiene que ser rápido, sin duplicados y sin depender del cupo gratuito.

- ✅ (11.3) **Foto de estante → varios productos.** `POST /api/detect`: Gemini devuelve los productos detectados con su recuadro (`{nombre_visible, box:[x0,y0,x1,y1]}`); el cliente recorta cada uno (canvas) y lo encola como foto individual con `lib/queue`. Una petición para detectar + una por producto; el usuario marca cuáles encolar antes de gastar cupo.
- ✅ (11.1) **Duplicados al analizar.** En `/api/analyze` y en Revisar: comparación por código de barras, `nameKey(nombre)` y marca contra el inventario del usuario; `ai_meta.posible_duplicado = {product_id, motivo}`. En Revisar aparece «Ya lo tienes: … → Sumar stock» (suma y borra el pendiente) o «Es otro producto».
- ✅ (11.2) **La IA aprende del usuario.** `buildPrompt` recibe hasta 5 productos confirmados de la misma subcategoría (nombre, marca, 2 campos) como ejemplos de estilo; se eligen por `updated_at` reciente. Sin entrenamiento, sin coste extra relevante.
- ✅ (11.4) **Cupo de IA (BYOK).** Tabla `ai_keys(user_id, provider, key_ciphertext, iv, created_at)`; cifrado AES-GCM con secreto `KEY_ENCRYPTION_SECRET` en Cloudflare; se descifra solo en `lib/gemini` dentro de las rutas de análisis. Ajustes → «Usar mi propia clave de Gemini»; el medidor muestra qué clave se usa.
- ✅ (11.5) **Sin conexión.** Caché del inventario (IndexedDB, misma técnica de `lib/queue`) para consulta; cola de movimientos de stock que se sincroniza al reconectar («último gana», aviso en pantalla). Service worker sigue sin cachear datos de red.

**Acepta cuando** 10 productos de un estante entran con una foto en menos de 2 minutos; el mismo producto fotografiado dos veces no se duplica; con el celular en modo avión se registra una venta y aparece al reconectar; con clave propia el medidor deja de contar contra el cupo del servicio.

## Fase 2 · Control real de stock (2 semanas) — desplegada 2026-09-15 (CHANGELOG 12.x)

Que el número de stock sea creíble y avise antes de que falte.

- ✅ (12.1, 12.11) **Stock mínimo** por producto y por variante (`min_stock`), con valor por defecto por categoría; «por reponer» reemplaza al ≤3 fijo (`LOW_STOCK_MAX`).
- ✅ (12.2) **Lista de reposición** generada sola (producto, variante, faltante, proveedor si existe), compartible por WhatsApp (texto) o Excel.
- ✅ (12.5) **Toma de inventario física:** tablas `stock_counts` / `stock_count_items`; modo «contar» por categoría con escáner o lista, diferencia contra el sistema, ajuste con motivo (`stock_movements.tipo = 'ajuste'`), acta con fecha y quién contó.
- ✅ (12.3) **Vencimientos:** `expires_at` por producto y por lote de compra; alertas a 30 / 7 días en Inicio y filtro «por vencer» en el inventario.
- ✅ (12.4) **Compras:** `suppliers`, `purchases`, `purchase_items` (cantidad, costo unitario, vencimiento); la entrada actualiza `precio_compra` e historial. Lista de proveedores mínima (nombre, teléfono).
- ✅ (12.6, 12.7) **Precios:** cambio masivo por categoría (+10 %, redondeo a 0,50), `price_history`, precio mayorista opcional (`precio_mayorista`); `unidades_por_paquete` funcional (comprar por caja, vender por unidad).
- ✅ (12.8) **Papelera:** `products.deleted_at` (borrado suave, 30 días); las consultas filtran `deleted_at is null`; recuperación y vaciado desde «Ordenar y limpiar».

**Acepta cuando** una categoría de 40 productos se cuenta físicamente en menos de 5 minutos y las diferencias quedan registradas; la lista de reposición sale correcta contra los mínimos; un producto que vence en 7 días aparece en Inicio; un producto borrado se recupera intacto.

## Fase 3 · Ventas para decidir (2 semanas) — desplegada 2026-09-15 (CHANGELOG 13.x)

Registrar la venta como ocurre en el mostrador, sin convertirse en un punto de venta completo.

- ✅ (13.1) **Venta con carrito** (`sales`, `sale_items`): varios productos y variantes en una sola venta (escáner o búsqueda), cantidad, descuento simple, total.
- ✅ (13.1) **Medio de pago** (efectivo, QR, transferencia) y **estado de pago** (pagado, parcial, fiado; el fiado se completa en la Fase 4 con el cliente).
- ✅ (13.3) **Cierre de caja diario** (`cash_closings`): ventas por medio de pago, retiros, diferencia contra lo contado; historial de cierres.
- ✅ (13.1) **Ticket** compartible por WhatsApp o imprimible (texto simple; sin impresora fiscal).
- ✅ (13.2) **Ganancia real:** `sale_items.unit_cost` = precio de compra vigente al vender; los reportes dejan de estimar por stock.
- ✅ (13.5) Los movimientos actuales (+/− Stock) se mantienen como atajo y quedan ligados a la venta (`stock_movements.sale_id`).

Depende de: Fase 2 (costos de compra) para la ganancia real.

**Acepta cuando** una venta de 4 productos se registra en menos de 30 segundos con el escáner; el cierre del día cuadra con la suma de tickets; la ganancia del mes se calcula con costos reales.

## Fase 4 · Clientes: fiado, entregas y reportes (2 semanas) — sin fidelización — desplegada 2026-09-15 (CHANGELOG 14.x)

Saber a quién se vendió qué, cuánto debe y qué mercadería está en manos de terceros.

- ✅ (14.1) **Ficha de cliente** mínima (`customers`: nombre, teléfono WhatsApp, nota, límite de crédito). Se crea desde la propia venta en 5 segundos.
- ✅ (14.2) **Venta con cliente opcional** (`sales.customer_id`) → historial por cliente con productos y variantes («a quién se vendió qué»).
- ✅ (14.2, 14.3) **Fiado con detalle:** la venta queda como deuda con sus líneas («2 Coca 2 L, 1 Ace → Bs 85»); el stock baja al momento. Aviso al superar el límite de crédito.
- ✅ (14.3) **Abonos** (`payments`) contra el saldo del cliente (no contra una venta concreta); saldo vivo y antigüedad (7 / 30 / 60 días).
- ✅ (14.3) **Recordatorio por WhatsApp** con el mensaje armado (saldo + productos) y registro de cuándo se envió.
- ✅ (14.4) **Entregas en consignación** (`consignments`, `consignment_items`): mercadería entregada a un revendedor sigue siendo inventario propio en estado «en manos de X»; el producto muestra *en tienda* y *entregado* (`products.stock_out`); liquidación = vendió N (cobrado o fiado) + devolvió M (vuelve al estante).
- ✅ (14.1) **Reportes de clientes:** mejores clientes del mes, inactivos (30 días sin comprar), deuda total en la calle y por vencer, mercadería entregada por persona y por categoría.
- Privacidad: solo nombre y teléfono; exportable y borrable por el dueño (borrado suave).

Depende de: Fase 3.

**Acepta cuando** «¿cuánto debe Juanito y por qué productos?» se responde en una pantalla; un abono parcial deja el saldo correcto; una entrega de 20 unidades con liquidación 15 vendidas / 5 devueltas deja el stock en tienda y las ventas correctas.

## Fase 5 · Información que hoy no existe (1,5 semanas) — desplegada 2026-09-15 (CHANGELOG 15.x)

- ✅ (15.1) **Reportes:** rotación (qué se vende y qué lleva 60 días sin moverse), margen por categoría y producto, comparativo semana/mes, valor del inventario en el tiempo, por vencer, stock muerto.
- ✅ parcial (15.2: pantalla + WhatsApp; el envío automático pasa a la Fase 8) **Resumen diario** por notificación de la app instalada (Web Push), correo o WhatsApp: ventas del día, agotados, por reponer, por vencer, deudas vencidas.
- ✅ (15.3, con resumen de solo lectura en vez de SQL generado) **«Pregúntale a tu inventario»:** chat con la IA sobre los datos propios; el servidor genera consultas de solo lectura sobre vistas seguras, las valida (lista blanca de tablas/columnas) y responde en lenguaje natural; sin imágenes, bajo costo.

**Acepta cuando** el reporte de rotación y el resumen diario coinciden con los movimientos registrados; 10 preguntas típicas se responden correctamente sin tocar datos.

## Fase 6 · Equipo y datos (2 semanas) — ✅ desplegada 2026-09-15 (CHANGELOG 16.1–16.7)

- ✅ (16.1) **Negocio con varios usuarios:** `businesses`, `business_members(role dueño|vendedor, pin_hash)`; todas las tablas ganan `business_id` con RLS por pertenencia (`is_member(business_id)`). Migración: un negocio por usuario existente, verificación de conteos antes/después, despliegue en horario de baja actividad.
- ✅ (16.2, 16.3) **Roles y PIN:** PIN de 4 dígitos para cambiar de persona en el mismo celular (bloqueo tras 5 intentos); cada venta, ajuste, conteo o abono queda firmado (`created_by`).
- ✅ (16.2) **Invitaciones** por enlace o código; el dueño puede quitar a alguien y ver su actividad.
- ✅ (16.5, 16.6) **Importar Excel** con mapeo de columnas guiado y vista previa; **respaldos automáticos** semanales (Excel completo al bucket privado, Cron de GitHub Actions; el correo se conecta en la Fase 8) y **exportación total** de datos.
- ✅ (16.7) **Etiquetas imprimibles** con código interno (Code 128, que la cámara ya lee; no hizo falta QR) para productos sin código de barras (hoja A4 o rollo).
- Sucursales y traspasos: fuera de este plan; el modelo de negocio los deja preparados.

**Acepta cuando** dos personas trabajan sobre el mismo inventario desde dos celulares y cada movimiento muestra quién lo hizo; el vendedor no ve costos ni ganancia; un Excel de 300 filas se importa sin errores.

## Fase 7 · División en planes con acceso controlado (2 semanas) — seguridad rigurosa

Dividir en planes sin que nadie, con ningún tipo de acceso, pueda usar funciones, rutas API o datos que no le corresponden. Los planes se definen al final, con el sistema completo. Propuesta inicial (ajustable):

- **Gratis:** inventario por foto con cupo, escáner, Excel.
- **Pro:** clave IA del servicio, ventas, clientes, reportes, sin conexión.
- **Negocio:** equipo con roles, respaldos, resumen diario, importación.

Pago por QR con activación manual desde un panel interno; no depende de un proveedor de pagos.

### Modelo de control de acceso

- **Una sola fuente de verdad:** `businesses.plan` + `plan_features(plan, feature)`. Los derechos se calculan en servidor con `has_feature(business_id, feature)` (función SQL `security definer`). El cliente recibe la lista solo para pintar la interfaz.
- **RLS por negocio + rol + plan en cada tabla** nueva y existente: `is_member(business_id)`, `role_of(business_id)` y `has_feature(...)`. Aunque alguien use la clave anónima con un cliente modificado, la base de datos rechaza leer o escribir tablas de funciones que su plan no tiene.
- **Toda ruta API** pasa por `requireMember()` + `requireFeature()` + `requireRole()` (`lib/access.ts`) antes de cualquier lógica; respuestas 403 uniformes (sin revelar si la función existe).
- **Costos, ganancias y deudas** se exponen por vistas filtradas por rol: el vendedor no recibe esas columnas del servidor, no solo «no las ve».
- **Claves:** la clave de IA del servicio nunca sale del servidor; la clave BYOK se guarda cifrada (AES-GCM) y solo se descifra en la ruta de análisis. Service role únicamente en rutas del servidor.
- **Auditoría:** `audit_log(business_id, user_id, action, entity, entity_id, data, ip, created_at)` para altas, bajas, cambios de precio, abonos, cambios de plan y de miembros. Solo lectura para el dueño.
- **Bajada de plan:** los datos de funciones que se pierden quedan en solo lectura (exportables), nunca se borran.
- **Endurecimiento:** validación de entradas con esquema (zod) en todas las rutas, límites de tasa por usuario y por IP (Cloudflare), cabeceras CSP/HSTS, tamaño máximo de archivos, expiración y rotación de sesiones, bloqueo por intentos de PIN.

### Matriz de acceso (se prueba automáticamente: `npm run test:access`)

| Recurso | Gratis · dueño | Pro · dueño | Pro · vendedor | Negocio · vendedor | Otro negocio |
|---|---|---|---|---|---|
| Productos, variantes, stock | sí | sí | sí | sí | no |
| Precio de compra, ganancia | sí | sí | no | no | no |
| Ventas (crear) | no | sí | sí | sí | no |
| Clientes y deudas | no | sí | solo cobrar | solo cobrar | no |
| Reportes | no | sí | no | no | no |
| Miembros, roles, plan | sí | sí | no | no | no |
| Respaldos, importación | no | no | no | no | no |
| Auditoría | sí | sí | no | no | no |

(«Respaldos, importación» son de Negocio · dueño; no aparece en la tabla porque todas sus celdas serían «sí» solo en esa columna.)

La prueba recorre plan × rol × recurso e intenta leer, crear, editar y borrar por API y directamente contra Supabase con la clave anónima; cualquier «sí» inesperado rompe el despliegue.

**Acepta cuando** la prueba de matriz pasa completa; una cuenta Gratis con cliente modificado no puede leer `sales` ni `customers`; un vendedor no recibe costos en ninguna respuesta; la bajada de plan deja los datos legibles y exportables; revisión de seguridad (lista OWASP para apps web/móviles) sin hallazgos altos.

## Fase 8 · Lanzamiento (1 semana)

- Página pública, términos y privacidad, modo demo con datos de ejemplo, centro de ayuda con la guía actual.
- Monitoreo de errores en producción y respaldo programado de la base (Supabase Free no tiene recuperación en el tiempo).
- Moneda y formato configurables; instalación de la app guiada.

---

## Brechas para ofrecerlo como servicio serio (análisis 2026-09-23 · aprobada por el usuario el mismo día)

Estado de partida: Fases 0–6 desplegadas; Fases 7 y 8 sin empezar (en el código no existen `plan_features`, `has_feature`, `lib/access.ts`, `audit_log`, validación zod, límites de tasa ni monitoreo). Se ordena por lo que impide cobrar (A), lo que hace creíble el «con IA» (B) y lo que falta en inventario (C).

### A · Bloqueantes para cobrar (sin esto no es un servicio)

| # | Brecha | Evidencia en el código | Qué implementar |
|---|---|---|---|
| A1 | **Capacidad de IA compartida y gratuita** | Una sola `GEMINI_API_KEY` gratuita: ~20 peticiones/día × ~6 modelos ≈ 120 análisis/día **para todos los clientes juntos**; `exhaustedUntil` vive en memoria del isolate (se pierde y no se comparte) | Clave de pago (nivel 1 de Google) para el plan Pro; `ai_usage.business_id` + cupo mensual por negocio aplicado en servidor antes de llamar a Gemini (`ai_quota(business_id)` en SQL); estado de agotamiento en tabla, no en memoria |
| A2 | **Fase 7 completa** (planes y acceso) | Rutas API validan sesión pero no plan/rol de forma uniforme; sin zod; sin límites de tasa | Lo descrito en Fase 7 + `npm run test:access` dentro de `deploy.yml` |
| A3 | **Fotos públicas** | Bucket `product-images` con `public = true` (`migrations.sql`): cualquiera con la URL ve las fotos | Bucket privado + URLs firmadas (caducidad 1 h) servidas por lote desde la vista de productos |
| A4 | **Infraestructura de capa gratuita** | Supabase Free: pausa tras 7 días sin uso, sin recuperación en el tiempo, 500 MB / 1 GB | Supabase Pro (PITR diario) antes del primer cliente de pago; el respaldo semanal a Excel se queda como segunda red |
| A5 | **Sin observabilidad** | No hay monitoreo de errores ni de disponibilidad | Sentry (o Cloudflare Logpush) en rutas API y cliente; chequeo de disponibilidad externo; alerta cuando `ai_usage.status = error` > 10 % en 1 h |
| A6 | **Pruebas fuera del despliegue** | `deploy.yml` solo corre `tsc` y `lint`; `test:e2e`, `test:team`, `test:import` son manuales | Proyecto Supabase de pruebas + job de CI que corre las pruebas sin IA en cada push; `test:e2e` con IA una vez al día |
| A7 | **Legal y datos** | Sin términos, privacidad ni aviso de que las fotos se envían a Google | Términos, privacidad, consentimiento del envío a IA, borrado de cuenta y negocio completo (hoy solo borrado suave de clientes) |
| A8 | **Anular / devolver ventas** | `012_ventas.sql` no tiene anulación ni devolución | `sales.voided_at`, `sale_returns` que reponen stock, restan caja y quedan firmadas; solo dueño |

### B · Lo que hace creíble el «con IA» (hoy la IA solo da de alta productos y resume)

| # | Función | Cómo | Depende de |
|---|---|---|---|
| B1 | **Medir la calidad de la IA** | Guardar la propuesta original (`ai_meta.original`) y comparar al confirmar → tasa de corrección por campo, categoría y modelo; set de 50–100 fotos etiquetadas en `scripts/fixtures` y `npm run ai:eval` que falla si la precisión baja | — |
| B2 | **Confianza por campo** | El esquema pide `{valor, confianza}`; Revisar resalta en ámbar solo lo dudoso («revisa esto») para confirmar más rápido | B1 |
| B3 | **Reposición inteligente** | Velocidad de venta (28 días, ponderada) + días de entrega del proveedor → «se agota en N días» y cantidad sugerida en `/restock`; el mínimo fijo pasa a ser respaldo. Cálculo en SQL, sin IA; la IA solo explica | Ventas con historial |
| B4 | **Factura del proveedor por foto** | `POST /api/invoice`: foto de la nota de compra → líneas (producto emparejado, cantidad, costo, vencimiento) → borrador de compra en `/purchases` para confirmar | — |
| B5 | **Contar por foto** | Extender `/api/detect` para devolver cantidad por producto en un estante y proponerla en `/count` (el usuario confirma) | — |
| B6 | **Alertas de faltantes y anomalías** | Reglas en SQL (diferencias de conteo repetidas por categoría o persona, ventas bajo costo, descuadres de caja por quién atendió, ajustes sin motivo); la IA redacta el aviso en el resumen diario | Fase 6 (firma) |
| B7 | **«Pregúntale» escalable** | Hoy arma un resumen de ≤400 productos y 90 días: con inventarios grandes responde con datos incompletos. Pasar a llamadas a herramientas (funciones SQL de solo lectura con parámetros: ventas por rango, producto, cliente) | A2 |
| B8 | **Resumen diario automático** (ya en Fase 8) | Web Push + correo programado, con B3 y B6 dentro | B3, B6 |
| B9 | **Independencia del proveedor** | `lib/gemini` detrás de una interfaz `lib/ai` con un segundo proveedor de respaldo, para no depender del cupo ni de caídas de uno solo | A1 |

### C · Inventario que un cliente serio va a pedir

- **Costo promedio ponderado** en compras (hoy la entrada reemplaza `precio_compra` por el último costo → la ganancia real se distorsiona cuando el costo sube o baja).
- **Unidad de medida y granel** (kg, litro, metro) con cantidades decimales en stock y venta.
- **Lotes con salida por vencimiento (FEFO)**: el vencimiento por lote de compra existe, pero la venta no descuenta del lote que vence primero.
- **Sucursales y traspasos** (el modelo por negocio ya lo permite; hoy está fuera del plan).
- **Facturación fiscal**: decisión comercial. Si el mercado objetivo la exige, integrarse con el sistema de facturación del país como módulo aparte; si no, se deja explícito que el ticket no es factura.
- **Integraciones**: API con claves por negocio y webhooks (stock y venta), para tienda en línea o contabilidad.

### Orden propuesto

1. **Fase 7** + A3, A6, A8 (seguridad y acceso, en CI).
2. **Fase 8** + A1, A4, A5, A7 (se puede cobrar).
3. **Fase 9 · IA medible:** B1, B2, B9.
4. **Fase 10 · IA que decide:** B3, B4, B6, B8.
5. **Fase 11 · Inventario avanzado:** costo promedio, unidades/granel, FEFO, B5, B7.
6. Después: sucursales, API/webhooks, facturación según el mercado.

### B10 · Jev (TypeSafe AI) como modelo de decisiones — análisis 2026-09-23

**Qué es.** Modelo de TypeSafe AI (San Francisco), en acceso anticipado desde el 15-16 sep 2026 (`jev-1.13.0`). No genera texto: recibe un **estado** (texto o JSON) y **preguntas tipadas**, y devuelve el valor con probabilidades y confianza calibrada. Tres tipos: `Choice` (una opción de hasta 255, con probabilidad por opción), `Score` (2–10 niveles ordenados) y `Noul` (sí/no, 0–1). API `POST https://api.typesafe.ai/v1/systemone` (SDK `@typesafe-ai/sdk` pide Node 20; en el edge de Cloudflare se llama con `fetch`). Latencia 70–500 ms; contexto 64k tokens; límites 1.200 peticiones/min.

**Lo que NO puede hacer (y por eso no reemplaza a Gemini):** no lee imágenes (solo texto), no redacta respuestas, no extrae valores de texto libre, no cuenta, no hace cálculos ni fechas. Quedan en Gemini: análisis de foto, detección en estante, factura por foto (B4), contar por foto (B5), redactar «Pregúntale» y el resumen diario. La reposición (B3) es cálculo en SQL.

**Dónde sí aporta en InventarIA** (el texto de entrada ya existe tras el análisis de la foto o en la planilla):

| Uso | Hoy | Con Jev | Pregunta |
|---|---|---|---|
| J1 · Subcategoría automática (`/api/classify`) | Coincidencia de palabras y, si falla, una llamada de texto a Gemini (`pickSubcategory`) que gasta el cupo gratuito | Sustituye la llamada a Gemini; con confianza ≥ 0,85 asigna sola, por debajo muestra las 2 opciones más probables en Revisar | `Choice` sobre las subcategorías (estado: nombre, marca, descripción, etiqueta leída) |
| J2 · Duplicados (11.1) | `nameKey` + marca + código: exacto, no detecta «Coca Cola 2L» vs «Coca-Cola 2 litros» | El código filtra 5 candidatos por texto; Jev decide si alguno es el mismo producto | `Noul` por candidato (≥ 0,8 → «Ya lo tienes») |
| J3 · Mapeo al importar Excel (16.5) | Sinónimos fijos (`guessTarget`) → columnas desconocidas quedan en «otro» | Para las columnas en «otro»: encabezado + 5 valores de ejemplo → destino propuesto (el usuario sigue confirmando en la vista previa) | `Choice` sobre los destinos del mapeo |
| J4 · Categoría del catálogo público (`/api/barcode`) | `suggestCategory` por palabras | `Choice` sobre las categorías del negocio con los datos del catálogo | `Choice` |
| J5 · Enrutar «Pregúntale» (B7) | — | Elige qué consulta de solo lectura ejecutar antes de que Gemini redacte | `Choice` sobre las funciones SQL |
| J6 · Motivo de ajustes y avisos (B6) | Texto libre | Clasifica el motivo (vencido, dañado, error de conteo, faltante sin explicar) y la gravedad del aviso | `Choice` + `Score` |

**Costos.** Entrada 0,042 US$ por millón de tokens; salida gratis; 5 US$ de crédito al registrarse (≈ 119 M tokens). Estimación por decisión: J1 ≈ 800 tokens (≈ 0,00003 US$), J2 ≈ 300 por candidato, J3 ≈ 6.000 por planilla de 30 columnas (≈ 0,00025 US$). Escenario 100 negocios × 1.500 decisiones/mes × 800 tokens = 120 M tokens ≈ **5 US$/mes**; el crédito inicial cubre el piloto completo. Con entradas tan cortas la diferencia de precio frente a un Gemini de pago es pequeña: **el valor real es sacar decisiones del cupo de Gemini (A1), responder en < 0,5 s y tener confianza calibrada** para decidir cuándo preguntar al usuario (B2).

**Riesgos.**
- Producto de una semana en acceso anticipado: lista de espera, sin SLA, y precio y límites que pueden cambiar al salir del acceso anticipado.
- El español funciona pero con menor precisión que el inglés, y no hay evaluación publicada.
- Es sensible a texto manipulado (inyección): los datos vienen del propio negocio, pero una planilla o un catálogo externo pueden traer texto hostil. Jev solo propone y nunca decide solo nada irreversible.
- Los datos salen a un tercero en EE. UU.: debe figurar en la política de privacidad (A7).

**Cómo se integra (si se aprueba), dentro de la Fase 9 junto a B1:**
1. `lib/ai/decide.ts`: `decideChoice(state, options, instructions)` y `decideYesNo(...)` con `fetch` a la API, versión fija `jev-1.13.0`, tiempo máximo 2 s y **respaldo automático al camino actual** (palabras o Gemini) si falla, se agota o no hay clave. Secreto `TYPESAFE_API_KEY` solo en Cloudflare.
2. Registro por llamada en `ai_usage` (`purpose = decide:<uso>`, `model`, `confidence`, tokens) para medir costo y acierto.
3. Prueba de aceptación antes de activarlo: `npm run ai:eval:decide` con 100 casos reales en español por uso (J1–J3); se activa por uso solo si acierta ≥ al camino actual y la confianza está calibrada (acierto ≥ 90 % cuando confianza ≥ 0,85).
4. Orden: J1 → J2 → J3 (los de mayor uso y menor riesgo); J4–J6 después.
5. Interruptor por uso en configuración del servidor para apagarlo sin desplegar.

---

## Modelo de datos nuevo (resumen)

```
businesses(id, name, plan, plan_until, created_at)
business_members(business_id, user_id, role dueño|vendedor, pin_hash, active)
plan_features(plan, feature)                       -- fuente de verdad de derechos
audit_log(id, business_id, user_id, action, entity, entity_id, data, ip, created_at)

suppliers(id, business_id, name, phone, note)
purchases(id, business_id, supplier_id, doc, total, created_by, created_at)
purchase_items(purchase_id, product_id, variant_id, qty, unit_cost, expires_at)
stock_counts(id, business_id, category_id, started_by, closed_at)          -- toma física
stock_count_items(count_id, product_id, variant_id, expected, counted, reason)
price_history(product_id, variant_id, old_price, new_price, changed_by, at)

customers(id, business_id, name, phone, note, credit_limit, deleted_at)
sales(id, business_id, customer_id?, status pagado|parcial|fiado, method, total, cost_total, created_by, created_at)
sale_items(sale_id, product_id, variant_id, qty, unit_price, unit_cost)
payments(id, business_id, customer_id, sale_id?, amount, method, created_by, at)  -- abonos
consignments(id, business_id, customer_id, status abierta|liquidada, created_by, at)
consignment_items(consignment_id, product_id, variant_id, qty_out, qty_sold, qty_returned)
cash_closings(id, business_id, date, totals_by_method, counted, difference, closed_by)

products.min_stock, product_variants.min_stock, products.deleted_at, products.stock_out (en consignación)
ai_keys(user_id, provider, key_ciphertext, iv, created_at)
```

Todas las tablas actuales (`categories`, `products`, `product_variants`, `stock_movements`…) ganan `business_id` en la Fase 6; hasta entonces siguen ancladas a `user_id`.

## Restricciones de despliegue (Cloudflare)

- El Worker no puede superar **25 MiB sin comprimir**. Cada **ruta dinámica** de página cuesta ~1,36 MB (copia del runtime de Next), así que las pantallas de la app se sirven **estáticas** y solo son dinámicas las rutas con parámetro y las de API (2026-09-15: 4,8 MB en total).
- Antes de añadir una pantalla nueva: que sea un componente cliente bajo `(app)` **sin** `export const runtime = "edge"` (si lleva parámetro en la URL, se envuelve en un server component con `runtime = "edge"`, como `/products/[id]`).
- Librerías pesadas (xlsx, heic2any) siempre con `await import(...)` dentro de la función que las usa, nunca en el nivel superior del módulo.
- La autenticación de pantallas la garantiza `middleware.ts` (valida al usuario en cada petición) + RLS; la capa `(app)` no consulta la sesión en el servidor.

## Riesgos y decisiones

| Riesgo | Cómo se maneja |
|---|---|
| Convertir la app en un POS pesado | Ventas y clientes se limitan a lo descrito; sin fidelización, sin facturación fiscal, sin catálogo público. Una acción principal por pantalla. |
| Detección de estante imprecisa | Los recuadros son propuesta: el usuario marca cuáles encolar; nada se crea sin confirmación. |
| Migración a negocio con varios usuarios | Migración única con verificación fila por fila y prueba que compara conteos antes/después; despliegue en horario de baja actividad. |
| Fuga de funciones o datos entre planes | Derechos en RLS y API, nunca en la interfaz; matriz de acceso automatizada que bloquea el despliegue si falla. |
| Datos personales de clientes | Solo nombre y teléfono; borrado suave y exportación por el dueño; sin compartir con terceros. |
| Costo de IA al escalar | BYOK desde la Fase 1; el plan Pro cubre la clave del servicio con cupo por negocio y medidor visible. |

**Decisiones cerradas:** los planes se definen en la Fase 7, con el sistema completo a la vista. Clientes va después de Ventas. Consignación se modela separada del fiado (mercadería propia fuera de la tienda vs. dinero pendiente). No hay fidelización.

## Registro de cambios de este plan

- 2026-09-23 · Análisis de brechas (A1–A8, B1–B9, C) aprobado; se añade B10 (Jev como modelo de decisiones, a evaluar en la Fase 9).
- 2026-09-15 · Fase 6 completa (16.1–16.7): negocio, equipo, roles, PIN, firma, importar Excel, respaldos semanales y etiquetas. El respaldo por correo pasa a la Fase 8 junto con el resumen diario.
- 2026-09-15 · Fase 5 (15.1–15.4) desplegada; el envío automático del resumen diario pasa a la Fase 8.
- 2026-09-15 · Fase 4 (14.1–14.6) desplegada.
- 2026-09-15 · Fase 3 (13.1–13.6) desplegada.
- 2026-09-15 · Fase 2 (12.1–12.10) desplegada + ajustes de las pruebas funcionales (12.11–12.16): avisos configurables, descartar deslizando, cámara del conteo, vencimiento por IA y limpieza de datos que sobran.
- 2026-09-15 · Fase 0 (10.1–10.2) y Fase 1 (11.1–11.6) desplegadas; queda abierta la lista de correcciones de las pruebas funcionales.
- 2026-09-15 · v3.0 · Plan inicial (sustituye a la página externa publicada el mismo día; a partir de ahora toda planificación vive en este archivo).
