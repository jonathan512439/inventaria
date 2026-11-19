# Registro de cambios y validación

Cada entrada indica **qué cambió**, **por qué** y **cómo validarlo** en <https://inventaria.pages.dev>.
Referencia de riesgos: [AUDITORIA.md](AUDITORIA.md).

## 2026-11-19 · Fase 6.9 · C7.6 — Clientes: cuánto debe, por qué y su mercadería en una sola ficha

### 17.13 Clientes y ficha
- **Qué**:
  - **Lista de clientes** con buscador y chips **Todos · Deben · Sin venir 30 días · Con mercadería entregada**, cada uno con su cantidad. Arriba, dos cifras que se tocan: **Te deben** (en rojo si hay deudas de más de 30 días) y **Mercadería afuera**. Botón fijo **Nuevo cliente**: se crea en una hoja y abre su ficha.
  - La pestaña «Resumen» desaparece: sus cifras quedan arriba y **Mejores clientes del mes** va plegado al final (pasará a Números en C7.7).
  - **Ficha del cliente**: el saldo grande arriba con **Cobrar abono** y **Recordar por WhatsApp** (o **Venderle** si está al día). Debajo, las pestañas **Compras** (primero lo que debe y qué se llevó) · **Abonos** · **Mercadería entregada** · **Datos**.
  - **Cobrar abono** abre una hoja con **teclado grande**, atajos «Todo» y «La mitad», medio de pago y «le quedará debiendo» o «queda a su favor» al instante. Ya no pide confirmar otra vez.
  - **Mercadería entregada deja de ser una pantalla suelta**: en la ficha se **entrega** (buscar o escanear, − + y precio) y se **rinden cuentas** (vendió / devuelve, paga ahora o queda debiendo) sin salir. La dirección antigua (/consign) abre la lista con el chip «Con mercadería entregada».
  - **Datos** (nombre, teléfono, nota, límite de fiado) se edita en su pestaña con un botón fijo **Guardar datos**. **Quitar cliente**, solo el dueño.
  - Los errores se muestran en palabras simples.
- **Validar**: Clientes → chip «Deben» → aparecen ordenados por lo que deben. Abrir uno → el saldo y «desde hace N días» arriba → Compras muestra primero lo que debe con los productos → «Cobrar abono» → «La mitad» → «Le quedará debiendo …» → Cobrar → el saldo baja y aparece en Abonos. Pestaña «Mercadería entregada» → «Entregar mercadería» → escanear 2 productos → Entregar → «Rendir cuentas» → vendió 1, devuelve 1, «Sí, paga» → Registrar → la entrega se cierra. Abrir /consign → lista con «Con mercadería entregada». «Nuevo cliente» → nombre → Guardar → abre su ficha.

## 2026-11-19 · Fase 6.9 · C7.5 — Mercadería: lo que llega y lo que hay, dentro de Productos

### 17.12 Llegó mercadería y Contar
- **Qué**:
  - **Llegó mercadería** (antes «Compras y proveedores», solo dueño) está en Productos y en Más, y ahora la puede usar **cualquiera del equipo**. Arriba se busca o se **escanea**: cada lectura suma 1 (el último leído sube a la cabeza de la lista y se marca en verde) y cada fila muestra «tenías N → quedarán M», con − y + grandes.
  - **Proveedor, factura, costo y vencimiento son opcionales** y van plegados en «Más datos». El dueño guarda todo en una sola operación, como antes. El vendedor guarda solo la entrada de stock y el vencimiento (el costo y el proveedor siguen siendo del dueño); si algo falla, quedan en la lista solo los productos que faltaron y al reintentar no se suma dos veces.
  - **La lista en curso queda guardada en el teléfono** hasta tocar «Guardar entrada»: salir sin querer ya no la pierde.
  - **Corrección:** el costo ya no se completaba solo al agregar un producto (se perdió cuando el costo pasó a ser privado del dueño en C5). Ahora vuelve a aparecer el último costo de cada producto o variante.
  - El dueño ve también las pestañas **Entradas** (historial con proveedor y total) y **Proveedores** (con WhatsApp).
  - **Contar**: misma forma de antes (elegir categoría → escanear o escribir → diferencias → corregir con motivo), con tres cifras arriba (contados, no coinciden, diferencia), **buscador dentro de la categoría**, filtros **Todos · Faltan contar · No coinciden** y un botón **✓ N** para marcar de un toque que hay lo mismo que dice la app.
  - Las direcciones antiguas (/purchases, /count) llevan a su lugar nuevo (/stock/in, /stock/count).
- **Validar**: Productos → «Llegó mercadería» → escanear 3 veces el mismo producto → queda arriba con 3 → buscar otro y agregarlo → salir a Inicio y volver → la lista sigue ahí → «Guardar entrada» → el stock de ambos sube. Como dueño: «Más datos» → elegir proveedor y marcar «Anotar costo y vencimiento» → el costo viene completado → guardar → aparece en «Entradas». Como vendedor: la pantalla se abre (antes decía «Esto lo maneja el dueño»), no muestra costo ni proveedor y la entrada se guarda. Productos → «Contar» → elegir categoría → tocar «✓» en 2 productos y escribir otra cantidad en 1 → filtro «No coinciden» muestra 1 → «Terminar y corregir 1».

## 2026-11-18 · Fase 6.9 · C7.4 — Agregar: las cinco maneras en un solo lugar

### 17.11 Agregar y Revisar
- **Qué**:
  - **Agregar productos** (botón fijo de Productos) reúne las cinco maneras arriba: **Foto** · **Estante** (varios productos en una foto) · **Código** (sin gastar IA) · **A mano** · **Excel** (dueño). Antes eran cuatro pantallas separadas y la foto de estante estaba escondida dentro de la de fotos.
  - **La cola de fotos** (analizando, listas, con error, pausa por cupo) se ve en Agregar sea cual sea la manera elegida, y **«N pendientes por revisar → Revisar»** está siempre arriba.
  - **Revisar** cuelga de Agregar y queda igual por fuera (tarjeta por producto, deslizar para confirmar, «¿ya lo tienes? → sumar stock»), pero por dentro está partida en partes más simples.
  - **Corrección importante:** al confirmar en Revisar un producto **con tallas o colores**, el stock de cada variante no se guardaba (la base lo rechazaba en silencio desde los permisos de C4). Ahora se guarda antes de confirmar y, si algo falla, se avisa.
  - También en Revisar: los errores se muestran en palabras simples y la foto del siguiente producto se precarga otra vez (dejó de hacerlo cuando las fotos pasaron a ser privadas).
  - Las direcciones antiguas (/capture, /scan, /products/new, /import, /review, /drafts) llevan a su lugar nuevo.
- **Validar**: Productos → «Agregar productos» → aparecen Foto · Estante · Código · A mano · Excel. Foto → tomar 2 fotos → la cola muestra «analizando» y luego «Revisar 2». En Revisar, un producto de una categoría con tallas: marcar «Sí, tiene variantes», escribir stock en 2 casillas → Confirmar → abrir el producto → pestaña Stock: cada variante tiene su stock. Código → escanear un producto que ya tienes → +1. Como vendedor no aparece Excel.

## 2026-11-18 · Fase 6.9 · C7.3 — Productos: una sola lista para encontrar y cambiar todo

### 17.10 Productos y ficha
- **Qué**:
  - **Una sola lista** en lugar de «estantes» por categoría: buscador (nombre, marca, código o lo que diga la descripción) con **escáner** (si el código es de un producto, abre su ficha).
  - **Filtros** debajo del buscador, con su cantidad: Categoría ▾ (con cuántos productos tiene cada una y cuánto valen) · Pendientes · Por reponer · Por vencer · Agotados · Sin precio · Sin foto · Papelera (dueño). **Reposición, Papelera, Cambiar precios y Etiquetas dejan de ser pantallas aparte.**
  - **Por reponer** trae el botón **Lista de pedido**: agrupada por proveedor, cantidad sugerida editable, WhatsApp y Excel; la × deja de avisar de un producto.
  - **Seleccionar**: marcar varios (o «Todos») y, con la barra de abajo, **Precio** (dueño: +%, monto o margen, con vista previa), **Etiquetas** (A4 o rollo, crea códigos internos), **Mover** de categoría, **Excel** o **Papelera** (dueño, con «Deshacer»).
  - Cada fila muestra foto, precio y estado con color (Agotado, Quedan N, En inventario) y un botón **±** para sumar o restar stock sin abrir la ficha.
  - En computadora, el botón **Tabla** cambia a la tabla editable sobre la misma lista filtrada.
  - **Ficha con 4 pestañas**: **Datos** (foto, categoría, campos, código con escáner, volver a analizar con IA) · **Stock** (cantidad grande, +/− Stock, tallas y colores, «avisarme cuando queden», vencimiento) · **Precios** (venta, compra solo dueño, mayorista, cuánto ganas por unidad e historial de precios) · **Historial** (las últimas 30 ventas, entradas y retiros). Un solo «Guardar cambios».
  - Las direcciones antiguas (/restock, /trash, /prices, /labels, /products/table, /products/c/…) llevan al filtro correspondiente.
- **Validar**: Productos → escribir parte de un nombre → aparece al instante; tocar el escáner y leer un código → abre la ficha. Tocar «Por reponer» → «Lista de pedido» → WhatsApp. Seleccionar 3 → Etiquetas → Imprimir (vista previa del navegador con las etiquetas). Seleccionar 2 → Precio → +10 % → Aplicar → los precios cambian en la lista. Abrir un producto → pestaña Stock → +/− Stock → vender 1 → el número baja. Como vendedor: no aparecen Precio, Papelera ni el costo.

## 2026-11-18 · Fase 6.9 · C7.2 — Inicio con lo que hay que hacer hoy y un Vender más rápido

### 17.9 Inicio y Vender
- **Qué**:
  - **Inicio** muestra un botón grande para **Vender** con lo vendido hoy, los **primeros pasos** si estás empezando, y hasta **4 avisos** de lo que pide atención (por revisar, caja sin cerrar, clientes que deben hace más de un mes, por vencer, por reponer, sin precio), cada uno con su botón.
  - **Corrección**: «por reponer» en Inicio ahora coincide con la lista de reposición (antes usaba un mínimo fijo de 3 y no respetaba los avisos silenciados).
  - **Vender**: buscar o escanear arriba, los más vendidos a mano, el carrito con botones − + grandes y el botón **Cobrar**. Al cobrar se abre una hoja: cómo paga (efectivo, QR, transferencia o varios), si paga todo, una parte o queda a cuenta, y en efectivo un **teclado grande** para escribir con cuánto paga: la app muestra el **vuelto**. Los avisos (límite de fiado, poco stock) aparecen ahí mismo, sin otro cuadro de confirmación.
  - **La caja está dentro de Vender** (botón «Caja»). La dirección antigua sigue funcionando.
- **Validar**: Inicio → tocar «Vender» → agregar 2 productos (uno escaneado) → Cobrar → Efectivo → tocar un monto redondo → se ve el vuelto → Cobrar → el ticket muestra el vuelto. Vender → «Caja» abre la caja del día. Inicio con productos pendientes muestra «N productos por revisar → Revisar».

## 2026-11-18 · Fase 6.9 · C7.1 — Nueva estructura: cinco lugares y «Vender» al centro

Primer paso de la reconstrucción visual ([RECONSTRUCCION_VISUAL.md](RECONSTRUCCION_VISUAL.md)). Por pedido del usuario, C7 va antes que C6.

