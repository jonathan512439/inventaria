# Reconstrucción visual y funcional completa (Fase 6.9 · C7)

Pedido del usuario (2026-11-17): «Hoy todo es confuso de manejar. Cambia toda la estructura visual y el funcionamiento; simplifícalo y déjalo fácil de usar y de entender. Las funciones pueden modificarse, pero el objetivo se mantiene completo.»

Este documento reemplaza al antiguo paso C7 («Interfaz») de `PLAN_CIMIENTOS.md`. Se implementa **después de C2–C5**, de modo que las pantallas nuevas se construyen directamente sobre las funciones atómicas (`lib/data/*`) y los permisos reales. En C2–C5 las pantallas actuales solo cambian por dentro (llamadas a datos), no de aspecto, para no hacer el trabajo dos veces.

---

## 1. Diagnóstico: por qué hoy es confuso

| # | Problema | Evidencia |
|---|---|---|
| D1 | **Demasiados lugares.** 38 pantallas, ~30 entradas en el menú «Más» repartidas en 4 grupos, con nombres-frase largos («Qué falta y qué caduca», «Cómo va el negocio»). | `components/Nav.tsx:35-77`, `app/(app)/*` |
| D2 | **Dos modelos mentales mezclados.** La barra de pasos «① Agregar → ② Revisar → ③ Inventario» (pensada para cargar el inventario) aparece también al vender, en la caja, en clientes y en reportes. | `components/FlowProvider.tsx:37-42` (`stepOf` marca `/sell`, `/cash`, `/customers`, `/reports`… como paso 3) |
| D3 | **Lo diario está escondido.** Vender (lo que se hace 50 veces al día) está dentro de «Más»; la barra inferior está dedicada a cargar productos. | `Nav.tsx:15-18` |
| D4 | **La misma tarea en varios sitios con reglas distintas.** El stock se cambia en 6 lugares (escáner +N, ajuste rápido, compras, conteo, «sumar al existente» en Revisar, tabla); un producto se agrega por 4 caminos (foto, código, a mano, Excel) en 4 pantallas sin un punto de entrada común. | `scan`, `StockAdjust`, `purchases`, `count`, `review`, `ProductTable`, `capture`, `products/new`, `import` |
| D5 | **Configuración del catálogo partida en 3 pantallas** («Mi tienda», Categorías, Datos de mis productos) más el selector de catálogos y el editor de variantes. | `store`, `categories`, `templates`, `PresetPicker`, `AxisEditor` |
| D6 | **La información está dispersa.** Inicio, Reposición, Resumen de hoy, Reportes, Movimientos, Avisos y Caja muestran trozos de lo mismo. | `dashboard`, `restock`, `digest`, `reports`, `movements`, `alerts`, `cash` |
| D7 | **Ruido de ayuda.** 20 consejos (`CoachTip`), una guía de varios pasos y «Novedades» compiten con el contenido. | `components/CoachTip.tsx`, `guide/Guide.tsx`, `WhatsNew.tsx` |
| D8 | **Lectura difícil en celular.** 130 textos de 9–11 px, iconos repetidos (la misma casa para Inicio, Clientes y Equipo), botones de solo icono sin etiqueta. | Auditoría 2 · V2–V4 |
| D9 | **El vendedor ve pantallas «prohibidas».** Entra y le dicen «Esto lo maneja el dueño». | `OwnerOnly.tsx` |

## 2. Principios del diseño nuevo

1. **Cinco lugares, nunca más:** Inicio · Vender · Productos · Clientes · Más. Todo lo demás vive dentro de uno de ellos.
2. **Una pantalla, una acción principal**, siempre en el mismo sitio (botón fijo abajo, `.sticky-action`).
3. **Un producto se encuentra siempre igual:** buscador + botón de escáner en la cabecera (componente único `ProductFinder`), en Vender, Productos, Entrada de mercadería y Contar.
4. **Las acciones sobre productos están donde están los productos:** seleccionar varios en Productos → cambiar precio, imprimir etiquetas, mover de categoría, descargar, borrar.
5. **Lo que pide atención llega solo a Inicio** como una tarea con el botón que la resuelve («3 pendientes por revisar → Revisar»).
6. **Lo ocasional va a Ajustes** (catálogo, equipo, respaldos, Excel, IA).
7. **Todas las pantallas tienen la misma forma:** cabecera (atrás · título · ayuda «?») → búsqueda/filtros → contenido → acción fija.
8. **El rol decide qué se ve, no qué se prohíbe:** el vendedor simplemente no tiene las entradas del dueño.
9. **Palabras simples y fijas:** Categoría, Subcategoría, Variante, Pendiente, En inventario, Agotado; verbos cortos en los botones (Vender, Cobrar, Agregar, Contar, Guardar).

