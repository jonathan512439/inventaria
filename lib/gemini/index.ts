import type { FieldTemplate } from "@/types/database";

/**
 * Cliente mínimo de Gemini vía REST (compatible con edge runtime / Cloudflare).
 * SOLO se usa desde el backend: la API key nunca llega al cliente.
 */

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-3.6-flash";

export class GeminiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Valor centinela para campos tipo lista cuando la IA no puede decidir (Gemini no acepta "" en enum). */
export const UNKNOWN_OPTION = "no_determinado";

/** Sub-conjunto de OpenAPI schema que acepta Gemini en responseSchema. */
interface GeminiSchema {
  type: "OBJECT" | "STRING" | "NUMBER";
  description?: string;
  enum?: string[];
  nullable?: boolean;
  properties?: Record<string, GeminiSchema>;
  required?: string[];
  propertyOrdering?: string[];
}

/** Claves reservadas que la IA devuelve además de los campos del usuario. */
export const META_KEYS = {
  categoria: "__categoria",
  categoriaNueva: "__categoria_nueva",
  catalogo: "__catalogo_sugerido",
  categoriaGeneral: "__categoria_general_nueva",
  etiqueta: "__etiqueta",
  variantes: "__variantes",
} as const;

/** Opción cuando ningún catálogo preconfigurado sirve. */
export const NO_CATALOG_OPTION = "ninguno";

/** Opción de categoría cuando ninguna de las existentes encaja. */
export const NEW_CATEGORY_OPTION = "__ninguna_encaja";

export interface PromptContext {
  /** Rutas de las categorías/subcategorías del usuario, p. ej. "Ropa > Camisas" */
  categoryPaths: string[];
  /** Si el usuario fijó una categoría manualmente, su ruta */
  fixedCategoryPath?: string | null;
  /** Catálogos preconfigurados disponibles (nombre → descripción) que el usuario aún no tiene */
  catalogs?: Array<{ name: string; description: string }>;
}

/** Construye el JSON Schema dinámico: campos is_ai_fillable + categoría + texto de etiqueta. */
export function buildResponseSchema(fields: FieldTemplate[], ctx: PromptContext): GeminiSchema {
  const properties: Record<string, GeminiSchema> = {};
  const order: string[] = [];

  if (!ctx.fixedCategoryPath && ctx.categoryPaths.length) {
    properties[META_KEYS.categoria] = {
      type: "STRING",
      enum: [...ctx.categoryPaths, NEW_CATEGORY_OPTION],
      description: `Subcategoría del inventario del usuario donde va este producto. "${NEW_CATEGORY_OPTION}" si ninguna encaja.`,
    };
    order.push(META_KEYS.categoria);
  }
  properties[META_KEYS.categoriaNueva] = {
    type: "STRING",
    description:
      "Solo cuando NO existe una subcategoría adecuada: nombre corto y GENÉRICO de subcategoría (un tipo de producto, no un producto concreto; p. ej. 'Limpiadores' y no 'Limpia lentes Claro'). Si ya elegiste una subcategoría concreta, cadena vacía.",
  };
  order.push(META_KEYS.categoriaNueva);
  if (!ctx.fixedCategoryPath && ctx.catalogs?.length) {
    properties[META_KEYS.catalogo] = {
      type: "STRING",
      enum: [...ctx.catalogs.map((c) => c.name), NO_CATALOG_OPTION],
      description: `Solo si ninguna categoría del usuario encaja: catálogo preconfigurado que le serviría para este producto, o "${NO_CATALOG_OPTION}".`,
    };
    order.push(META_KEYS.catalogo);
    properties[META_KEYS.categoriaGeneral] = {
      type: "STRING",
      description: "Solo si ninguna categoría del usuario ni ningún catálogo encaja: nombre corto de una categoría general nueva (p. ej. 'Óptica'). Si no, cadena vacía.",
    };
    order.push(META_KEYS.categoriaGeneral);
  }
  properties[META_KEYS.etiqueta] = {
    type: "STRING",
    description: "Todo el texto legible en el producto/etiqueta/empaque: marca, modelo, talla, código de barras o SKU, precio impreso, contenido. Cadena vacía si no hay texto.",
  };
  order.push(META_KEYS.etiqueta);
  properties[META_KEYS.variantes] = {
    type: "STRING",
    description:
      'Variantes VISIBLES del producto (tallas, colores, edades, sabores) en formato "talla: S, M, L; color: rojo, azul". Solo lo que se ve o se lee; cadena vacía si es un producto único o no se distingue.',
  };
  order.push(META_KEYS.variantes);

  for (const f of fields) {
    if (f.field_type === "number") {
      properties[f.name] = { type: "NUMBER", nullable: true, description: `Valor numérico de "${f.name}" solo si es visible/legible en la imagen. null si no.` };
    } else if (f.field_type === "select" && f.options?.length) {
      properties[f.name] = {
        type: "STRING",
        enum: [...f.options, UNKNOWN_OPTION],
        description: `Elige una opción para "${f.name}" o "${UNKNOWN_OPTION}" si no puedes determinarla.`,
      };
    } else {
      properties[f.name] = { type: "STRING", description: `Valor de "${f.name}" en español. Cadena vacía si no se puede determinar.` };
    }
    order.push(f.name);
  }
  return { type: "OBJECT", properties, required: order, propertyOrdering: order };
}