### 17.8 Sistema visual y armazón
- **Qué**:
  - **Barra inferior nueva**: Inicio · Productos · **Vender** (botón grande al centro) · Clientes · Más. Antes el centro era «Agregar» y Vender estaba escondido en «Más».
  - **En computadora**, una barra a la izquierda con los mismos lugares y todas las secciones a la vista.
  - **Cabecera** con el nombre del negocio, el estado de la conexión (sin conexión, enviando, cambios sin guardar) y «¿Quién atiende?» (antes solo en Inicio).
  - **«Más» ordenado por tarea** (Productos · Vender y cobrar · Números · Ajustes · Ayuda), con un ícono propio para cada cosa y «Cerrar sesión».
  - **Se quitó la barra de pasos** «Agregar → Revisar → Inventario», que aparecía incluso al vender.
  - **Letra más legible**: ningún texto de la app es menor a 12 px (había 121 textos de 9 a 11 px).
- **Validar**: en el celular, el botón central abre Vender; Productos muestra un número cuando hay pendientes por revisar; «Más» se abre como hoja y se desplaza; en computadora, la barra lateral lleva a todas las secciones; sin internet, la cabecera dice «Sin conexión».

## 2026-11-18 · Fase 6.9 · C5.3 — Las fotos de los productos son privadas

Migración `026_fotos_privadas.sql` aplicada después de publicar el código. `npm run test:access` 35/35 contra producción; las 27 fotos existentes siguen visibles para su negocio.

### 17.7 Fotos privadas
- **Qué**: antes cualquiera que tuviera la dirección de una foto podía verla. Ahora las fotos solo se muestran dentro de la app a las personas del negocio, con un enlace que vence en una hora (la app lo renueva sola).
  - En la app todo se ve igual.
  - El enlace de la foto que sale en el Excel exportado ya no abre fuera de la app.
- **Validar**: Inventario, la ficha de un producto, Revisar y el escáner muestran las fotos como siempre; copiar la dirección de una foto desde un Excel exportado y abrirla en el navegador → no se ve.

## 2026-11-18 · Fase 6.9 · C5.2 — El costo y la ganancia, solo para el dueño

Migración `025_costos.sql` aplicada (las sumas de costos se verificaron antes de quitar las columnas). `npm run test:access` 34/34 (también contra las rutas publicadas); `test:ops`, `test:team`, `test:fields`, `test:variants`, `test:import`, `test:backup` en verde; `test:e2e` 58/58.

### 17.6 Costos fuera del alcance del vendedor
- **Qué**: hasta ahora la app no le mostraba el costo al vendedor, pero el dato le llegaba igual (alguien con la app modificada lo podía ver). Ahora el precio de compra, el costo de cada venta y la ganancia de la caja se guardan aparte y la base **solo se los entrega al dueño**: al vendedor le llegan vacíos en productos, ventas, cierres, historial de precios y movimientos.
  - Para el dueño todo se ve igual que antes (ficha, tabla, reportes, caja, resumen, exportar y respaldos incluyen el costo).
  - El precio de compra se sigue cambiando desde la ficha del producto, con una compra o con cambio de precios en lote; si un vendedor intenta mandarlo, se ignora.
- **Validar**: con la cuenta del dueño → la ficha de un producto muestra y guarda el precio de compra; Reportes y Caja muestran la ganancia. Con la cuenta de un vendedor → no aparece el costo en ninguna pantalla ni en Movimientos (las entradas por compra ya no muestran a cuánto se compró).

## 2026-11-18 · Fase 6.9 · C5.1 — Cada quien puede solo lo que le toca (y la base lo hace cumplir)

Migración `024_permisos.sql` aplicada. Prueba nueva `npm run test:access` 24/24 (intenta cada acción como dueño, vendedor, otro negocio y alguien con dos negocios, directo contra la base); `test:team` 22/22; `test:ops`, `test:fields`, `test:variants`, `test:import`, `test:backup` en verde.

### 17.5 Permisos por rol y operación
- **Qué**: hasta ahora la app escondía botones, pero cualquier miembro podía hacer casi todo si se saltaba la pantalla. Ahora lo decide la base:
  - **Vendedor**: vende, cobra, cuenta, repone, agrega y edita productos y clientes, crea categorías. **No** borra ni manda a la papelera productos confirmados (sí descarta pendientes), no quita clientes, no cambia categorías ni datos, no ve compras ni proveedores, no anota compras ni cambia precios en lote, no descarga respaldos.
  - **El stock** de un producto en inventario solo cambia con una venta, una entrada, un ajuste o un conteo (también para el dueño): nadie lo puede «pisar» a mano.
  - **Firma confiable**: quién hizo cada cosa lo pone la base y no se puede cambiar después.
  - **Celular compartido**: al pasar a otra persona con su PIN, el celular actúa con los permisos de ESA persona (un vendedor en el celular del dueño es vendedor). **Volver a la cuenta del dueño pide su PIN**; para pasar el celular, la cuenta debe tener PIN.
  - **Varios negocios**: quien está en más de uno ve y anota solo en el negocio activo; en Ajustes aparece para cambiar de negocio.
  - **Nadie** cambia el plan del negocio desde la app y el negocio no puede quedarse sin dueño.
  - **Cerrar sesión** borra todo lo guardado en el celular (inventario sin conexión, cambios pendientes, fotos en cola).
  - **Ordenar y limpiar** es solo del dueño y solo de su negocio activo; abrirlo ya no borra nada. La papelera de más de 30 días se vacía con el respaldo semanal.
  - Ajustar el consumo de IA solo con clave propia.
- **Validar**: con la cuenta de un vendedor → en la ficha de un producto no aparece «Enviar a la papelera»; en Clientes no aparece «Quitar»; Compras no se abre. En el celular del dueño → «¿Quién atiende?» → pasar al vendedor con su PIN → hacer una venta (queda a su nombre) → «Volver a mi cuenta» pide el PIN del dueño. Cerrar sesión y entrar con otra cuenta → no se ve nada del inventario anterior.

## 2026-11-18 · Fase 6.9 · C4 — El nombre, la moneda y «hoy» son del negocio

Migración `023_ajustes_negocio.sql` aplicada. `npm run test:ops` 50/50; `test:fields`, `test:variants`, `test:team`, `test:import`, `test:backup` en verde.

### 17.4 Ajustes del negocio y zona horaria
- **Qué**:
  - **Nombre del negocio** en tickets, recordatorios por WhatsApp, resumen del día e Inicio: ahora es el del negocio para todo el equipo (antes un vendedor veía «Mi negocio»).
  - **Ajustes → Tu negocio**: el dueño cambia nombre, **moneda** (Bs, S/, $…) y **zona horaria**. Todos los importes de la app usan esa moneda.
  - **«Hoy» es el día del negocio**, no el del celular: la caja, el inicio, el resumen, movimientos y reportes cortan el día en la zona horaria del negocio (una venta a las 21:00 en Bolivia ya no cae en el día siguiente en algunas pantallas).
  - **Avisos** (desde cuántas unidades avisar y días antes del vencimiento) son del negocio: los mismos para todo el equipo.
  - **Más rápida al navegar**: la app pide negocio, equipo, ajustes y conteos en una sola consulta en vez de unas 7 en cada pantalla.
  - «Pregúntale» responde con el nombre, la moneda y la fecha del negocio.
- **Validar**: Ajustes → Tu negocio → cambiar el nombre y la moneda → Guardar → un ticket nuevo en Vender muestra el nombre y los importes con esa moneda; entrar con la cuenta de un vendedor → ve el mismo nombre y no puede cambiarlo; Ajustes → Cuándo avisarme → cambiar el mínimo → con la cuenta del vendedor, «Qué falta» usa el mismo mínimo.

## 2026-11-18 · Fase 6.9 · C3 — El dinero como pagos: caja que cuadra, pago con varios medios y saldo a favor

Migración `022_pagos.sql` aplicada (las ventas existentes conservan exactamente su estado y lo cobrado). `npm run test:ops` 44/44; `test:fields`, `test:variants`, `test:team`, `test:import` en verde.

### 17.3 Cobros, abonos y caja
- **Qué**: cada cobro queda anotado como un **pago** con su medio y su hora: lo que se paga al vender y lo que un cliente abona de su deuda.
  - **Los abonos entran en la caja del día** en que se cobran y por su medio (antes no aparecían en la caja: el efectivo esperado no cuadraba cuando alguien pagaba un fiado).
  - **Pago con varios medios**: en Vender, «¿Cómo paga?» tiene la opción **Varios** (por ejemplo Bs 60 en efectivo + Bs 40 por QR). La caja suma cada parte en su medio. Si falta una parte, queda fiada a nombre del cliente.
  - **Saldo a favor**: si un cliente paga de más, lo que sobra queda a su favor (se ve en su ficha) y se usa solo en su próxima compra fiada.
  - **Cierres de caja con historial**: cerrar otra vez el mismo día guarda un cierre nuevo y conserva el anterior; los días cerrados no cambian si después alguien paga una deuda vieja. Los totales los calcula el servidor al cerrar.
  - La lista de abonos de la ficha del cliente muestra solo abonos (lo pagado al vender figura en cada venta).
- **Validar**: vender Bs 100 con «Varios» = 60 efectivo + 40 QR → en Caja, Efectivo +60 y QR +40; a un cliente que debe, registrar un abono por QR → aparece en Caja de hoy como QR («incluye … de abonos de fiados») y su deuda baja; abonar más de lo que debe → la ficha muestra «tiene Bs … a su favor»; cerrar la caja dos veces → la lista «Cierres anteriores» muestra ambos con su hora.

## 2026-11-17 · Fase 6.9 · C2 — Ventas, stock, compras, entregas y conteos que no se pierden

Migración `021_operaciones.sql` aplicada (el inventario quedó idéntico). `npm run test:ops` 30/30; `test:fields`, `test:variants`, `test:team`, `test:import` en verde.

### 17.2 Operaciones atómicas
- **Qué**: vender, sumar o restar stock, anotar una compra, entregar a un revendedor, rendir cuentas, terminar un conteo y cambiar precios ahora se hacen en **una sola operación en el servidor que se guarda completa o no se guarda**. Antes cada pantalla hacía varios pasos sueltos: un corte de internet a mitad podía dejar un ticket sin productos o el stock sin descontar, y dos celulares vendiendo a la vez podían perder un descuento.
  - **Sin duplicados**: cada venta u operación lleva un número propio; si se corta la red y se vuelve a tocar «Cobrar», no se registra dos veces.
  - **Número de venta** sin repetidos aunque vendan dos personas a la vez.
  - **Ganancia real también cuando vende un vendedor**: el costo se toma en el servidor (antes quedaba en 0 y la ganancia salía inflada).
  - **Vender más de lo que dice la app** está permitido: el stock queda en 0 y el movimiento anota cuántas unidades faltaban («faltante»). Antes se recortaba en silencio.
  - **Mercadería entregada**: al rendir cuentas, lo vendido ya no se descuenta dos veces de los movimientos; no se puede rendir más de lo que está afuera.
  - **Conteo**: el stock queda en lo contado aunque se haya vendido mientras se contaba.
  - **Guardar la ficha o la tabla ya no pisa una venta** hecha mientras se editaba; si se cambia el stock a mano, queda como «ajuste» en Movimientos.
  - **Historial de precios automático**: todo cambio de precio (ficha, tabla, cambio masivo, compra) queda registrado.
  - **Sin conexión**: una venta rápida hecha en modo avión se envía como venta de verdad (aparece en la caja y en los tickets) con su hora original. Si el servidor rechaza un cambio 5 veces, la barra lo muestra con «Ver y descartar».
- **Validar**: vender 2 productos en Vender → stock baja y aparece el ticket; tocar «Cobrar», cortar el internet antes de que responda y volver a tocar → una sola venta; vender más unidades de las que hay → stock 0 y en Movimientos la venta muestra el faltante; anotar una compra con costo → stock y precio de compra cambian y el historial de precios de la ficha lo muestra; entregar 5 a un revendedor y rendir 3 vendidas + 1 devuelta → stock correcto y la entrega sigue abierta con 1.

## 2026-11-17 · Fase 6.9 · C1 — Nombre, precios, stock y código como columnas