## 3. Arquitectura nueva

### 3.1 Navegación

| Móvil (barra inferior) — dueño | Móvil — vendedor | Escritorio |
|---|---|---|
| Inicio · Productos · **Vender** (botón central grande) · Clientes · Más | Inicio · Productos · **Vender** · Clientes · Caja | Barra lateral con las mismas 5 áreas + subsecciones desplegadas |

«Más» (dueño) = **Números** · **Ajustes** · Ayuda · Cerrar sesión. Ocho entradas en total en vez de ~30.

Mientras el negocio no tiene productos (primer uso), Inicio muestra la **lista de primeros pasos** (Crear tu tienda → Agregar productos → Hacer tu primera venta) y desaparece al completarla. La barra de pasos global se elimina.

### 3.2 Mapa de pantallas (38 → 16)

| Área | Pantalla | Ruta | Contenido |
|---|---|---|---|
| Inicio | Hoy | `/dashboard` | Saludo + botón grande **Vender**; hasta 4 tareas accionables (pendientes por revisar, por reponer, por vencer, fiados vencidos, caja sin cerrar); ventas de hoy (dueño: y ganancia); primeros pasos en el primer uso |
| Vender | Mostrador | `/sell` | `ProductFinder` + recientes + carrito; hoja **Cobrar** (teclado grande, vuelto, varios medios, fiado con cliente) → ticket |
| Vender | Caja | `/sell/cash` | Lo que entró por medio, ingresos/retiros, **Cerrar el día** (efectivo contado → diferencia), historial de cierres |
| Productos | Lista | `/products` | `ProductFinder`; chips: Todas las categorías ▾ · Pendientes · Por reponer · Por vencer · Agotados · Sin precio · Papelera; tarjetas o filas; en escritorio, interruptor **Tabla** (edición en línea); selección múltiple con acciones; botón fijo **Agregar** |
| Productos | Ficha | `/products/[id]` | Pestañas **Datos** (foto, nombre, categoría, campos) · **Stock** (+/−, por variante, mínimo, vencimiento) · **Precios** (venta, compra, mayorista, historial) · **Historial** (movimientos y ventas del producto) |
| Productos | Agregar | `/add` | Cinco maneras en una sola pantalla: **Foto** (una o varias) · **Foto de estante** · **Código de barras** · **A mano** · **Desde Excel**; muestra la cola en curso |
| Productos | Revisar pendientes | `/add/review` | Tarjeta por producto (lo dudoso resaltado), Confirmar y siguiente; «Ya lo tienes → sumar stock» |
| Productos | Entrada de mercadería | `/stock/in` | `ProductFinder` + cantidad; costo, proveedor y vencimiento **opcionales** (plegados) → Guardar entrada |
| Productos | Contar | `/stock/count` | Elegir categoría → contar con escáner o lista → diferencias → Ajustar |
| Clientes | Lista | `/customers` | Buscador; chips Todos · Deben · Sin venir 30 días · Con mercadería entregada; botón fijo **Nuevo cliente** |
| Clientes | Ficha | `/customers/detail` | Saldo grande + **Cobrar abono** + Recordar por WhatsApp; pestañas Compras · Abonos · Mercadería entregada (Entregar / Rendir cuentas) · Datos |
| Más | Números | `/insights` | Pestañas **Hoy** (resumen del día + Enviar por WhatsApp) · **Ventas** (semana/mes, comparativo) · **Productos** (más vendidos, sin movimiento, margen) · **Pregúntale**; enlace a Historial |
| Más | Historial | `/insights/history` | Todas las ventas y movimientos con filtros (tipo, persona, fecha) |
| Más | Ajustes | `/settings` | Secciones: Negocio (nombre, moneda, zona) · Avisos · Equipo · Mis datos · Inteligencia artificial · Mi cuenta (PIN, cerrar sesión) · Ayuda y novedades |
| Más | Mi catálogo | `/settings/catalog` | Árbol único: Categoría → Subcategorías; en cada categoría, sus **Datos** (campos) y **Variantes** (talla, color…); agregar desde catálogos sugeridos |
| Más | Mis datos | `/settings/data` | Descargar Excel · Traer desde Excel · Respaldos · Ordenar y limpiar · Papelera |

