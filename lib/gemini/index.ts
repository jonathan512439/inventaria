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
  etiqueta: "__etiqueta",
} as const;

/** Opción de categoría cuando ninguna de las existentes encaja. */
export const NEW_CATEGORY_OPTION = "__ninguna_encaja";

export interface PromptContext {
  /** Rutas de las secciones del usuario, p. ej. "Ropa > Camisas" */
  categoryPaths: string[];
  /** Si el usuario fijó una sección manualmente, su ruta */
  fixedCategoryPath?: string | null;
}

/** Construye el JSON Schema dinámico: campos is_ai_fillable + categoría + texto de etiqueta. */
export function buildResponseSchema(fields: FieldTemplate[], ctx: PromptContext): GeminiSchema {
  const properties: Record<string, GeminiSchema> = {};
  const order: string[] = [];

  if (!ctx.fixedCategoryPath && ctx.categoryPaths.length) {
    properties[META_KEYS.categoria] = {
      type: "STRING",
      enum: [...ctx.categoryPaths, NEW_CATEGORY_OPTION],
      description: `Sección del inventario del usuario donde va este producto. "${NEW_CATEGORY_OPTION}" si ninguna encaja.`,
    };
    order.push(META_KEYS.categoria);
  }
  properties[META_KEYS.categoriaNueva] = {
    type: "STRING",
    description: "Si ninguna sección existente encaja (o no hay secciones), nombre corto de la sección que crearías. Si sí encaja, cadena vacía.",
  };
  order.push(META_KEYS.categoriaNueva);
  properties[META_KEYS.etiqueta] = {
    type: "STRING",
    description: "Todo el texto legible en el producto/etiqueta/empaque: marca, modelo, talla, código de barras o SKU, precio impreso, contenido. Cadena vacía si no hay texto.",
  };
  order.push(META_KEYS.etiqueta);

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

  const catLine = ctx.fixedCategoryPath
    ? `El producto pertenece a la sección "${ctx.fixedCategoryPath}".`
    : ctx.categoryPaths.length
      ? `Elige la sección más adecuada entre las del usuario (campo "${META_KEYS.categoria}"). Si ninguna encaja, usa "${NEW_CATEGORY_OPTION}" y propón un nombre en "${META_KEYS.categoriaNueva}".`
      : `El usuario aún no tiene secciones: propón un nombre corto de sección en "${META_KEYS.categoriaNueva}" (p. ej. "Bebidas", "Herramientas").`;

  return [
    "Eres un asistente de inventario para una tienda. Analiza la foto de este producto.",
    "Devuelve SOLO un JSON que siga exactamente el schema dado, en español, con tus mejores estimaciones visuales.",
    `Si no puedes determinar un campo con confianza razonable, usa cadena vacía (null en campos numéricos, "${UNKNOWN_OPTION}" en listas).`,
    "Lee con cuidado cualquier texto impreso (marca, modelo, talla, código, precio) y úsalo: es más fiable que adivinar.",
    "No inventes precios ni stock: solo si están impresos y legibles.",
    'Para "nombre" usa un nombre comercial corto y útil para buscar (marca + producto + variante, máx. 8 palabras). Para "descripcion" 1-2 frases concretas.',
    catLine,
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
 * Llama a Gemini con structured output. Reintenta con backoff exponencial ante 429/503.
 * Devuelve el objeto JSON ya parseado.
 */
export async function analyzeImage({ imageBase64, mimeType, prompt, schema }: AnalyzeArgs): Promise<Record<string, unknown>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiError(500, "Falta GEMINI_API_KEY en el entorno del servidor");
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const url = `${API_BASE}/${model}:generateContent`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ inline_data: { mime_type: mimeType, data: imageBase64 } }, { text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: schema,
    },
  };

  const MAX_ATTEMPTS = 4;
  let lastError: GeminiError | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
        promptFeedback?: { blockReason?: string };
      };
      if (json.promptFeedback?.blockReason) {
        throw new GeminiError(422, `La imagen fue bloqueada por seguridad (${json.promptFeedback.blockReason}).`);
      }
      const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      try {
        return JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new GeminiError(502, "Gemini devolvió una respuesta que no es JSON válido.");
      }
    }

    const errText = await res.text().catch(() => "");
    let message = `Error de Gemini (${res.status})`;
    try {
      const parsed = JSON.parse(errText) as { error?: { message?: string } };
      if (parsed.error?.message) message = parsed.error.message;
    } catch {
      /* texto plano */
    }

    if (res.status === 429 || res.status === 503) {
      lastError = new GeminiError(res.status, message);
      if (attempt < MAX_ATTEMPTS - 1) {
        // 2s, 4s, 8s
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      break;
    }
    if (res.status === 404) {
      throw new GeminiError(500, `Modelo "${model}" no disponible. Cambia GEMINI_MODEL en el entorno. Detalle: ${message}`);
    }
    throw new GeminiError(res.status, message);
  }

  throw new GeminiError(
    429,
    "Se alcanzó el límite de solicitudes de la IA (free tier). Espera un minuto e inténtalo de nuevo. " +
      (lastError?.message ? `Detalle: ${lastError.message}` : "")
  );
}