Migración `020_campos_sistema.sql` aplicada. **Verificación:** la vista del inventario devuelve exactamente lo mismo antes y después (huella `md5` de las 55 filas idéntica, stock total 348 = 348, fechas sin tocar). `npm run test:fields` 19/19, `test:variants` 10/10, `test:team` y `test:import` en verde.

### 17.1 Campos del sistema como columnas
- **Qué**: los datos que usa todo el sistema (nombre, marca, precio, precio de compra, precio mayorista, stock, código de barras, unidades por paquete) pasan a ser **columnas reales** del producto, además de seguir en sus datos. Un disparador los mantiene iguales en los dos sentidos: lo que hoy escribe la app en los datos se copia a la columna, y lo que se escriba en la columna (desde C2) se copia a los datos con la misma clave que ya usaba el producto (`stock`, `cantidad`…). Con variantes, el stock sigue siendo la suma de las variantes.
  - **Búsqueda más rápida**: la búsqueda del inventario, Vender, Compras y Entregas usa un índice de texto (no recorre todos los productos).
  - **Escanear un código** (Escanear y Vender) busca solo ese código en lugar de descargar todo el inventario.
  - El **código de barras de una variante** es único dentro del negocio (antes, por persona: dos miembros podían repetirlo).
- **Validar**: buscar un producto por parte del nombre en Inventario y en Vender → aparece igual que antes; escanear un producto con código → se reconoce al instante; cambiar el stock desde la ficha → Inventario muestra el valor nuevo; en un producto con tallas, el stock total sigue siendo la suma.

## 2026-11-17 · Fase 6.9 · C0 — La base no se vuelve a dormir sin aviso

Plan detallado y estado de la Fase 6.9: [PLAN_CIMIENTOS.md](PLAN_CIMIENTOS.md). Incidente: [AUDITORIA.md §2.0](AUDITORIA.md).

### 17.0 Operación y alertas
- **Qué**: el proyecto de Supabase estuvo **pausado** (plan gratuito, ~7 días sin uso) desde ~2026-10-05 hasta su restauración manual el 2026-11-17; por eso no se podía iniciar sesión, y el respaldo semanal falló 6 domingos seguidos sin que nadie se enterara. Ahora:
  - `keepalive.yml`: cada 2 días hace una consulta real a la base y al servicio de sesión, para que no se pause.
  - `keepalive.yml`, `backup.yml` y `deploy.yml` **abren un issue** «Falló: …» en GitHub cuando fallan (o comentan el que ya está abierto). GitHub avisa por correo al dueño del repositorio.
  - El despliegue usa Node 22.
  - `lib/errors.ts` (`friendlyError`): convierte errores técnicos en mensajes sencillos. El login y el registro ya no muestran textos en inglés; sin conexión dicen «No pudimos conectar con el servidor. Revisa tu internet o intenta de nuevo en unos minutos.».
- **Validar**: iniciar sesión funciona; en GitHub → Actions, «Mantener la base activa» y «Respaldo semanal» lanzados a mano terminan en verde; con el celular en modo avión, «Entrar» muestra el mensaje de conexión.

## 2026-09-15 · Plan v3 · Fase 6 — El negocio y su equipo, importar, respaldos y etiquetas

Migraciones `014_negocios.sql` → `019_respaldos.sql` aplicadas. **Verificación de la migración:** conteos iguales antes y después en las 20 tablas y todas las filas con negocio; `npm run test:team` 18/18 y `npm run test:e2e` 58/58 en verde contra producción.

### 16.1 El negocio como unidad de datos
- **Qué**: cada cuenta existente pasó a ser un **negocio** propio (con su dueño) sin que nada cambie a la vista. Todas las tablas llevan `business_id` y la seguridad (RLS) es **por negocio**: quien es miembro ve y edita lo del negocio; nadie más. La base rellena el negocio en cada alta (no depende de la app) y crea el negocio al registrarse. El número de venta es por negocio y el cierre de caja es uno por negocio y día. Las rutas que escriben con la clave del servidor (foto → producto, alta por código) envían el negocio; Ordenar y limpiar trabaja por negocio.
- **Validar**: todo sigue igual para ti; en Ajustes aparece **Equipo** con tu nombre como Dueño.

### 16.2 Equipo (`/team`): roles, invitaciones y PIN
- **Qué**: **Ajustes → Equipo** (y Más → Configurar): la lista de personas con su rol (**Dueño** / **Vendedor**), nombre editable, quitar/reactivar; **Invitar** genera un código de 6 letras (vale 7 días) para vendedor o dueño, con botón de WhatsApp; la persona se registra y entra a `/join` con el código (o abre el enlace). **Mi PIN**: 4 números guardados en una tabla privada (hash con sal; nunca viaja al celular; se bloquea 10 minutos tras 5 intentos).
- **Validar**: Equipo → Código para vendedor → WhatsApp → desde otra cuenta abrir el enlace → aparece como vendedor; el dueño puede quitarlo y deja de ver el negocio.

### 16.3 ¿Quién atiende? (firma)
- **Qué**: en el Inicio, cuando hay más de una persona, la pastilla **«Atiende Pedro ▾»**: se toca, se elige la persona y se escribe su PIN. Desde ese momento cada venta, movimiento, conteo, compra, abono o cierre queda **firmado** por ella aunque el celular tenga la sesión del dueño (la base valida que sea miembro activo). «Volver a mi cuenta» quita la firma. Mientras atiende un vendedor, la app se comporta como vendedor.
- **Validar**: pasar a un vendedor con PIN → registrar una venta → en Ventas y movimientos figura a su nombre.

### 16.4 Lo que el vendedor no ve
- **Qué**: precio de compra, ganancia (Inventario, Ventas, Caja, tickets, Resumen de hoy, Pregúntale), historial de precios y las pantallas del dueño: Cómo va el negocio, Anotar una compra, Cambiar precios, Descargar en Excel, Mi tienda, Cuándo avisarme, Ordenar y limpiar (muestran «Esto lo maneja el dueño»). En la base, la vista del inventario ya **no entrega el costo** a un vendedor; el ocultamiento completo del costo en `products.data` se remata en la Fase 7 con la matriz de acceso.
- **Validar**: entrar como vendedor → Más no muestra esas opciones; Inventario no muestra ganancia; la ficha no muestra precio de compra.

### 16.5 Importar desde Excel (`/import`) — parte 2
- **Qué**: **Más → Traer desde Excel** (dueño). Se elige la planilla (.xlsx, .xls o .csv; si tiene varias hojas, se elige una), la app **adivina qué es cada columna** por su título (Producto/Nombre, Rubro/Categoría, Sección/Subcategoría, Precio de venta, Costo, Cantidad/Stock, Código, Vence, Marca, Stock mínimo, Precio por mayor, Unidades por paquete, Descripción) y se puede corregir columna por columna; lo que no se reconoce se guarda como «otro dato» con el nombre de la columna o se ignora. La **vista previa** dice cuántos son nuevos, cuántos **ya existen** (mismo código de barras o mismo nombre, sin importar mayúsculas ni acentos), qué filas se saltan (sin nombre, repetidas dentro de la planilla) y qué **categorías o subcategorías se crearán**. Con los que ya existen se elige: actualizar precio, costo, código y stock, o dejarlos. Acepta precios con coma, códigos numéricos largos, fechas en texto, de Excel o «sin fecha». Importa por tandas de 100; el stock inicial queda como **entrada** «importado de Excel» y los cambios de stock como **ajuste**; los productos con variantes no cambian de stock desde la planilla. Lógica probada con `npm run test:import`.
- **Validar**: Exportar a Excel → editar precios y agregar filas → Traer desde Excel → la vista previa muestra «ya existen» para los editados y «nuevos» para las filas agregadas → Importar → el inventario refleja los cambios y Ventas y movimientos muestra las entradas.

### 16.6 Respaldos (`/backup`) y exportación total
- **Qué**: **Más → Respaldos** (dueño). Un solo Excel con **todo el negocio**: portada con conteos, Inventario (mismo formato que Exportar, con variantes), Papelera, Ventas y su detalle, Clientes, Abonos, Entregas, Movimientos, Compras, Proveedores, Conteos, Cierres de caja, Caja, Historial de precios, Categorías, Datos definidos, Ejes de variantes y Equipo (con nombres en vez de ids). **Guardar respaldo ahora** lo sube al bucket privado `backups/<negocio>/<fecha>-manual.xlsx`; **Descargar copia completa** lo baja al celular. **Automático:** GitHub Actions (`backup.yml`, sábados 23:00 Bolivia, o a mano desde Actions) ejecuta `npm run backup` con la clave de servicio y sube `<fecha>-auto.xlsx` de cada negocio; se conservan las **últimas 8** copias. La lista muestra fecha, origen y tamaño, con descarga por enlace firmado (2 min) y borrado. Seguridad: bucket privado, lectura para miembros del negocio, subida/borrado solo para el dueño (migración `019_respaldos.sql`); probado con `npm run test:backup` (genera, descarga, hojas presentes, y sin sesión no se ve nada). El envío por correo queda para la Fase 8 (SMTP).
- **Validar**: Respaldos → Guardar respaldo ahora → aparece en la lista → Descargar → el Excel abre con todas las hojas. En GitHub → Actions → «Respaldo semanal» → Run workflow → aparece la copia «Automático».

### 16.7 Etiquetas para imprimir (`/labels`)
- **Qué**: **Más → Etiquetas para imprimir** (todo el equipo). Se filtra por categoría, búsqueda o «solo sin código»; se marcan productos (o variantes) y cuántas etiquetas de cada uno (o «= stock»). **Crear códigos internos** asigna a los que no tienen código un **IA + 6 números** único en el negocio, guardado como su código de barras (en la variante si corresponde), así la cámara de la app los reconoce al vender, contar o escanear. Cada etiqueta lleva nombre, variante · negocio, **código de barras Code 128** (`jsbarcode`, carga bajo demanda) y precio (opcional). Formatos: **Hoja A4** (3 × 8 = 24 por hoja, papel adhesivo) o **Rollo 50 × 30 mm** (una por etiqueta); vista previa en pantalla y **Imprimir** (solo salen las etiquetas).
- **Validar**: marcar 3 productos sin código → Crear códigos internos → Imprimir (o Guardar como PDF) → escanear una etiqueta impresa con «Escanear un código» → abre el producto.


---

## 2026-09-15 · Plan v3 · Fase 5 — Información que hoy no existe

### 15.1 Cómo va el negocio (`/reports`)
- **Qué**: **Más → Cómo va el negocio** (también «Cómo va» en el Inicio). Periodo (7 días / este mes / 90 días) y cuatro pestañas: **Ventas** (vendido, ganancia y n.º de ventas **contra el periodo anterior** con ▲▼ %, gráfica de los últimos 14 días, lo que más dinero deja); **Lo que se mueve** (los 10 más vendidos con aviso «por reponer», y **parado**: productos con stock sin venderse en 60 días con el dinero quieto); **Ganancia** (por categoría: vendido − costo, % de margen con barra y aviso si faltan costos); **Lo que tengo** (valor a precio de venta y a costo, ganancia si se vende todo, accesos a por reponer / por vencer / parados, valor por categoría).
- **Validar**: Cómo va → Ventas → los números coinciden con Ventas y movimientos; Lo que se mueve → un producto con stock y sin ventas aparece en «Parado».

### 15.2 Resumen de hoy (`/digest`)
- **Qué**: **Más → Resumen de hoy** (y en Inicio → Más herramientas): vendido y ganancia de hoy (con ayer al lado), agotados y por reponer, por vencer (con días), quién debe (y deudas de +30 días), y el **mensaje ya redactado** con **Enviar por WhatsApp** para mandárselo a uno mismo o a un socio.
- **Validar**: abrir Resumen de hoy → el texto refleja las ventas del día → Enviar por WhatsApp abre el chat con el mensaje.
- **Nota**: el envío automático (notificación o correo a una hora fija) queda para la Fase 8: en el plan gratuito no hay correo saliente y las notificaciones push requieren claves y un servidor de envío.