Se conservan sin cambios de ubicación: `/login`, `/register`, `/auth/*`, `/join`, `/onboarding` (más corto: nombre del negocio → qué vendes → listo). `/settings/team` sigue como subpantalla de Ajustes.

### 3.3 Redirecciones (los enlaces y accesos guardados siguen funcionando)

`next.config.mjs` → `redirects()` (las procesa el enrutado de Cloudflare Pages, sin función):

| Antes | Ahora |
|---|---|
| `/capture`, `/scan`, `/products/new`, `/import` | `/add` (con `?mode=photo|code|manual|excel`) |
| `/review`, `/drafts` | `/add/review` |
| `/products/c/:id` | `/products?category=:id` |
| `/products/table` | `/products?view=table` |
| `/restock` | `/products?filter=restock` |
| `/trash` | `/products?filter=trash` |
| `/purchases` | `/stock/in` |
| `/count` | `/stock/count` |
| `/prices`, `/labels` | `/products?select=1` |
| `/cash` | `/sell/cash` |
| `/consign` | `/customers?filter=consign` |
| `/movements` | `/insights/history` |
| `/reports`, `/digest`, `/ask` | `/insights` (`?tab=…`) |
| `/store`, `/categories`, `/templates` | `/settings/catalog` |
| `/alerts` | `/settings#avisos` |
| `/team` | `/settings/team` |
| `/export`, `/backup` | `/settings/data` |

## 4. Trazabilidad de funciones (qué pasa con cada una)

Cada función actual conserva su **objetivo**; cambia el lugar, la forma o se une con otra.

