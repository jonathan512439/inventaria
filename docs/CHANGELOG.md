# Registro de cambios y validación

Cada entrada indica **qué cambió**, **por qué** y **cómo validarlo** en <https://inventaria.pages.dev>.
Referencia de riesgos: [AUDITORIA.md](AUDITORIA.md).

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