export function buildPrompt(fields: FieldTemplate[], ctx: PromptContext): string {
  const fieldList = fields
    .map((f) => {
      const type = f.field_type === "number" ? "número" : f.field_type === "select" ? `una de: ${f.options?.join(" | ")}` : "texto";
      return `- "${f.name}" (${type})`;
    })
    .join("\n");

  const catalogLine = ctx.catalogs?.length
    ? `Catálogos preconfigurados disponibles: ${ctx.catalogs.map((c) => `${c.name} (${c.description})`).join("; ")}.`
    : "";
  const catLine = ctx.fixedCategoryPath
    ? `El producto pertenece a la subcategoría "${ctx.fixedCategoryPath}".`
    : ctx.categoryPaths.length
      ? `Elige la categoría o subcategoría más adecuada entre las del usuario (campo "${META_KEYS.categoria}"; las rutas "A > B" son subcategorías, prefiérelas). Si solo encaja la categoría general, elígela y propón en "${META_KEYS.categoriaNueva}" la subcategoría que faltaría. Usa "${NEW_CATEGORY_OPTION}" solo si el producto claramente no pertenece a ninguna categoría del usuario (prefiere una categoría general existente antes que ninguna) y propón un nombre en "${META_KEYS.categoriaNueva}".`
      : `El usuario aún no tiene subcategorías: propón un nombre corto de subcategoría en "${META_KEYS.categoriaNueva}" (p. ej. "Bebidas", "Herramientas").`;

  return [
    "Eres un asistente de inventario para una tienda. Analiza la foto de este producto.",
    "Devuelve SOLO un JSON que siga exactamente el schema dado, en español.",
    "Lee con cuidado cualquier texto impreso (marca, modelo, talla, código, precio) y úsalo: es más fiable que adivinar.",
    "Los campos de texto como nombre, descripcion, marca o color NUNCA deben quedar vacíos si el producto se ve: da siempre tu mejor estimación aunque no estés seguro (el usuario la corregirá).",
    `Deja vacío solo lo que realmente no se puede inferir de la imagen (cadena vacía; null en campos numéricos; "${UNKNOWN_OPTION}" en listas).`,
    "No inventes precios ni stock: solo si están impresos y legibles.",
    "Si un campo pertenece a otro tipo de producto y no tiene sentido para este (p. ej. talla_casco en una bebida), déjalo vacío; nunca escribas 'No aplica'.",
    'Para "nombre" usa un nombre comercial corto y útil para buscar (marca + producto + variante, máx. 8 palabras). Para "descripcion" 1-2 frases concretas.',
    catLine,
    `Si en la foto se ven varias tallas, colores o edades del MISMO producto (etiqueta con S/M/L, prendas iguales de varios colores, caja "3-5 años"), enuméralas en "${META_KEYS.variantes}" con el formato "eje: valor, valor; eje: valor". Nunca inventes variantes que no se vean.`,
    "Prefiere SIEMPRE una subcategoría existente aunque no sea perfecta; propón una nueva solo si ninguna tiene relación. Las subcategorías nuevas deben ser genéricas (agrupan muchos productos), nunca el nombre de un producto.",
    catalogLine,
    `Campos a completar:\n${fieldList}`,
  ].join("\n");
}