| # | Función hoy | Dónde está hoy | Dónde queda | Cambio | Objetivo que se conserva |
|---|---|---|---|---|---|
| F01 | Registro, login, confirmar correo | `(auth)` | igual | mensajes simples (C0) | Entrar con cuenta propia |
| F02 | Asistente inicial | `/onboarding`, `PresetPicker` | `/onboarding` + primeros pasos en Inicio | 3 pantallas → 2; el resto se aprende haciendo | Tienda configurada en 1 minuto |
| F03 | Inicio con resumen, guía, consumo de IA, limpiar | `/dashboard` | Inicio «Hoy» | solo tareas accionables + Vender; consumo de IA y limpiar → Ajustes | Saber qué hacer hoy |
| F04 | Foto → IA → Pendiente (cola en segundo plano) | `/capture` | Agregar › Foto | misma cola; progreso visible en Agregar y como tarea en Inicio | Inventario por foto |
| F05 | Foto de estante → varios productos | `ShelfDetect` en `/capture` | Agregar › Foto de estante | opción propia, no escondida | Cargar 10 productos con una foto |
| F06 | Escanear: repetido suma stock / catálogo público / alta / lote | `/scan` | **dividido por intención**: Agregar › Código (alta, lote, catálogo público); Entrada de mercadería (sumar stock); `ProductFinder` (encontrar) | una pantalla con 3 modos → cada modo donde se usa | Código de barras sin gastar IA |
| F07 | Alta manual | `/products/new` | Agregar › A mano | igual, en el mismo punto de entrada | Registrar sin foto |
| F08 | Revisar pendientes (confirmar, duplicado, variantes propuestas, reanalizar) | `/review` (872 líneas) | Agregar › Revisar | partido en componentes; dudoso resaltado (B2 cuando exista) | Nada entra sin confirmar |
| F09 | Inventario por estantes (nivel 1) | `/products` | Productos › lista con chip de categoría | los totales por categoría pasan a Números › Productos | Ver y encontrar el inventario |
| F10 | Categoría (nivel 2) | `/products/c/[id]` | Productos con filtro de categoría | una sola lista, sin niveles | Ver una categoría |
| F11 | Tabla con edición en línea (escritorio) | `/products/table` | Productos › vista Tabla | interruptor, no pantalla aparte | Edición rápida en escritorio |
| F12 | Ficha de producto | `/products/[id]` | Ficha con 4 pestañas | ordenada por tema | Ver y editar un producto |
| F13 | Ajuste rápido de stock (+/−, sin conexión) | `StockAdjust` | Ficha › Stock y deslizar en la lista | usa `adjust_stock` (C2) | Corregir stock en segundos |
| F14 | Variantes (ejes, cuadrícula) | `AxisEditor`, `VariantGrid`, ficha | ejes en Mi catálogo; stock por variante en Ficha › Stock | igual función, lugar claro | Talla/color con stock propio |
| F15 | Mi tienda, Categorías, Datos de mis productos | `/store`, `/categories`, `/templates` | **Ajustes › Mi catálogo** (un árbol) | 3 pantallas → 1 | Ordenar el inventario a mi manera |
| F16 | Avisos (mínimos y vencimiento) | `/alerts` | Ajustes › Avisos (general y por categoría); mínimo del producto en Ficha › Stock | se reparte donde se decide | Avisar antes de que falte |
| F17 | Lista de reposición (WhatsApp/Excel, descartar) | `/restock` | Productos › filtro **Por reponer** + botón **Lista de pedido** | filtro + acción | Saber qué pedir |
| F18 | Por vencer | pestaña de `/restock` | Productos › filtro **Por vencer** | filtro | No perder mercadería |
| F19 | Compras (proveedor, costo, vencimiento) | `/purchases` | **Entrada de mercadería** | proveedor y costo opcionales; `register_purchase` (C2) | Registrar lo que llegó y su costo |
| F20 | Toma de inventario física | `/count` | Productos › **Contar** | `apply_count` (C2) | Stock creíble |
| F21 | Precios masivos | `/prices` | Productos › seleccionar › **Cambiar precio** | acción sobre selección o filtro | Subir precios en lote |
| F22 | Etiquetas imprimibles | `/labels` | Productos › seleccionar › **Imprimir etiquetas** | acción sobre selección | Etiquetar sin código de fábrica |
| F23 | Papelera | `/trash` | Productos › filtro **Papelera** (+ «Deshacer» inmediato) | filtro | Recuperar lo borrado |
| F24 | Ordenar y limpiar | `CleanupCard` en Inicio | Ajustes › Mis datos › Ordenar | fuera de Inicio | Datos limpios |
| F25 | Descargar Excel | `/export` | Ajustes › Mis datos; también «Descargar» sobre una selección/filtro en Productos | dos accesos naturales | Llevarse los datos |
| F26 | Traer desde Excel | `/import` | Agregar › Desde Excel (y Mis datos) | punto de entrada común | Migrar desde otra planilla |
| F27 | Respaldos | `/backup` | Ajustes › Mis datos | — | Copia de seguridad |
| F28 | Vender (carrito, escáner, recientes, descuento, medio, fiado, ticket) | `/sell` | **Vender** (centro de la barra) | hoja Cobrar con teclado, vuelto y varios medios (C3); `register_sale` (C2) | Venta en < 30 s |
| F29 | Caja del día y cierre | `/cash` | Vender › **Caja** | lee pagos del día (C3); tarea «cerrar caja» en Inicio | Que la caja cuadre |
| F30 | Ventas y movimientos | `/movements` | Números › **Historial** (y Ficha › Historial) | filtros por tipo y persona | Saber qué pasó y quién |
| F31 | Clientes (deben, inactivos, mejores) | `/customers` | Clientes con chips | mejores clientes → Números | A quién se vende y quién debe |
| F32 | Ficha del cliente (saldo, abono, recordatorio) | `/customers/detail` | Clientes › ficha | saldo y **Cobrar abono** arriba | Cobrar fiados |
| F33 | Consignación (entregar, liquidar) | `/consign` | Clientes › ficha › **Mercadería entregada** (+ chip en la lista) | ya no es pantalla suelta; `consign_out/settle` (C2) | Saber qué está en manos de terceros |
| F34 | Reportes (rotación, margen, comparativo, valor) | `/reports` | **Números** › Ventas / Productos | unidos con el resumen | Decidir con datos |
| F35 | Resumen del día por WhatsApp | `/digest` | Números › Hoy › **Enviar por WhatsApp** | una pestaña | Cerrar el día informado |
| F36 | Pregúntale a tu inventario | `/ask` | Números › **Pregúntale** | — | Preguntar en lenguaje normal |
| F37 | Equipo, invitaciones, PIN, ¿quién atiende? | `/team`, `WhoIsServing`, `/join` | Ajustes › Equipo; «quién atiende» como avatar en la cabecera | — | Trabajar en equipo con firma |
| F38 | IA: clave propia y consumo | `AiKeyCard`, `AiUsageCard` | Ajustes › Inteligencia artificial | fuera de Inicio | Controlar el cupo |
| F39 | Nombre del negocio, cerrar sesión | `/settings` | Ajustes › Negocio / Mi cuenta | nombre del **negocio** (C4) | Configurar lo básico |
| F40 | Guía, 20 consejos, Novedades, barra de pasos | `Guide`, `CoachTip`, `WhatsNew`, `StepBar` | Primeros pasos en Inicio + ayuda «?» por pantalla + estados vacíos que enseñan; Novedades en Ajustes | **se eliminan** los 20 consejos y la barra de pasos | Aprender sin manual |
| F41 | Sin conexión (aviso, caché, cola) | `OfflineBar`, `lib/offline` | Indicador único en la cabecera («Sin conexión · 2 por enviar») | — | Seguir trabajando sin red |
| F42 | Avisos en Inicio (agotados, variantes agotadas, sin precio, sin foto) | `dashboard` | Tareas de Inicio + chips de Productos | cada aviso lleva a su filtro | Detectar problemas |

