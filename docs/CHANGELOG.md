# Registro de cambios y validación

Cada entrada indica **qué cambió**, **por qué** y **cómo validarlo** en <https://inventaria.pages.dev>.
Referencia de riesgos: [AUDITORIA.md](AUDITORIA.md).

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
