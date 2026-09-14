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

### Fase 2 — Flujo de creación (siguiente)
5. **Alta manual de producto**: botón "+ Producto" en Inventario y Revisar → formulario con foto opcional, categoría y datos.
6. **Eliminar categoría**: aviso explícito "se borrarán sus datos: X, Y" y opción de mover productos a otra categoría antes.
7. "Guardar sin confirmar" avanza a la siguiente tarjeta; "Deshacer" vuelve a la tarjeta deshecha.
8. Producto sin categoría: texto "Elige la categoría para completar precio y stock".

### Fase 3 — Robustez
9. Conversión HEIC → JPEG en el cliente (heic2any) y fallback a `<img>` cuando `createImageBitmap` falle.
10. Login: si el correo no está confirmado, mensaje "Revisa tu correo" + botón *Reenviar confirmación*.
11. Clasificación por texto solo con coincidencia de palabra completa.
12. Medidor: opción "Ajustar consumo" manual y registro de llamadas externas por `GEMINI_API_KEY` compartida (documentado).

### Fase 4 — Pruebas automatizadas
13. Script `npm run test:e2e` (ya existen scripts ad hoc): registro → categoría → foto sintética → revisar → exportar y comprobar el .xlsx (columnas y valores).
14. Verificación semanal del cupo y modelos disponibles (`scripts/gemini-probe.mjs`).

---

## 5. Cómo reproducir los fallos críticos (antes de la corrección)
- **Decimales**: Revisar → precio → teclear `1`, `2`, `.`, `5` → el campo muestra `125`.
- **Excel**: producto sin categoría con nombre y marca → Exportar "Todo" → fila sin nombre ni marca.
- **Claves**: dato "Nombre" (mayúscula) en Juguetes → la IA guarda `Nombre`, la tarjeta busca `nombre` → vacío.
- **Cola**: tomar 3 fotos, recargar la app a mitad → las que ya se habían creado reaparecen en error "duplicate key".