## 5. Sistema visual

**Tokens** (`tailwind.config.ts`, sin tamaños arbitrarios):
- Color: `brand` (acción principal), `ink` (texto), `muted` (texto secundario), `surface`/`canvas` (fondos), semánticos `ok` (verde), `warn` (ámbar), `danger` (rojo), `info` (azul). Contraste AA.
- Tipografía: `xs` 12 · `sm` 14 · `base` 16 · `lg` 18 · `xl` 20 · `2xl` 24 · `3xl` 30. Mínimo 12 px; botones y filas 16 px. Los importes con cifras tabulares.
- Toque: mínimo 44 × 44 px; filas de lista de 56 px; botón principal de 52 px.
- Espaciado en múltiplos de 4; radios `lg` (tarjetas) y `full` (chips, botón central).

**Componentes** (`components/ui/`, uno por patrón; las pantallas solo los componen):
`AppShell` (barra inferior/lateral + cabecera con estado de conexión y quién atiende) · `ScreenHeader` (atrás, título, «?») · `ProductFinder` (buscar + escanear, reutilizado en 4 flujos) · `ChipFilter` · `ListRow` · `ProductCard` · `Tabs` · `Stat` · `EmptyState` (explica y ofrece la acción) · `Sheet` (hoja inferior con alto máximo y desplazamiento propio) · `NumberPad` · `MoneyInput` · `QtyStepper` · `SelectionBar` (acciones sobre varios) · `TaskCard` (tareas de Inicio) · `HelpSheet` · existentes: `Confirm`, `Toast`, `Skeleton`, `Photo`.

**Iconos:** uno propio por destino (nuevos en `Icons.tsx`: carrito, caja registradora, persona, gráfico, engranaje, camión/entrada, portapapeles/contar, etiqueta, impresora, papelera, nube/respaldo). Botones de solo icono siempre con `aria-label`.

**Mensajes:** todos los errores por `friendlyError()`; confirmaciones por `useConfirm()`; éxito con «Deshacer» cuando se pueda.

## 6. Pasos de implementación (cada uno se despliega y documenta por separado)