### 15.3 Pregúntale a tu inventario (`/ask`)
- **Qué**: **Más → Pregúntale a tu inventario**: preguntas en lenguaje normal («¿Cuánto vendí esta semana y cuánto gané?», «¿Quién me debe?», «¿Qué tengo parado?») con sugerencias para empezar. El servidor arma un **resumen de solo lectura** de tus datos (productos con stock, precio, costo y mínimo; ventas de 90 días por producto y por día; últimas ventas; deudas) y la IA responde con esas cifras, en español sencillo; si algo no está en los datos, lo dice. **Nunca cambia nada.** Cuenta como 1 análisis (o usa tu clave propia).
- **Validar**: preguntar «¿cuánto vendí en total y quién me debe?» → responde con las cifras reales; el inventario no cambia.

### 15.4 Pruebas
- `npm run test:e2e`: pantallas de reportes, resumen y preguntar; la respuesta de la IA usa los datos reales (vendido / cliente / deuda) y no modifica nada. **58/58 en verde contra producción** (una pasada tuvo fallos transitorios de red; las dos siguientes, limpias).

---

## 2026-09-15 · Plan v3 · Fase 4 — Clientes: fiado, entregas y reportes (sin fidelización)

Migración `supabase/013_clientes.sql` aplicada: `customers`, `payments` (abonos), `consignments` / `consignment_items` (mercadería entregada), ventas ligadas al cliente y movimientos enlazados a la entrega.

### 14.1 Clientes (`/customers`)
- **Qué**: **Más → Clientes**. Ficha mínima (nombre, teléfono, nota, límite de fiado); se crea desde aquí o en 5 segundos desde la venta. Lista con última compra, total comprado, **cuánto debe y desde hace cuántos días**, y unidades entregadas. Pestañas **Deben**, **Sin venir** (30 días) y **Resumen**: deuda en la calle, deuda de más de 30 días, mercadería entregada sin liquidar, clientes sin venir y **mejores clientes del mes**. El cliente sigue siendo opcional: la mayoría de ventas son sin nombre.
- **Validar**: crear un cliente → aparece en la lista; tras fiarle algo, pasa a *Deben* con el monto y los días.

### 14.2 Vender con cliente y fiado ligado
- **Qué**: en Vender, **Cliente (opcional)** con buscador y creación rápida. Para **Fiado** o **Una parte** es obligatorio elegirlo; muestra lo que ya debe y avisa si con esta venta pasaría su **límite de fiado**. El ticket queda a su nombre.
- **Validar**: Vender → Fiado sin cliente → pide elegirlo; con cliente que ya debe → aviso del límite en la confirmación.

### 14.3 Ficha del cliente: saldo, abonos y recordatorio (`/customers/detail`)
- **Qué**: saldo con **desde hace N días**, límite; **Lo que se llevó y aún debe** por ticket con sus productos; **Abonar** (monto y medio; se aplica a lo más antiguo y marca los tickets como pagados; si paga de más queda anotado); **Recordar por WhatsApp** con el mensaje armado («Hola Juanito… saldo Bs 85: 12 sep · Bs 25 (2 Coca 2 L)…»); compras con detalle, historial de abonos; editar datos, límite y quitar (borrado suave; sus ventas se conservan).
- **Validar**: cliente con 2 tickets fiados → *Abonar* 10 → el más antiguo queda pagado y el otro parcial; *Recordar por WhatsApp* abre el chat con el detalle.

### 14.4 Mercadería entregada (`/consign`)
- **Qué**: **Más → Mercadería entregada**. *Nueva entrega*: cliente + productos (escáner o búsqueda, con variantes) con cantidad y precio → **salen del estante** (movimiento «entregado a X») pero **siguen siendo tuyas**. En la ficha del cliente se ve lo que tiene. **Rendir cuentas**: por producto, cuánto **vendió** (se registra como venta a su nombre, cobrada o fiada) y cuánto **devuelve** (vuelve al estante); lo que falta sigue afuera hasta que se liquide todo. Historial de entregas liquidadas.
- **Validar**: entregar 5 unidades → el stock baja 5 y el cliente muestra «5 unid. entregadas»; rendir 3 vendidas + 1 devuelta → venta N.º nueva a su nombre, stock +1, queda 1 afuera.

### 14.5 Inicio
- **Qué**: la tarjeta *Ventas de hoy* muestra **«te deben Bs X»** cuando hay fiados y lleva a la pestaña *Deben*.

### 14.6 Pruebas
- `npm run test:e2e`: cliente con deuda en 2 tickets, abono aplicado a lo más antiguo, entrega con vendido/devuelto/afuera, movimiento enlazado a la entrega, pantallas. **53/53 en verde contra producción.**

---

## 2026-09-15 · Plan v3 · Fase 3 — Ventas para decidir

Migración `supabase/012_ventas.sql` aplicada: tickets (`sales`, `sale_items`), dinero de caja (`cash_movements`), cierres (`cash_closings`), movimientos de stock enlazados al ticket y número correlativo por negocio.

### 13.1 Vender (`/sell`)
- **Qué**: nueva pantalla **Vender** (Inicio, Inventario y Más → Del día a día): agrega productos **escaneando o buscando** (con «los más vendidos» a mano; si tiene variantes pregunta cuál), ajusta cantidades con +/−, cambia el precio por línea (y **Mayorista** a un toque si el producto lo tiene), descuento en Bs, **¿Cómo paga?** (Efectivo / QR / Transferencia) y **¿Paga todo ahora?** (Sí, todo / Una parte / Fiado, con el nombre de quién debe y cuánto paga ahora). Avisa si se vende por encima del stock. Al cobrar: ticket numerado, el stock baja producto por producto (o por variante) y queda un movimiento por línea enlazado al ticket. Pantalla final con el ticket en texto, **Enviar por WhatsApp**, Imprimir y Nueva venta.
- **Validar**: Vender → escanear 2 productos → cantidad 3 en uno → Efectivo → *Cobrar Bs X* → ventana de confirmación con el resumen → ticket N.º 1 con las líneas; el stock de esos productos bajó y en Ventas y movimientos aparece el ticket con su detalle.

### 13.2 Ganancia real
- **Qué**: cada línea guarda el **costo de compra vigente** al vender (`unit_cost`) y el ticket su `cost_total`; la ganancia deja de estimarse por stock: **Ganancia real = vendido − lo que te costó**, en Ventas y movimientos (por periodo), en cada ticket («gana Bs 5») y en la Caja. Si faltan costos de compra, lo dice.
- **Validar**: producto con precio de compra 10 y venta 12,50 × 2 → el ticket muestra «gana Bs 5».

### 13.3 Caja de hoy (`/cash`)
- **Qué**: **Vendido hoy** (con ganancia), **Cobrado** (y cuánto quedó fiado), lo cobrado **por cada medio de pago**, **dinero que salió o entró aparte** (retiros para gastos, cambio inicial), **efectivo que debería haber** = efectivo cobrado + ingresos − retiros, casilla para escribir **cuánto hay en la caja** con el veredicto (cuadra / de más / faltan) y **Cerrar caja de hoy** (uno por día; si vendes más después se vuelve a cerrar y se actualiza). Historial de cierres con si cuadró.
- **Validar**: anotar un retiro de Bs 5 → el efectivo esperado baja 5; escribir el efectivo contado → mensaje «Cuadra perfecto» o la diferencia; Cerrar caja → aparece en cierres anteriores.

### 13.4 Ventas y movimientos con tickets
- **Qué**: la pestaña **Ventas** muestra los tickets (N.º, hora, medio, estado, total y ganancia) y al tocar uno, sus líneas. Resumen: **Vendido**, **Ganancia real** y **Por cobrar** (fiadas o a medias). Las ventas rápidas hechas **sin conexión** (que no tienen ticket) se muestran aparte y se suman al total. Accesos a Vender y Caja.
- **Validar**: `/movements` → tocar un ticket → se despliegan sus productos.

### 13.5 +/− Stock «Sí, es una venta» pasa por el mismo camino
- **Qué**: la venta rápida desde la fila del producto crea un ticket de 1 línea (con número, costo y movimiento), así todo cuenta igual en Caja, ganancia y reportes. Sin conexión sigue guardándose en el celular y se envía al reconectar.
- **Validar**: +/− Stock → Restar → Sí, es venta → el aviso dice «Venta N.º N» y aparece en Ventas y movimientos.

### 13.6 Pruebas
- `npm run test:e2e`: tickets numerados por negocio, vendido/ganancia/por cobrar, movimiento enlazado al ticket, cierre único por día que se actualiza, pantallas Vender/Caja/Ventas. **45/45 en verde contra producción.**

Pendiente para la Fase 4: el fiado pasa a estar ligado a un **cliente** con saldo, abonos y recordatorio (hoy se guarda el nombre y lo pendiente por ticket).

---

## 2026-09-15 · Ajustes tras las pruebas funcionales (Fase 2)

### 12.11 Avisos de reposición configurables (Ajustes → Avisos)
- **Qué**: nueva pantalla **Ajustes → Avisos de reposición** (también en Más y desde «Por reponer»): (a) **General**: desde cuántas unidades avisar en todo el negocio y cuántos **días antes del vencimiento**; (b) **por categoría**: su propio mínimo y un interruptor para que esa categoría no avise; (c) **Por producto**: buscador con el mínimo de cada uno (vacío = el de su categoría) y su interruptor; (d) **Sin avisos**: lo silenciado, para reactivarlo. Ya no hay ningún número fijo: el 3 y los 30 días son solo el valor de partida.
- **Validar**: Ajustes → Avisos → poner «avisar desde 6» → Guardar; un producto con stock 5 pasa a «por reponer». Apagar el interruptor de una categoría → sus productos dejan de aparecer en Por reponer y en el Inicio.

### 12.12 Descartar deslizando (Por reponer y Por vencer)
- **Qué**: deslizar una fila **a la izquierda** la descarta (ese producto deja de avisar), con **Deshacer** en el aviso; en computadora hay una ✕ al pasar el ratón. Lo descartado queda en **Ajustes → Avisos → Sin avisos** para reactivarlo cuando se quiera.
- **Validar**: en Por reponer, deslizar una fila → desaparece y el aviso ofrece Deshacer; Ajustes → Avisos → Sin avisos → aparece ahí.

### 12.13 Toma de inventario: cámara y «Solo sin contar»
- **Qué**: **corregido** el fallo «No se pudo abrir la cámara» aun con permisos: se pedía la cámara antes de que existiera la vista de vídeo. Ahora el vídeo se prepara primero y, si algo falla, el mensaje dice la causa real (permiso bloqueado, sin cámara, cámara ocupada, sitio no seguro) con **Reintentar**. El botón «Solo sin contar» pasa a ser **«Ocultar los ya contados» / «Viendo solo los que faltan»** con el número y una frase que explica qué se está viendo.
- **Validar**: Toma de inventario → categoría → *Escanear para contar* → se abre la cámara y cada lectura suma 1; el botón de filtro explica qué muestra.

### 12.14 La IA lee la fecha de vencimiento del empaque
- **Qué**: en cada análisis la IA copia la fecha impresa («VENCE», «CAD», «EXP», «consumir antes de») y la app la normaliza: acepta `31/01/2027`, `01/2027`, `2027-01`, `ENE 2027`, `31 ene 27`; si solo hay mes y año usa el último día del mes; descarta lotes y fechas imposibles. Al **volver a analizar** solo se pone si el producto aún no tenía fecha (nunca pisa lo escrito a mano).
- **Validar**: foto de un envase con vencimiento impreso → en Revisar aparece «¿Vence? · ✨ leído del empaque» con la fecha.