interface AnalyzeArgs {
  imageBase64: string;
  mimeType: string;
  prompt: string;
  schema: GeminiSchema;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Cadena de modelos: el cupo gratuito es POR MODELO y por día (p. ej. 20 peticiones/día en gemini-3.6-flash),
 * así que al agotarse uno pasamos al siguiente. Configurable con GEMINI_MODELS="a,b,c" (GEMINI_MODEL va primero).
 */
const DEFAULT_CHAIN = ["gemini-3.6-flash", "gemini-3.7-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-flash-latest"];

export function modelChain(): string[] {
  const env = (process.env.GEMINI_MODELS || "").split(",").map((m) => m.trim()).filter(Boolean);
  const first = process.env.GEMINI_MODEL?.trim();
  const list = [...(first ? [first] : []), ...(env.length ? env : DEFAULT_CHAIN)];
  return Array.from(new Set(list));
}

/** Modelos con cupo diario agotado (por instancia del servidor) → hasta cuándo evitarlos. */
const exhaustedUntil = new Map<string, number>();

/** Próximo reinicio del cupo diario de Google (medianoche, hora del Pacífico). */
export function nextQuotaReset(): Date {
  const now = new Date();
  const pt = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const offsetMs = now.getTime() - pt.getTime(); // diferencia local(UTC)–PT
  const midnightPt = new Date(pt);
  midnightPt.setHours(24, 0, 0, 0);
  return new Date(midnightPt.getTime() + offsetMs);
}

export class QuotaError extends GeminiError {
  daily = true;
  retryAfterSec: number;
  constructor(message: string, retryAfterSec: number) {
    super(429, message);
    this.retryAfterSec = retryAfterSec;
  }
}

interface GeminiFailure {
  status: number;
  message: string;
  daily: boolean; // cupo por día agotado
  demand: boolean; // "high demand" (temporal, cambiar de modelo)
  retryDelaySec: number | null;
  quotaLimit: number | null; // límite diario reportado
}

function parseFailure(status: number, errText: string): GeminiFailure {
  let message = `Error de Gemini (${status})`;
  let daily = false;
  let retryDelaySec: number | null = null;
  let quotaLimit: number | null = null;
  try {
    const parsed = JSON.parse(errText) as {
      error?: { message?: string; details?: Array<{ violations?: Array<{ quotaId?: string; quotaValue?: string }>; retryDelay?: string }> };
    };
    if (parsed.error?.message) message = parsed.error.message;
    for (const d of parsed.error?.details ?? []) {
      for (const v of d.violations ?? []) {
        if (/PerDay/i.test(v.quotaId ?? "")) {
          daily = true;
          if (v.quotaValue) quotaLimit = parseInt(v.quotaValue, 10) || null;
        }
      }
      if (d.retryDelay) retryDelaySec = parseFloat(d.retryDelay) || null;
    }
  } catch {
    /* texto plano */
  }
  return { status, message, daily, demand: /high demand/i.test(message), retryDelaySec, quotaLimit };
}

/**
 * Llama a generateContent probando la cadena de modelos. Devuelve el texto y el modelo usado.
 * - Cupo diario agotado → siguiente modelo (y se recuerda hasta el reinicio)
 * - "High demand" / 503 → siguiente modelo
 * - Límite por minuto → espera breve (máx. 12 s) y reintenta una vez en el mismo modelo, luego siguiente
 */
/** Registro de cada intento (para el medidor de consumo). */
export interface UsageAttempt {
  model: string;
  status: "ok" | "quota" | "limited" | "error";
  quota_limit?: number | null;
}
const usageLog: UsageAttempt[] = [];
/** Vacía y devuelve los intentos registrados desde la última lectura. */
export function drainUsage(): UsageAttempt[] {
  return usageLog.splice(0, usageLog.length);
}

export async function generateContent(parts: unknown[], generationConfig: Record<string, unknown>): Promise<{ text: string; model: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiError(500, "Falta GEMINI_API_KEY en el entorno del servidor");
  const now = Date.now();
  const chain = modelChain().filter((m) => (exhaustedUntil.get(m) ?? 0) < now);
  if (chain.length === 0) {
    const reset = nextQuotaReset();
    throw new QuotaError("Se agotó el cupo diario gratuito de la IA en todos los modelos.", Math.max(60, Math.ceil((reset.getTime() - now) / 1000)));
  }
  const body = JSON.stringify({ contents: [{ role: "user", parts }], generationConfig });
  let last: GeminiFailure | null = null;

  for (const model of chain) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(`${API_BASE}/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body,
      });
      if (res.ok) {
        const json = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          promptFeedback?: { blockReason?: string };
        };
        if (json.promptFeedback?.blockReason) throw new GeminiError(422, `La imagen fue bloqueada por seguridad (${json.promptFeedback.blockReason}).`);
        usageLog.push({ model, status: "ok" });
        return { text: json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "", model };
      }
      const f = parseFailure(res.status, await res.text().catch(() => ""));
      last = f;
      usageLog.push({ model, status: f.daily ? "quota" : res.status === 429 ? "limited" : "error", quota_limit: f.quotaLimit ?? null });
      if (res.status === 404) break; // modelo inexistente → siguiente
      if (res.status === 429 && f.daily) {
        exhaustedUntil.set(model, nextQuotaReset().getTime());
        break; // siguiente modelo
      }
      if (res.status === 503 || f.demand) break; // siguiente modelo
      if (res.status === 429) {
        if (attempt === 0) {
          await sleep(Math.min(12, f.retryDelaySec ?? 4) * 1000);
          continue; // reintento en el mismo modelo
        }
        break;
      }
      throw new GeminiError(res.status, f.message); // 400 (schema/imagen), 401, etc.: no tiene sentido cambiar de modelo
    }
  }

  // Todos fallaron
  const allDaily = modelChain().every((m) => (exhaustedUntil.get(m) ?? 0) > Date.now());
  if (allDaily || last?.daily) {
    const reset = nextQuotaReset();
    throw new QuotaError("Se agotó el cupo diario gratuito de la IA. Tus fotos quedan guardadas y se analizarán cuando se renueve.", Math.max(60, Math.ceil((reset.getTime() - Date.now()) / 1000)));
  }
  throw new GeminiError(429, `La IA está saturada en este momento. Reintentamos en un momento. ${last?.message ? `Detalle: ${last.message.slice(0, 160)}` : ""}`);
}

/** Analiza una imagen con structured output. Devuelve el JSON parseado y el modelo usado. */
export async function analyzeImage({ imageBase64, mimeType, prompt, schema }: AnalyzeArgs): Promise<{ result: Record<string, unknown>; model: string }> {
  const { text, model } = await generateContent(
    [{ inline_data: { mime_type: mimeType, data: imageBase64 } }, { text: prompt }],
    { temperature: 0.2, responseMimeType: "application/json", responseSchema: schema }
  );
  try {
    return { result: JSON.parse(text) as Record<string, unknown>, model };
  } catch {
    throw new GeminiError(502, "Gemini devolvió una respuesta que no es JSON válido.");
  }
}

// ---------------------------------------------------------------------
// Generación de una categoría (tipo de producto) a partir de una descripción en texto
// ---------------------------------------------------------------------

export interface GeneratedPreset {
  name: string;
  icon: string;
  sections: string[];
  fields: Array<{ name: string; field_type: "text" | "number" | "select"; is_ai_fillable: boolean; options?: string[] }>;
}

const PRESET_SCHEMA = {
  type: "OBJECT",
  properties: {
    name: { type: "STRING", description: "Nombre corto del tipo de producto o categoría, en español (máx. 4 palabras)." },
    icon: { type: "STRING", description: "Un solo emoji representativo." },
    sections: {
      type: "ARRAY",
      description: "Entre 5 y 9 subcategorías (estantes) típicas de esa categoría, nombres cortos en español.",
      items: { type: "STRING" },
    },
    fields: {
      type: "ARRAY",
      description:
        "Entre 2 y 4 datos ESPECÍFICOS de la categoría que valga la pena guardar por producto (no incluir nombre, marca, descripcion, precio ni stock: ya existen). Nombres en minúsculas con guion_bajo.",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          field_type: { type: "STRING", enum: ["text", "number", "select"] },
          is_ai_fillable: { type: "BOOLEAN", description: "true si se puede deducir mirando la foto (color, talla, modelo...); false si lo sabe solo el dueño (fecha de vencimiento, garantía...)." },
          options: { type: "ARRAY", items: { type: "STRING" }, description: "Solo para select: 3-8 opciones." },
        },
        required: ["name", "field_type", "is_ai_fillable"],
      },
    },
  },
  required: ["name", "icon", "sections", "fields"],
};

/** Pide a Gemini una categoría completa (subcategorías + datos) a partir de "vendo repuestos de moto y aceites". */
export async function generatePreset(description: string): Promise<GeneratedPreset> {
  const { text } = await generateContent(
    [
      {
        text:
          `Un pequeño negocio describe lo que vende: "${description.slice(0, 300)}".\n` +
          `Diseña cómo organizaría su inventario: nombre de la categoría, un emoji, las subcategorías (estantes) y 2-4 datos específicos por producto. Todo en español, breve y práctico.`,
      },
    ],
    { temperature: 0.4, responseMimeType: "application/json", responseSchema: PRESET_SCHEMA }
  );
  try {
    return JSON.parse(text) as GeneratedPreset;
  } catch {
    throw new GeminiError(502, "La IA no devolvió una respuesta válida.");
  }
}

/** Elige la subcategoría más adecuada para un producto (solo texto, sin imagen). */
export async function pickSubcategory(productText: string, options: string[]): Promise<string | null> {
  if (!options.length) return null;
  const NONE = "ninguna";
  try {
    const { text } = await generateContent(
      [{ text: `Producto: ${productText.slice(0, 500)}\nElige la subcategoría más adecuada de la lista, o "${NONE}" si ninguna encaja.` }],
      {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: { type: "OBJECT", properties: { subcategoria: { type: "STRING", enum: [...options, NONE] } }, required: ["subcategoria"] },
      }
    );
    const v = (JSON.parse(text) as { subcategoria?: string }).subcategoria;
    return v && v !== NONE ? v : null;
  } catch {
    return null;
  }
}