| Paso | Qué | Depende de | Acepta cuando |
|---|---|---|---|
| C7.1 · Sistema visual y armazón | Tokens, componentes de §5, `AppShell` con la navegación de §3.1 por rol, cabecera con conexión y «quién atiende»; se eliminan `StepBar` y la barra antigua; redirecciones de §3.3 | C5 | Las 5 áreas se alcanzan en 1 toque; ningún texto < 12 px en el armazón |
| C7.2 · Inicio y Vender | Inicio «Hoy» con tareas; Vender con `ProductFinder`, hoja Cobrar (vuelto, varios medios, fiado), ticket; Caja dentro de Vender | C2, C3, C4 | Una venta de 4 productos en < 30 s; desde Inicio a cobrar en 2 toques |
| C7.3 · Productos | Lista única con filtros, selección múltiple (precio, etiquetas, mover, descargar, borrar), vista Tabla en escritorio, ficha con 4 pestañas | C2 | Cualquier producto se encuentra en < 5 s; reponer/vencer/papelera son filtros |
| C7.4 · Agregar y Revisar | Punto de entrada único con 5 maneras; Revisar partido en componentes | C1 | Las 5 maneras de agregar salen de un mismo botón |
| C7.5 · Mercadería | Entrada de mercadería y Contar con `ProductFinder` | C2 | Una entrada de 10 productos con escáner en < 2 min |
| C7.6 · Clientes | Lista con chips, ficha con saldo, abono, recordatorio y mercadería entregada | C2, C3 | «¿Cuánto debe Juanito y por qué?» en una pantalla; entregar y rendir cuentas sin salir de la ficha |
| C7.7 · Números | Hoy / Ventas / Productos / Pregúntale + Historial | C3, C4 | El resumen del día se envía por WhatsApp en 2 toques |
| C7.8 · Ajustes | Secciones de §3.2; Mi catálogo como árbol único; Mis datos | C4, C5 | Categorías, datos y variantes se configuran en una sola pantalla |
| C7.9 · Limpieza y ayuda | Borrar pantallas y componentes viejos, `CoachTip`, `Guide`; primeros pasos y ayuda «?»; `test:e2e` adaptado; prueba con 3 personas (dueño, vendedor, alguien nuevo) | C7.1–C7.8 | Persona nueva hace su primera venta sin ayuda; vendedor no ve nada del dueño |

**Medidas de éxito:** pantallas 38 → 16; entradas de menú ~30 → 8; consejos 20 → 0 (ayuda bajo demanda); toques de Inicio a cobrar: hoy 3–4 → 2; textos < 12 px: 130 → 0.

**Restricciones que se mantienen:** pantallas de `(app)` estáticas (sin `runtime = "edge"`; las de parámetro envueltas como `/products/[id]`); librerías pesadas con `await import()`; menos pantallas = Worker más chico. Prioridad móvil, escritorio funcional.

## 7. Avance y decisiones de implementación

| Paso | Estado | CHANGELOG |
|---|---|---|
| C7.1 · Sistema visual y armazón | ✅ 2026-11-18 | 17.8 |
| C7.2 · Inicio y Vender | ✅ 2026-11-18 | 17.9 |
| C7.3 · Productos | ✅ 2026-11-18 | 17.10 |
| C7.4 · Agregar y Revisar | ✅ 2026-11-18 | 17.11 |
| C7.5 · Mercadería | ⏳ siguiente | |
| C7.6 · Clientes | pendiente | |
| C7.7 · Números | pendiente | |
| C7.8 · Ajustes | pendiente | |
| C7.9 · Limpieza y ayuda | pendiente | |