### 12.15 «Sin fecha» para productos que no vencen
- **Qué**: junto al calendario, en **Revisar** y en la **ficha**, hay un botón **Sin fecha**: deja el producto como no perecedero y evita que se guarde una fecha por tocar el calendario sin querer. El texto de ayuda dice qué pasará en cada caso.
- **Validar**: abrir un producto → *Sin fecha* → guardar → no vuelve a aparecer en «Por vencer».

### 12.16 Ordenar y limpiar: datos que sobran
- **Qué**: además de pendientes viejos, categorías vacías y fotos sueltas, ahora detecta y limpia: **datos que nadie llena** (columnas definidas en una categoría con al menos 3 productos y siempre vacías → se borra la columna, no la información), **casillas vacías guardadas** dentro de los productos (ensucian el Excel y ocupan espacio) y **datos sueltos de otra categoría** (claves que quedaron al mover un producto, con su nombre y cuántos productos las tienen). Nunca se tocan nombre, precio, stock, costo ni código de barras.
- **Validar**: Inicio → Más herramientas → Ordenar y limpiar → marcar las tres filas nuevas → Limpiar; el Excel deja de traer columnas vacías y los formularios dejan de pedir datos que nadie usa.
- **Comprobado en producción**: 10/10 en la prueba automática (detección y limpieza, conservando lo que sí se usa).

---

### 12.24 El botón verde deja de tapar las listas (Contar, Nueva compra y el resto)
- **Qué**: el botón «pegado» seguía flotando sobre las últimas filas porque compartía el flujo de la página. Ahora es una **barra fija** sobre el menú inferior (móvil) y **cada pantalla reserva su altura** al final, así la última fila siempre queda visible por encima del botón. Aplica a *Terminar y corregir…* (Contar lo que tengo), *Registrar compra*, *Aplicar a N productos*, *Confirmar y pasar al siguiente* y *Guardar cambios*. En computadora se mantiene el botón al final del contenido.
- **Validar**: en *Contar lo que tengo*, bajar hasta el final de una categoría larga → la última fila se ve completa encima del botón verde.

### 12.25 Ventanas de confirmación con el diseño de la app
- **Qué**: se sustituyen todos los avisos grises del navegador por una **ventana propia**: título en pregunta, explicación en una frase, **resumen en filas** cuando hay cifras (p. ej. al terminar un conteo: productos contados, coinciden, falta mercadería, hay de más, diferencia total) y botón de color según lo que se hace (verde para confirmar, rojo para borrar). Está en: terminar o abandonar un conteo, registrar o abandonar una compra, quitar proveedor, cambiar precios, papelera (borrar uno / vaciar), enviar a la papelera, eliminar pendiente, volver a analizar con IA, Ordenar y limpiar, quitar variante o eje, quitar la clave de IA, cancelar el lote de fotos, quitar un dato y eliminar categoría.
- **Validar**: Contar lo que tengo → escribir un contado distinto → *Terminar y corregir* → aparece la ventana con el resumen (coinciden / falta mercadería / hay de más) y los botones *Sí, corregir N* / *Seguir contando*.

### 12.26 Mi tienda: el nombre de la categoría ya no queda tapado
- **Qué**: en el celular, el botón **Eliminar** se superponía al nombre. Ahora es un icono de papelera alineado a la derecha (con texto solo en computadora) y el nombre ocupa su espacio, con un lápiz que indica que se puede renombrar.
- **Validar**: Ajustes → Mi tienda → los nombres largos se leen completos y la papelera queda a la derecha.

---

### 12.21 Ficha del producto en el celular: mínimo y vencimiento
- **Qué**: el campo del mínimo ocupaba toda la columna y empujaba el botón **Sin fecha** fuera de la pantalla. Ahora se lee como una frase —**«Avisarme cuando queden [ 3 ] unidades o menos»** con casilla estrecha— y la fecha con su botón **Sin fecha** se acomodan solos (se apilan si no caben). Nada se sale del borde.
- **Validar**: en el celular, abrir un producto → poner una fecha de vencimiento → el botón *Sin fecha* sigue visible y se puede tocar.

### 12.22 Código de barras del producto, con la cámara
- **Qué**: la IA no siempre puede leer el código en la foto, así que la ficha tiene ahora el campo **Código de barras** con botón **Escanear**: abre la cámara, lee el código y lo deja escrito (se confirma al Guardar). Si la categoría ya tenía ese dato, deja de aparecer duplicado en la lista de datos. Con el código guardado, el escáner y el conteo reconocen el producto al instante.
- **Validar**: abrir un producto sin código → *Escanear* → apuntar al envase → el código aparece en el campo → *Guardar cambios*; escanear ese producto en *Escanear un código* lo encuentra.

### 12.23 Contar lo que tengo: códigos nuevos y productos sin categoría
- **Qué**: al contar, si el código leído **no es de ningún producto de esa categoría**, la app ya no se limita a decir «no está»: si el código pertenece a otro producto del inventario lo dice con su nombre, y si es nuevo pregunta **«¿de qué producto es?»** con un buscador; al elegirlo, **guarda el código para siempre** y suma 1. Arriba se avisa cuántos productos de la categoría aún no tienen código. Además hay una opción **«Sin categoría»** para contar los productos que la IA no llegó a ubicar.
- **Validar**: Más → *Contar lo que tengo* → una categoría → escanear un producto sin código → elegirlo en la lista → queda contado y el código guardado; volver a escanearlo suma directo.

---

### 12.17 Menú «Más»: se abría mal y hablaba en técnico
- **Qué**: en el celular el panel crecía más que la pantalla, así que la primera opción quedaba **debajo de la barra del navegador** y la barra de desplazamiento mostraba un recorrido que no existía. Ahora es una hoja inferior con **cabecera fija y su propio desplazamiento** (máx. 82 % de la pantalla, con espacio para la barra de abajo); en computadora el desplegable también tiene su scroll. Además las opciones están **agrupadas** y explicadas en lenguaje cotidiano: *Del día a día* (Escanear un código · Ventas y movimientos · Qué falta y qué caduca), *Ordenar el inventario* (Anotar una compra · Contar lo que tengo · Cambiar precios · Descargar en Excel), *Configurar* (Mi tienda · Cuándo avisarme · Ajustes) y *Ayuda* (Guía paso a paso · Ordenar y limpiar · Cómo usar la herramienta).
- **Validar**: en el celular, tocar **Más** → se ve el título «Más opciones» y la primera opción completa; la lista se desplaza dentro del panel y la última opción es accesible.

### 12.18 El botón verde ya no tapa la lista
- **Qué**: la acción principal fija (p. ej. *Terminar y corregir…* al contar, *Registrar compra*, *Aplicar a N productos*, *Guardar cambios*) tenía fondo degradado y dejaba ver el contenido por debajo, dando sensación de solapamiento. Ahora tiene **fondo sólido, línea superior y sombra**, y está separada del contenido; al llegar al final de la lista, la última fila queda por encima del botón.
- **Validar**: en *Contar lo que tengo*, desplazar una categoría larga → el botón se ve nítido sobre la lista y no se lee texto detrás.

### 12.19 «Deslizar para quitar el aviso» ahora se ve
- **Qué**: en *Qué falta y qué caduca* aparece una tarjeta con el gesto animado —«¿Alguno no te interesa? Desliza esa fila hacia la izquierda…»— y la **primera fila muestra sola** el fondo oscuro «No avisar» un momento al abrir, para que el gesto se entienda sin leer. El fondo del deslizamiento es más ancho y legible, y el enlace lleva a *Cuándo avisarme* para reactivar lo descartado.
- **Validar**: abrir *Qué falta y qué caduca* → se ve la tarjeta con el dedo animado y la primera fila insinúa el gesto.

### 12.20 «Contar lo que tengo» en lenguaje de tienda
- **Qué**: la pantalla se llama **Contar lo que tengo** (antes «Toma de inventario») y todos sus textos explican lo que pasa: «Revisa cuántas unidades hay de verdad en el estante. Si no coincide con lo que dice la app, se corrige al instante y queda anotado»; en cada fila «La app dice 8 · faltan 2» / «hay 1 de más»; la casilla pide «¿cuántos?»; el botón dice **Terminar y corregir N productos**; el historial es «Veces que contaste» con «todo coincidía» o «3 corregidos». Desaparecen «acta», «esperado», «ajuste» y «sistema».
- **Validar**: Más → *Contar lo que tengo* → los textos se entienden sin explicación previa.

---

## 2026-09-15 · Plan v3 · Fase 2 — Control real de stock

Migración `supabase/010_control_stock.sql` aplicada: mínimos y vencimientos, papelera, proveedores y compras, toma de inventario, historial de precios; la vista `product_summaries` excluye la papelera y expone mínimo, vencimiento, precio mayorista y unidades por paquete.

### 12.1 Stock mínimo y «por reponer»
- **Qué**: cada producto (ficha → **Stock mínimo**) y cada variante puede tener su mínimo; si está vacío se usa el de la categoría (**Mi tienda → Stock mínimo por defecto**) y si no, 3. «Por reponer» = stock ≤ mínimo (incluye agotados). Se ve en la fila del producto («por reponer · mín. 5»), en el filtro **Por reponer** de la categoría, en las alertas de cada estante, en la tarjeta **Por reponer** de Mi inventario y en el Inicio.
- **Validar**: poner mínimo 5 a un producto con stock 4 → aparece «por reponer» en su fila y cuenta en Mi inventario; subir el stock a 6 → desaparece.

### 12.2 Lista de reposición (`/restock`)
- **Qué**: **Más → Por reponer y por vencer**: todo lo que está bajo su mínimo (por producto y por variante), agrupado por último proveedor, con la cantidad sugerida (repone hasta el doble del mínimo, editable). **Compartir pedido por WhatsApp** (texto listo, total o por proveedor) o **Excel**. Pestaña **Por vencer** con los que vencen en ≤ 30 días o ya vencieron, con los días y el valor en juego.
- **Validar**: con 2 productos bajo mínimo → la lista los muestra; cambiar la cantidad → el texto de WhatsApp la respeta.

### 12.3 Vencimientos
- **Qué**: ficha → **Vence el** (fecha) y también al registrar una compra. Aviso en la fila («vence en 12 d», «vencido hace 3 d»), filtro **Por vencer** en la categoría, alerta en el estante, y el Inicio lo pone como primera tarea cuando hay algo por vencer.
- **Validar**: poner una fecha a 5 días → fila en rojo, Inicio dice «1 producto por vencer».

### 12.4 Compras y proveedores (`/purchases`)
- **Qué**: **Más → Compras y proveedores**. **Nueva compra**: proveedor (existente o nuevo con teléfono), nº de factura opcional, productos por búsqueda o **escáner** (+1 por lectura; con variantes pregunta cuál), cantidad, costo unitario (precargado con el último) y vencimiento. Al registrar: sube el stock (producto o variante), guarda el **precio de compra** (con historial), el vencimiento, y un movimiento «entrada · compra · proveedor» enlazado a la compra. Pestaña **Proveedores** para agregar/quitar (teléfono abre WhatsApp).
- **Validar**: Nueva compra → proveedor nuevo → escanear 2 productos → cantidad 6 y costo 4,50 → Registrar → stock +6, ficha con costo 4,50 e historial «compra», y la compra en la lista con su total.

### 12.5 Toma de inventario (`/count`)
- **Qué**: **Más → Toma de inventario**: elegir categoría → lista de productos (y variantes) con lo que dice el sistema; escribir el contado o **escanear cada unidad** (+1 por lectura); «Solo sin contar»; diferencia y motivo por fila (conteo, merma, robo, error, devolución). **Cerrar conteo** ajusta solo lo que difiere (movimiento «ajuste» con motivo y enlace al conteo) y deja el acta (productos contados, diferencias, unidades). Historial de conteos.
- **Validar**: contar una categoría de 5 productos con 1 diferencia → al cerrar, ese producto queda con el contado, aparece un movimiento «ajuste» y el conteo figura en el historial con «1 ajustado».