**C7.1 (2026-11-18):**
- Tokens en `tailwind.config.ts`: `ok`, `warn`, `danger`, `info`, `muted`, `canvas`. La escala de texto de Tailwind ya coincide con §5 (xs 12 · sm 14 · base 16…): se reemplazaron los 121 usos de 9–11 px por `text-xs` (12 px) en toda la app; queda solo el dibujo decorativo de la guía.
- Íconos propios por destino en `components/ui/Icons.tsx` (carrito, caja, personas, gráfico, camión, portapapeles, impresora, nube, ayuda, tienda, campana, escáner, sin conexión, usuario, más).
- Componentes base: `components/ui/Sheet.tsx` (hoja inferior / ventana, alto máximo y pie fijo) y `components/ui/Screen.tsx` (`ScreenHeader` con ayuda «?», `Tabs`, `ChipFilter`, `EmptyState`, `Stat`, `ListRow`, `TaskCard`). Los que dependen de un flujo (`ProductFinder`, `NumberPad`, `MoneyInput`, `QtyStepper`, `SelectionBar`) se crean en el paso que los usa (C7.2 / C7.3).
- `components/AppShell.tsx` reemplaza a `Nav.tsx` y `StepBar.tsx` (borrados): barra inferior Inicio · Productos · **Vender** · Clientes · Más; barra lateral en escritorio; cabecera con nombre del negocio, `ConnectionChip` (antes `OfflineBar`) y «¿Quién atiende?» (salió de Inicio).
- **Transitorio:** «Más» lleva también a Agregar, Revisar, Escanear, Compras, Contar, Reposición, Precios, Etiquetas y Caja, agrupados como en §3 (Productos · Vender y cobrar · Números · Ajustes · Ayuda), para que nada quede inaccesible mientras C7.2–C7.8 mueven cada función a su lugar. El 5.º botón del vendedor pasa a «Caja» en C7.9, cuando todo lo demás ya viva dentro de su área.
- **Redirecciones (§3.3):** se agregan en el mismo paso que crea cada ruta nueva (en C7.1 no había destinos nuevos).

**C7.2 (2026-11-18):**
- **Inicio «Hoy»** (`app/(app)/dashboard/page.tsx`): botón grande **Vender** con lo vendido hoy (y la ganancia, solo dueño); **primeros pasos** (tienda → productos → primera venta) mientras falte alguno; hasta **4 tareas** con su botón (fotos analizándose, pendientes, caja sin cerrar después de las 18 h, clientes que deben hace más de 30 días, por vencer, por reponer, sin precio); «En inventario» y «Te deben». Se quitaron la tarjeta de colores con una sola acción y los pasos ①②③. **Corrección:** «por reponer» ahora usa la misma regla que la lista de reposición (mínimos del negocio, categoría y producto, y avisos silenciados); antes contaba con mínimo fijo 3.
- **Transitorio:** «Herramientas» (consumo de IA, ordenar y limpiar, guía) queda plegado al final de Inicio, solo para el dueño, hasta C7.8 (Ajustes → Mis datos e Inteligencia artificial). Los enlaces `/dashboard#limpiar` y `#guia` siguen abriéndolo.

**C7.3 (2026-11-18):**
- `app/(app)/products/page.tsx` reescrita: lista única sobre `product_summaries` (todas las filas, ≈200 B c/u; copia sin conexión en `bizKey("inventory")` con variantes). Estado en la dirección: `?filter=pending|restock|expiring|out|noprice|nophoto|trash`, `?category=<id>|none`, `?view=table`, `?select=1`. Búsqueda local (nombre, marca, código, código de variante) + `search` en el servidor (descripción, etiqueta). Páginas de 60 filas.
- «Por reponer» usa `restockLines()` (`components/products/RestockSheet.tsx`), la misma regla de la lista de pedido: por variante cuando tiene variantes, mínimos de producto › categoría › negocio, respeta avisos silenciados. **Diferencia conocida:** Inicio y Reportes siguen contando por stock total del producto (`needsRestock`); se unifica en C7.7 al pasar los números a SQL (E3).
- Borrados `components/ProductRow.tsx` y `components/SwipeRow.tsx` (sin uso). Componentes nuevos en `components/products/`: `RestockSheet` (antes /restock; descartar = botón × en vez de deslizar), `TrashList` (antes /trash; borrar para siempre y vaciar solo dueño, igual que la base), `PriceSheet` (antes /prices; ahora sobre la selección en vez de por categoría — para toda una categoría: filtrar → Seleccionar → Todos), `LabelSheet` (antes /labels; la hoja impresa va en un portal `#labels-sheet` fuera de la hoja inferior). «Mover» usa `CategoryPicker` y un `update ... in (ids)`.
- La barra de selección reutiliza `.sticky-action` (no hizo falta un `SelectionBar` aparte).
- Los totales por categoría (antes estantes) quedan en la hoja «Categoría ▾» (productos y valor de venta); el detalle completo va a Números › Productos en C7.7. La cifra «Ventas este mes» de la lista se quitó (está en Inicio y Reportes).
- Ficha `products/[id]/ProductDetailClient.tsx` con `Tabs`: Datos · Stock · Precios · Historial. Los campos se reparten por nombre (precios: `precio|precio_compra|precio_mayorista|unidades_por_paquete|…`; stock: `stock|cantidad|existencias`; código: `CODE_FIELDS`). Guardado igual que antes (`withoutStock` + `setStock` si se corrigió). Historial: 30 movimientos; historial de precios: 20 (solo dueño).
- Redirecciones en `next.config.mjs`: `/products/c/:id`, `/products/table`, `/restock` (con `?tab=vencer` → `filter=expiring`), `/trash`, `/prices`, `/labels`. Borradas esas 6 rutas. **Ojo:** en Cloudflare, una redirección cuyo destino ya tiene consulta pega la antigua con «?» (`/restock?tab=vencer` → `/products?filter=expiring?tab=vencer`); la pantalla corta cada parámetro en el primer «?». Hacer lo mismo en futuras redirecciones con consulta. «Más» pasa a «Qué falta» y «Precios y etiquetas».
- **Vender** (`app/(app)/sell/page.tsx`): `ProductFinder` (buscar o escanear; elige la variante en una hoja) + los más vendidos + carrito con `QtyStepper` y precio por línea (atajo a mayorista) + acción fija **Cobrar**. La hoja **Cobrar** reemplaza al diálogo de confirmación: total y descuento; Efectivo · QR · Transf. · Varios; «Paga todo / Paga una parte / A cuenta»; en efectivo, **teclado grande** con montos rápidos (exacto y billetes redondos) y **vuelto**; cliente (obligatorio si queda debiendo) con aviso de límite de fiado y de stock insuficiente dentro de la hoja. El ticket final muestra el vuelto. Sigue siendo una sola operación `register_sale` con id idempotente.
- **Caja dentro de Vender:** la pantalla pasó a `/sell/cash` (botón «Caja» en Vender); `/cash` redirige (`next.config.mjs` → `redirects`, primera redirección de §3.3).
- Componentes nuevos: `components/ProductFinder.tsx`, `components/ui/NumberPad.tsx` (`NumberPad`, `QtyStepper`, `padNumber`).