### 12.6 Cambiar precios (`/prices`)
- **Qué**: **Más → Cambiar precios**: categoría (o todo), precio de venta o mayorista, **porcentaje / monto fijo / margen sobre el costo**, redondeo a 0,50 · 1 Bs · sin redondear, vista previa (antes → después) y aplicar. Cada cambio queda en **Historial de precios** (ficha), igual que los cambios hechos en la ficha o por compra.
- **Validar**: Ropa +10 % redondeado a 0,50 → la vista previa muestra 35 → 38,50; aplicar → fichas actualizadas con historial «masivo».

### 12.7 Paquetes
- **Qué**: si el producto tiene «unidades por paquete» (p. ej. 12), **+/− Stock** ofrece «1 paq. = 12» y «2 paq. = 24»; el stock se lleva siempre por unidad.
- **Validar**: producto con unidades_por_paquete 6 → en +/− Stock aparecen los chips de paquete.

### 12.8 Papelera (`/trash`)
- **Qué**: eliminar un producto del inventario lo envía a la **papelera** (recuperable 30 días, con foto; «Deshacer» en el aviso); desaparece del inventario, Excel, escáner, conteos y estadísticas. **Ordenar y limpiar → Papelera** lista lo eliminado con los días restantes: **Recuperar**, borrar uno o **Vaciar papelera**. Lo que supera 30 días se borra solo (con su foto). Los pendientes sin confirmar se siguen borrando directo.
- **Validar**: eliminar un producto → ya no está en el inventario; Ordenar y limpiar → «1 en la papelera» → Papelera → Recuperar → vuelve intacto.

### 12.9 Despliegue: pantallas estáticas (límite de 25 MiB de Cloudflare)
- **Qué**: al añadir las pantallas de esta fase, el Worker llegó a 32 MB y Cloudflare rechazó el despliegue (límite 25 MiB): cada ruta dinámica cargaba su propia copia del runtime de Next (~1,36 MB × 22 rutas). La capa `(app)` era dinámica solo por una comprobación de sesión **redundante con el middleware**, así que ahora se sirve **estática**: quedan 4 funciones (`/`, `/auth/confirm`, `/products/[id]`, `/products/c/[id]`) y las de API. **Worker: 32 MB → 4,8 MB.** Además, la librería de Excel (7 MB) se carga solo al pulsar Excel, no en el bundle del servidor.
- **Seguridad**: sin cambios de fondo. El middleware sigue validando al usuario contra Supabase en cada petición (sin sesión, `/products` → 307 a `/login`), RLS protege los datos y las páginas estáticas no contienen datos de nadie; `AuthGuard` redirige en el navegador si la sesión caduca.
- **Validar**: abrir cualquier pantalla con sesión → carga normal; cerrar sesión y abrir `/products` → va a login. Las 17 pantallas responden 200 en producción.

### 12.10 Pruebas
- `npm run test:e2e` ampliado: mínimo en la vista, papelera excluida y contada por Ordenar y limpiar, recuperación, compra con proveedor (stock, costo, vencimiento, movimiento enlazado), acta de conteo. **37/37 en verde contra producción.**
- Prueba de pantallas en producción: las 17 responden 200 con sesión y `/products` redirige a login sin ella.

---

## 2026-09-15 · Plan v3 · Fase 1 — Cerrar la promesa central

### 11.1 ¿Ya lo tienes? (duplicados al analizar)
- **Qué**: al analizar una foto, el servidor compara el resultado con el inventario (y los pendientes): mismo **código de barras**, mismo **nombre** o **nombre muy parecido** (≥ 60 % de palabras en común y misma marca si ambas existen) → `ai_meta.posible_duplicado`. En Revisar aparece el aviso ámbar «¿Es el mismo producto que ya tienes?» con **Sí, sumar N al stock** (suma el stock del pendiente al producto existente, registra una entrada «foto repetida», borra el pendiente y su foto) o **No, es otro** (quita el aviso). Si el existente tiene variantes, se descarta el pendiente y se ofrece abrir su ficha para sumar en la casilla correcta.
- **Validar**: fotografiar dos veces el mismo producto → en el segundo pendiente sale el aviso con el nombre del primero; «Sí, sumar» deja el stock sumado y un solo producto.

### 11.2 La IA aprende de lo que confirmas
- **Qué**: cada análisis (y re-análisis) incluye en el prompt hasta 8 productos ya confirmados por el usuario con su ubicación («Ropa > Dama → «Polera básica Adidas» (marca Adidas)», máx. 2 por subcategoría, los más recientes) como ejemplos de estilo. Sin entrenamiento ni coste extra.
- **Validar**: tras confirmar varios productos escribiendo la marca de cierta forma, los nuevos análisis imitan ese estilo de nombre y ubican productos parecidos en la misma subcategoría.

### 11.3 Foto de estante → varios productos
- **Qué**: en **Agregar**, nueva opción **Foto de estante · varios productos** (1 análisis). `POST /api/detect` pide a la IA los productos distintos visibles con su recuadro; la app muestra la foto con los recuadros numerados y una lista con casillas (todos marcados). Al confirmar, cada producto marcado se **recorta** (con 6 % de margen) y se **encola como foto individual**, que se analiza como siempre (1 análisis por producto). No se crea nada sin confirmar.
- **Validar**: Agregar → Foto de estante → foto de una repisa con 5 productos → se ven 5 recuadros; desmarcar 1 → «Agregar 4 productos a la cola» → aparecen 4 pendientes en Revisar.

### 11.4 Clave de IA propia (BYOK)
- **Qué**: **Ajustes → Clave de IA propia**: el usuario pega su clave de Google Gemini (con instrucciones en 3 pasos). El servidor la comprueba contra Google, la guarda **cifrada** (AES-GCM con `KEY_ENCRYPTION_SECRET`, tabla `ai_keys` sin acceso desde el cliente) y desde entonces todos los análisis (foto, re-análisis, categoría con IA, clasificación, detección) usan esa clave. El **medidor** muestra «con tu clave propia» y cuenta solo su consumo (`ai_usage.own_key`), sin tocar el cupo compartido; el cupo agotado se lleva por clave. Se puede quitar en cualquier momento. Acepta el formato nuevo de claves (con punto).
- **Validar**: Ajustes → Usar mi propia clave → pegar una clave inválida → error claro; pegar la real → «Usando tu clave (…últimos 4)»; Inicio → el medidor dice «con tu clave propia» y parte de 0.

### 11.5 Sin conexión
- **Qué**: **Mi inventario** y cada **categoría** guardan una copia en el celular (IndexedDB); sin red se muestran con el aviso «Sin conexión · datos guardados a las HH:MM». **+/− Stock** sin red (o si la red falla a mitad) guarda el movimiento en el celular con aviso; al reconectar (o al abrir la app) se envía aplicando el cambio sobre el **stock real de ese momento** (no pisa cambios hechos desde otro celular) y registra el movimiento con su hora original. Barra superior mientras hay cambios pendientes.
- **Validar**: abrir Inventario, activar modo avión, recargar → se ve el inventario con el aviso; hacer +/− Stock → «guardado en el celular»; quitar modo avión → aviso «1 cambio… ya se enviaron» y el stock actualizado.

### 11.6 Pruebas
- `npm run test:e2e` ampliado: duplicado detectado en la segunda foto, `/api/detect` devuelve productos sin crear nada, clave inválida rechazada, clave válida guardada cifrada, medidor con cupo propio y consumo marcado `own_key`, clave quitada. **31/31 en verde contra producción.**

---

## 2026-09-15 · Plan v3 · Fase 0 — Cierre del Plan v2 y correcciones

### 10.1 Pruebas e2e con variantes y escáner
- **Qué**: `npm run test:e2e` ahora sigue hasta el final del flujo: instala el catálogo Ropa (ejes Talla + Color), crea un producto con 3 variantes, comprueba el stock derivado, consulta `/api/barcode` con el código de una variante (devuelve producto + variante), con el código del producto (devuelve la lista para elegir) y con uno desconocido; registra una venta por variante y verifica el total, el movimiento y que el stock manual no pise la suma; y que un producto sin variantes siga editable a mano. 22 comprobaciones.
- **Validar**: `BASE_URL=https://inventaria.pages.dev npm run test:e2e` → «Todo OK».

### 10.2 Inventario ligero (paginación real)
- **Qué**: nueva vista `product_summaries` en la base (`supabase/008_product_summaries.sql`, aplicada) con nombre, marca, precio, costo, stock y código ya resueltos (funciones `jkey` y `safe_num`, sin importar mayúsculas ni comas decimales) y un campo `search`. **Mi inventario** (estantes) y el **Inicio** leen solo esa vista (≈ la mitad de bytes hoy; 3–5× menos con descripciones reales). La **búsqueda** se hace en el servidor (nombre, marca, descripción, etiqueta, código) con espera de 250 ms y máximo 40 resultados. Dentro de una **categoría** se cargan los resúmenes de toda la categoría (chips, filtros y conteos siguen exactos) y las **filas completas solo de la página visible** (40, luego «Ver más»); el Excel de la categoría descarga las filas completas al momento de exportar.
- **Validar**: Inventario → los estantes muestran las mismas cifras que antes; buscar «taza» encuentra por nombre, marca o etiqueta; entrar a una categoría con más de 40 productos → «Ver más» carga el resto; filtros Agotados / Sin precio siguen contando sobre toda la categoría.
- **Verificado**: la vista coincide fila por fila con la tabla `products` para los datos actuales (0 diferencias).

### 10.3 Pendiente de esta fase
- Correcciones de las pruebas funcionales del usuario (lista abierta en `docs/PLAN_V3.md`, Fase 0).

---

## 2026-09-15 · Plan v2 · Fase 3 — Rediseño secuencial

> Cambia el **orden**, no el estilo: tres pasos con barra fija, una sola acción principal por pantalla, menú de 3 + Más, Inicio «Hoy» y modo asistido para nuevos usuarios. Se conservan la paleta índigo, la tipografía y los componentes.

### 9.1 Barra de pasos ① Agregar → ② Revisar → ③ Inventario
- **Qué**: en todas las pantallas del flujo (Agregar, Escanear, Alta a mano, Revisar, Inventario, ficha, Ventas) hay una barra arriba con los tres pasos: **hecho ✓** (verde), **actual ●** (índigo) y **siguiente ○**; el contador de pendientes va en ② y el de fotos analizándose en ①. Cada paso es un enlace.
- **Validar**: abrir Agregar → la barra marca ① en índigo; tomar una foto → ① muestra el contador ámbar; ir a Revisar → ② en índigo con el número de pendientes; confirmar todo → ② queda con ✓.

### 9.2 Menú de 3 + Más
- **Qué**: barra inferior con **Inicio · Revisar (con contador) · Agregar (cámara, centro) · Inventario · Más**. En **Más** viven: Escanear código, Ventas y movimientos, Exportar a Excel, Mi tienda, Guía paso a paso, Ordenar y limpiar, Ajustes y **Cómo usar la herramienta** (recorrido de 3 pantallas). Mantener pulsado Agregar sigue abriendo Cámara/Galería. En escritorio: Inicio · Agregar · Revisar (N) · Inventario · Más ▾ (desplegable).
- **Validar**: en el celular, tocar **Más** → se despliega el panel con las 8 opciones y se cierra al elegir una o tocar fuera. Con pendientes, «Revisar» muestra la bolita roja con el número.