**C7.4 (2026-11-18):**
- `app/(app)/add/page.tsx`: las 5 maneras como pestañas grandes (`?mode=photo|shelf|code|manual|excel`; Excel solo dueño). Cada manera se carga con `next/dynamic` (Código y Excel traen librerías pesadas). Tarea «N pendientes por revisar» arriba.
- `components/add/`: `PhotoAdd` (antes /capture, sin la foto de estante ni el enlace a escanear, que ahora son pestañas), `QueueStatus` (cola compartida; en Foto recibe las fotos que se están preparando), `CodeAdd` (antes /scan, sin cambios de lógica), `ManualAdd` (antes /products/new), `ExcelAdd` (antes /import). Estante usa `components/ShelfDetect.tsx` tal cual (categoría la elige la IA).
- **Decisión:** en Código, «ya lo tienes → +1/+5/+10» se queda por ahora; en C7.5 Entrada de mercadería será el lugar principal para sumar stock (F06 dividido por intención).
- `app/(app)/add/review/page.tsx` (antes /review, 871 líneas) partida en `components/review/`: `useSwipe`, `DuplicateNotice`, `LocationSection` (categoría, subcategoría, IA), `VariantSection` (+ `cellKey`), `ExpirySection`, `MoreFields`, `PhotoZoom`. La página conserva el estado y las acciones.
- **Error corregido:** `save()` guardaba las variantes *después* de pasar el producto a `confirmed`; `product_variants_guard` (024) rechaza stock ≠ 0 en variantes de un confirmado fuera de una operación, y el error se ignoraba → el stock por variante se perdía al confirmar. Ahora `saveVariants()` corre antes (producto aún `draft`) y devuelve el error. Caso agregado a `npm run test:variants` (también comprueba que el orden antiguo sigue rechazado).
- Precarga de la foto siguiente con `signedPhotoUrl` (bucket privado desde 026); borrar pendiente usa `storagePath`; mensajes con `friendlyError`.
- Redirecciones: `/capture`, `/scan`, `/products/new`, `/import` → `/add?mode=…`; `/review`, `/drafts` → `/add/review`. Las pantallas leen `mode`, `view` e `id` cortando en el primer «?» (ver nota de C7.3).