### 9.3 Inicio «Hoy»
- **Qué**: la pantalla de inicio responde una sola pregunta, **¿Qué hay que hacer hoy?**, con una tarjeta de color y un único botón que cambia según el estado: fotos analizándose → *Ver el avance*; pendientes → *Revisar ahora*; sin categorías → *Elegir mis categorías*; sin productos → *Tomar la primera foto*; agotados → *Ver agotados*; todo al día → *Agregar productos*. Debajo, los tres pasos con estado; 4 números de hoy (En inventario, Por revisar, Ventas de hoy, Por atender) que son enlaces; 3 accesos (Agregar, Escanear, Inventario). La guía, el consumo de IA, Ordenar y limpiar, Exportar y Ajustes quedan plegados en **Más herramientas** (los enlaces de Más → Guía / Limpiar la abren directo).
- **Validar**: con 2 pendientes, Inicio muestra «2 productos por revisar» y el botón *Revisar ahora*; al confirmarlos y volver, la tarjeta cambia. «Más herramientas» despliega guía, IA y limpieza.

### 9.4 Una acción principal, fija abajo
- **Qué**: en Revisar, **Confirmar y pasar al siguiente** queda fijo sobre la barra inferior mientras se desplaza la tarjeta; en la ficha, **Guardar cambios** / **Guardar en el inventario** igual. Lo secundario sigue con borde debajo y lo destructivo en rojo con texto.
- **Validar**: en Revisar, desplazar hacia abajo una tarjeta larga → el botón verde permanece visible abajo.

### 9.5 Modo asistido (burbujas de ayuda)
- **Qué**: burbujas violetas **💡** en Agregar, Escanear, Revisar, Inventario y ficha, con una frase de qué hacer. Aparecen las **primeras 3 veces** que se abre cada pantalla y desaparecen (o antes, con la ✕ «Entendido»). En Ajustes → Ayuda: **Reactivar burbujas de ayuda**.
- **Validar**: abrir Agregar 3 veces → a la 4.ª ya no sale la burbuja; Ajustes → Reactivar → vuelve.

### 9.6 Recorrido «Cómo usar la herramienta» (una sola vez)
- **Qué**: al entrar por primera vez tras esta versión se abre un recorrido de 3 pantallas: **Un camino de 3 pasos**, **Menú más simple** y **Variantes con stock propio**, con mini-ilustraciones. Se puede saltar y reabrir desde **Más → Cómo usar la herramienta** o Ajustes → Ayuda.
- **Validar**: la primera vez aparece el recorrido; tras «Empezar» no vuelve; Más → Cómo usar la herramienta lo reabre.

### 9.7 Textos y guía al nuevo orden
- **Qué**: la guía paso a paso y «¿Qué quieres hacer?» usan el vocabulario fijo (Categoría, Subcategoría, Variante, Pendiente, En inventario, Agotado) y las rutas nuevas (Más → Mi tienda, ② Revisar, +/− Stock). Dos preguntas nuevas: *Registrar una venta o reponer stock* y *Manejar tallas o colores (variantes)*. Ajustes lista también Revisar y Escanear.
- **Validar**: Inicio → Más herramientas → Paso a paso → los pasos mencionan la barra de pasos y «Más → Mi tienda».

---

## 2026-09-14 · Plan v2 · Fase 2 — Variantes (talla, color, edad…)

> Fase 1 (inventario visual) cerrada y validada. Esta fase agrega **variantes con stock propio**: «Polera · M · Rojo» tiene su stock y su código; el producto agrupa, la variante cuenta. Un producto sin variantes se comporta exactamente como antes.

### 8.1 Base de datos (`supabase/007_variantes.sql`, ya aplicada)
- **Qué**: tablas `variant_axes` (qué varía en cada categoría principal: hasta 3 ejes con opciones) y `product_variants` (una fila por combinación: valores, etiqueta, stock, precio propio, costo, código de barras). `stock_movements` gana `variant_id` y `variant_label`. RLS por usuario. **El stock del producto es siempre la suma de sus variantes**: dos disparadores lo recalculan al crear/editar/borrar una variante y bloquean cualquier intento de escribirlo a mano (tabla, ficha, escáner). El código de barras es único entre variantes; la misma combinación no se puede repetir.
- **Validar**: `npm run test:variants` → 10 comprobaciones en verde (suma, guardia, venta, código repetido, combinación repetida, borrado en cascada).

### 8.2 Ejes por categoría (Mi tienda)
- **Qué**: en **Ajustes → Mi tienda**, cada categoría tiene el bloque violeta **Variantes**: agrega ejes desde la biblioteca (Talla, Talla número, Color, Edad, Sabor, Tamaño, Volumen, Material, Modelo) o uno propio; edita sus opciones (coma) o quítalo. Los catálogos Ropa (Talla + Color), Calzado (Talla numérica + Color) y Juguetería (Edad) traen sus ejes al instalarse; si la categoría ya existía aparece **Sugerido: + Talla + Color** para agregarlos de un toque. En Ropa/Calzado la talla deja de ser un dato del producto: ahora es un eje.
- **Validar**: Mi tienda → Ropa → «Sugerido: Talla, Color» → tocar ambos → quedan listados con sus opciones; tocar «Talla» permite editar las opciones.

### 8.3 Foto + IA: variantes propuestas
- **Qué**: la IA devuelve además `variantes_propuestas` con lo que **se ve** en la foto («talla: S, M, L; color: rojo, azul»), sin inventar. Se guarda en `ai_meta` y solo es una propuesta: nada se crea hasta que el usuario confirma. También al volver a analizar.
- **Validar**: foto de una etiqueta con varias tallas → en Revisar, el bloque de variantes dice «✨ la IA vio S, M, L» y esas casillas aparecen resaltadas en violeta.

### 8.4 Revisar: «¿Viene en varias tallas / colores?»
- **Qué**: si la categoría elegida tiene ejes, aparece el bloque violeta con dos botones: **Sí, tiene variantes** / **No, es único**. Con «Sí»: chips por eje (las que vio la IA vienen marcadas; «+ Otra» para escribir una nueva) y la **cuadrícula** filas = 1er eje, columnas = 2º eje (pestañas para un 3º). Se escribe el stock por casilla; **las casillas vacías no se crean**. El campo Stock pasa a mostrar la suma. Sigue habiendo un solo botón: **Confirmar y pasar al siguiente**. Si la categoría no tiene ejes pero la IA vio variantes, un aviso lleva a Mi tienda.
- **Validar**: Revisar un producto de Ropa → «Sí, tiene variantes» → marcar S, M, L y Rojo, Azul → escribir 3, 2, 0 en tres casillas → Stock total 5 en 3 variantes → Confirmar → en la ficha aparece la cuadrícula con 3/2/0 (la de 0 en rojo, «Agotado: L · Azul»).

### 8.5 Ficha del producto: cuadrícula viva
- **Qué**: bloque **Variantes** con la cuadrícula: tocar una casilla abre **+/− Stock** para esa variante (venta o retiro con su precio); tocar «+» en una casilla vacía crea la variante y pide cuántas hay. Se pueden agregar tallas/colores nuevos con «+ Otra» y quitar filas/columnas. «Precio y código de barras por variante» permite precio propio (vacío = el del producto), código y quitar la variante. Los últimos movimientos muestran la variante. El campo Stock del formulario es de solo lectura (suma) cuando hay variantes.
- **Validar**: ficha → tocar la casilla «M · Rojo» → Restar 1 → Sí, es venta → Confirmar → la casilla baja, el stock total baja y `/movements` muestra «Polera · M · Rojo».

### 8.6 Inventario: resumen y alertas por variante
- **Qué**: en la lista de una categoría cada fila muestra «3 variantes · Talla: S, M, L · Color: Rojo» y una etiqueta roja «N variantes agotadas». El botón **+/− Stock** de la fila pregunta primero **¿Cuál variante?**. El filtro **Agotados** incluye productos con alguna variante en 0. En los estantes (Mi inventario) y en «Por atender» se cuentan las **variantes agotadas** aunque el producto aún tenga stock.
- **Validar**: Inventario → Ropa → la fila de la polera muestra el resumen y «1 variante agotada»; filtro Agotados la incluye; Mi inventario → tarjeta Ropa muestra «1 variante agotada».

### 8.7 Escáner por variante
- **Qué**: un código de barras puede pertenecer a una variante. Al escanear: si el código es de una variante, suma directo a ella (+1/+5/+10) y registra la entrada; si el código es del producto (o nuevo) y el producto tiene variantes, pregunta **¿a cuál pertenece?** y **guarda el código en esa variante** para la próxima vez. En lote continuo cada fila con variantes tiene un selector «Variante: ¿cuál?» y no se da de alta hasta elegirla.
- **Validar**: Escanear un código → «Ya está en tu inventario» → elegir «M · Rojo» → +5 → aviso «+5 a M · Rojo · código guardado»; volver a escanear el mismo código → ya viene con la variante elegida.

### 8.8 Excel por variante
- **Qué**: en Exportar y en «Excel de esta categoría», los productos con variantes salen **una fila por variante** con columnas **Variante**, **Talla**, **Color**… (según los ejes), su stock, su precio propio si lo tiene y su código de barras. Se agrega la hoja **Resumen** (producto, variantes, detalle «M · Rojo (5)», agotadas, stock total, valor de venta).
- **Validar**: Exportar → abrir el .xlsx → la polera ocupa 3 filas con Talla/Color y stock por fila; hoja «Resumen» al final.

### 8.9 Ventas y movimientos
- **Qué**: cada movimiento guarda la variante; la lista y «Más vendidos» la muestran («Polera · M · Rojo»).
- **Validar**: `/movements` → una venta hecha desde la cuadrícula aparece con la variante en violeta.

---

## 2026-09-14 · Inventario visual, ventas y escáner

### 7.1 Tarjetas del inventario: sin desborde en el celular (causa raíz)
- **Qué**: las tarjetas de **Mi inventario** (estantes por categoría y resultados de búsqueda) se salían de la pantalla porque la cuadrícula no tenía columna definida en móvil y un texto largo sin cortes (nombre de categoría, lista de subcategorías) la ensanchaba. Ahora todas las cuadrículas de una columna lo declaran (`grid-cols-1`) y hay una salvaguarda global: ningún elemento de una cuadrícula puede ser más ancho que su columna (texto largo se corta con "…"). Verificado con captura real a 360 px y 390 px.
- **Validar**: en el celular, Inventario → las tarjetas de categoría y las de productos (dentro de una categoría) terminan antes del borde derecho, con sombra y esquinas visibles; no hay scroll horizontal. Buscar un producto de nombre largo → la fila se corta con "…".

### 7.7 Escritorio a pantalla completa y tarjetas de categoría con más información
- **Qué**: en computadora la app usa **todo el ancho** (barra superior y contenido); Mi inventario muestra los estantes en 2/3/4 columnas según la pantalla, la categoría en 2–3 columnas de filas y Ventas en 2 columnas. El resumen general ahora tiene 6 tarjetas: Productos, Unidades (con cuántos tienen poco stock), Valor de venta, **Ganancia estimada** (venta − costo, si hay precio de compra), **Por atender** (agotados + sin precio) y Ventas este mes. Cada tarjeta de categoría muestra: unidades, valor de venta, ganancia o productos con poco stock (≤3 unid.), alertas (agotados, poco stock, sin precio, sin foto), **subcategorías como chips con su conteo** (hasta 6, luego "+N"), **último agregado** ("hoy", "ayer", "hace 3 días") y el **producto con más valor en stock**. En móvil se mantiene el diseño de una columna.
- **Validar**: en la computadora, Inventario → sin márgenes vacíos a los lados; con pantalla ancha las categorías se ven en 3 o 4 columnas y cada tarjeta muestra cifras, chips de subcategorías y el pie con "Último agregado". En el celular todo sigue en una columna sin desborde.

### 7.2 Un solo botón para crear categoría con IA (Revisar)
- **Qué**: cuando el producto no encaja en ninguna categoría, hay un único botón **Crear categoría y subcategoría con IA**: crea la categoría con sus subcategorías (incluida la que la IA sugirió para este producto) y **asigna el producto automáticamente**; se puede cambiar con *Cambiar*.
- **Validar**: Revisar → producto sin categoría → tocar el botón → el producto queda en *Categoría › Subcategoría* y el aviso lo indica.

### 7.3 Inventario: una fila por producto, atajo +/− Stock y ventas
- **Qué**: dentro de una categoría cada producto ocupa una fila (foto, nombre, subcategoría, precio, stock, datos en cuadrícula con "Ver N datos más"). Botón **+/− Stock: sumar, vender o retirar** → al restar pregunta **¿Es una venta?**: *Sí* registra la venta (precio, total → ingresos); *No* solo resta (motivo). Nuevo panel **Ventas y movimientos** (`/movements`) con periodos, ingresos, más vendidos y lista; tarjeta **Ventas este mes** en Mi inventario. Tabla `stock_movements` (SQL `supabase/006_stock_movements.sql`, ya aplicado).
- **Validar**: Inventario → categoría → **+/− Stock** en un producto → Restar → 2 → Sí, es venta → Confirmar; Mi inventario muestra el monto en *Ventas este mes* y `/movements` lista la venta.

### 7.4 Plan v2 · Fase 1: inventario visual
- **Qué**: Mi inventario muestra **estantes por categoría** (totales, unidades, valor de venta, alertas de agotados / sin precio / sin foto, subcategorías con conteo), búsqueda global y, al entrar, chips de subcategorías + filtros *Agotados / Sin precio / Sin foto / Agregados hoy* + Excel de esa categoría.
- **Validar**: Inventario → tocar una categoría → chips de subcategorías filtran la lista; *Excel de …* descarga solo lo visible.

### 7.5 Escáner de código de barras (sin IA)
- **Qué**: `/scan` lee códigos con la cámara; si el producto ya existe lo muestra (con +/− Stock); si no, busca en 4 catálogos públicos (Open Food/Beauty/Products/Pet Food Facts), trae foto y categoría sugerida y lo da de alta **sin consumir análisis de IA**. Modo continuo para lotes, **beep + destello verde + pausa de 1,5 s** tras cada lectura; un mismo código se repite solo tras 4 s.
- **Validar**: Agregar → *Escanear código* → apuntar a un envase → suena el beep y aparece la ficha; segundo escaneo del mismo código en <4 s se ignora.

### 7.6 Botones con voz, re-análisis, limpieza e Inicio
- **Qué**: textos de acción explícitos en Revisar / Agregar / detalle / tabla ("Confirmar y pasar al siguiente", "Guardar y seguir", etc.); al guardar vuelve con aviso *Cambios guardados*; **Volver a analizar con IA** en el detalle (mantiene lo editado a mano, opción de conservar categoría); tarjeta **Ordenar y limpiar** en el Inicio (borradores viejos, subcategorías vacías, fotos huérfanas) y accesos **Exportar** / **Ajustes** visibles.
- **Validar**: Inicio → *Ordenar y limpiar* muestra conteos y ejecuta cada acción con confirmación; detalle de producto → *Más opciones* → *Volver a analizar*.

---

### 5.2 Editar producto: botones centrados y sin desborde (móvil)
- **Qué**: en el detalle del producto los botones se apilan a lo ancho (acción principal grande arriba: *Guardar en inventario* o *Guardar cambios*; debajo *Guardar sin confirmar* / *Pasar a pendientes* y *Eliminar*). La tarjeta va centrada (ancho máximo cómodo) y no puede desbordar la pantalla. En escritorio quedan en una fila.
- **Validar**: Inventario → abrir un producto en el celular → todos los botones se ven completos, centrados y sin scroll horizontal.

### 5.3 Carga por lotes
- **Qué**: además de "Galería → varias a la vez" (ya existía), en escritorio hay una zona para **arrastrar y soltar** muchas fotos o **elegir una carpeta entera**; hasta 300 fotos por lote. Las fotos se preparan en tandas de 4 y se encolan en cuanto están listas (la IA empieza sin esperar al lote completo). Barra **"Lote: 37 de 100 listas · ≈ 3 min restantes"**.
- **Validar**: en la computadora, Agregar → arrastra 10 fotos a la zona punteada → aparece la barra de lote y las miniaturas se van analizando; en el celular, Galería → selecciona 5 → igual.
- **Nota**: con el plan gratuito de la IA (≈120 análisis/día en total) un lote grande puede pausarse hasta el día siguiente; la app lo avisa y continúa sola.

### 5.4 Control de proliferación de categorías y almacenamiento
- **Qué**: (a) la IA prefiere siempre una subcategoría existente y, si propone una nueva, debe ser genérica (un tipo de producto, no un producto); (b) en Revisar, antes de "Crear X" se ofrecen las subcategorías parecidas que ya existen ("Usar 'Limpiadores'"); (c) Mi tienda muestra **Limpiar vacías** cuando hay ≥5 subcategorías sin productos; (d) script `npm run storage:clean` borra fotos huérfanas del bucket.
- **Validar**: en Revisar, un producto sin subcategoría con sugerencia parecida a una existente muestra primero el chip verde "Usar …". En Mi tienda con muchas subcategorías vacías aparece el aviso con "Limpiar vacías".
- **Cifras medidas (2026-09-14)**: 24 fotos = 2,57 MB (109 KB promedio) → ≈ 9 500 fotos en el GB gratuito; base de datos 11 MB de 500 MB; un producto ≈ 0,9 KB, una categoría ≈ 0,1 KB.

---

## 2026-09-13 · Fase 3 — Robustez · Fase 4 — Pruebas

### 3.1 Fotos HEIC (iPhone) (riesgo #9)
- **Qué**: si la galería entrega `.heic/.heif`, se convierte a JPEG en el navegador (librería `heic2any`, se carga solo cuando hace falta) antes de redimensionar.
- **Validar**: en iPhone, Agregar → Galería → foto HEIC → la miniatura aparece y se analiza sin "No se pudo leer".

### 3.2 Login con correo sin confirmar (riesgo #10)
- **Qué**: si el correo no está confirmado, el login muestra un aviso ámbar y el botón **Reenviar confirmación** (el enlace del correo funciona desde cualquier dispositivo).
- **Validar**: con "Confirm email" activado en Supabase, regístrate y sin abrir el correo intenta entrar → aviso + botón; al pulsarlo, "Correo reenviado ✓".

### 3.3 Subcategoría automática por palabra completa (riesgo #11)
- **Qué**: la coincidencia por texto ahora exige palabras completas (sin acentos, ≥4 letras) en vez de fragmentos ("Baño" ya no coincide con "Bañador").
- **Validar**: producto "Bañador azul" en Limpieza → no se asigna a "Baño"; queda en categoría general o lo decide la IA.

### 3.4 Ajuste manual del medidor de IA (riesgo #13)
- **Qué**: en Inicio → Consumo de IA → detalle por modelo → **ajustar**: escribes el consumo real de hoy (p. ej. si usaste la clave fuera de la app). Se registra como ajuste manual sin tocar el consumo real.
- **Validar**: ajustar el Modelo Pro a 15 → la barra y "Restan" se actualizan; al volver a poner 10, baja.

### 4.1 Prueba automatizada `npm run test:e2e`
- Recorre: categoría preconfigurada + rápida → foto → producto con nombre, etiqueta y stock → reenvío idempotente → subcategoría automática → alta manual con decimales → medidor. Usuario temporal, se elimina al final. `BASE_URL=https://inventaria.pages.dev npm run test:e2e` para producción.
- Resultado en local (2026-09-13): 11/11 ✓.

### 4.2 Sonda de modelos `npm run ai:probe`
- Muestra qué modelos de la cadena responden hoy y el cupo que reporta Google. Consume 1 petición por modelo.

---

## 2026-09-13 · Fase 2 — Flujo de creación

### 2.1 Alta manual de producto (riesgo #5)
- **Qué**: nueva pantalla `/products/new` ("Nuevo producto"). Categoría con el selector de 2 pasos, foto opcional (cámara/galería, se redimensiona y sube), nombre obligatorio, precio y stock destacados, resto de datos debajo. Botones *Guardar en inventario* o *Guardar como pendiente*.
- **Dónde**: Inventario → botón **+ Producto** (arriba a la derecha) · estado vacío del Inventario → *Escribirlo a mano* · pantalla "Nada pendiente" de Revisar → *Escribir un producto a mano*.
- **Validar**: Inventario → + Producto → elige categoría → escribe nombre y precio → *Guardar en inventario* → debe abrirse el detalle del producto y aparecer en la lista. Repite con foto desde galería: la foto debe verse en el detalle.

### 2.2 Eliminar categoría con aviso y traslado de productos (riesgo #6)
- **Qué**: al pulsar la papelera en *Mi tienda* se abre un diálogo que dice cuántas subcategorías se eliminan, **qué datos se dejarán de definir** (los valores guardados se conservan y salen en el Excel) y permite **mover sus productos** a otra categoría/subcategoría o dejarlos sin categoría.
- **Validar**: Mi tienda → papelera de una categoría con productos → elige "Mover a: …" → Eliminar → en Inventario los productos deben mostrar la nueva categoría.

### 2.3 Revisar: "Guardar sin confirmar" avanza; "Deshacer" vuelve a la tarjeta (riesgo #12)
- **Validar**: en Revisar con ≥2 pendientes, pulsa *Guardar sin confirmar* → pasa a la siguiente tarjeta y el aviso dice "Guardado. Sigue pendiente de confirmar". Confirma una y pulsa *Deshacer* en el aviso verde → vuelve a mostrarse esa misma tarjeta.

### 2.4 Producto sin categoría: texto guía (riesgo #12 bis)
- **Validar**: en Revisar, un producto sin categoría muestra el aviso ámbar "Elige la categoría: ahí aparecerán el precio, el stock y los demás datos para completar".

---

## 2026-09-13 · Fase 1 — Integridad de datos

### 1.1 Decimales en campos numéricos (riesgo #1)
- **Qué**: los campos numéricos conservan el texto mientras se escribe y se convierten al guardar.
- **Validar**: Revisar → precio → teclea `12.50` (o `12,50`) → al confirmar, el detalle muestra 12.5 y el Excel 12,5 como número.

### 1.2 Claves de datos normalizadas (riesgo #3)
- **Qué**: los datos nuevos se guardan como `precio_compra` (minúsculas, sin espacios ni acentos). Al abrir un producto se unifican claves con distinta capitalización.
- **Validar**: Datos de mis productos → crea "Talla Europea" → aparece como `talla_europea` (etiqueta "Talla europea"). Un producto antiguo con `Nombre` muestra su nombre en la tarjeta.

### 1.3 Cola idempotente (riesgo #4)
- **Qué**: si la app se recarga a mitad de un lote, las fotos ya procesadas no se duplican ni fallan.
- **Validar**: toma 3 fotos, recarga la app cuando la primera esté ✓ → al volver, no aparece error "duplicate" y en Revisar hay exactamente 3 pendientes.

### 1.4 Excel completo (riesgos #2 y #8)
- **Qué**: columnas Categoría y Subcategoría separadas; cabeceras legibles; se incluyen todos los datos presentes aunque la categoría ya no exista; números reales; "una hoja por categoría" agrupa por categoría principal; columnas *Etiqueta leída* y *Modelo IA*; autofiltro.
- **Validar**: Exportar → Todo → abrir el .xlsx: cabecera con filtros, columna "Precio" numérica (se puede sumar), un producto sin categoría muestra igual su nombre y marca.

---

## Cómo se despliega cada cambio
`git push origin main` → GitHub Actions construye en Linux y publica en Cloudflare Pages (≈3 min). Migraciones SQL con `npm run db:sql supabase/<archivo>.sql`.
