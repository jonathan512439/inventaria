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
    "Devuelve SOLO un JSON que siga exactamente el schema dado, en español.",
    "Lee con cuidado cualquier texto impreso (marca, modelo, talla, código, precio) y úsalo: es más fiable que adivinar.",
    "Los campos de texto como nombre, descripcion, marca o color NUNCA deben quedar vacíos si el producto se ve: da siempre tu mejor estimación aunque no estés seguro (el usuario la corregirá).",
    `Deja vacío solo lo que realmente no se puede inferir de la imagen (cadena vacía; null en campos numéricos; "${UNKNOWN_OPTION}" en listas).`,
    "No inventes precios ni stock: solo si están impresos y legibles.",
    "Si un campo pertenece a otro tipo de producto y no tiene sentido para este (p. ej. talla_casco en una bebida), déjalo vacío; nunca escribas 'No aplica'.",
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

// ---------------------------------------------------------------------
// Generación de un rubro (tipo de producto) a partir de una descripción en texto
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
    name: { type: "STRING", description: "Nombre corto del tipo de producto o rubro, en español (máx. 4 palabras)." },
    icon: { type: "STRING", description: "Un solo emoji representativo." },
    sections: {
      type: "ARRAY",
      description: "Entre 5 y 9 secciones (estantes) típicas de ese rubro, nombres cortos en español.",
      items: { type: "STRING" },
    },
    fields: {
      type: "ARRAY",
      description:
        "Entre 2 y 4 datos ESPECÍFICOS del rubro que valga la pena guardar por producto (no incluir nombre, marca, descripcion, precio ni stock: ya existen). Nombres en minúsculas con guion_bajo.",
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

/** Pide a Gemini un rubro completo (secciones + datos) a partir de "vendo repuestos de moto y aceites". */
export async function generatePreset(description: string): Promise<GeneratedPreset> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiError(500, "Falta GEMINI_API_KEY en el entorno del servidor");
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const res = await fetch(`${API_BASE}/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                `Un pequeño negocio describe lo que vende: "${description.slice(0, 300)}".\n` +
                `Diseña cómo organizaría su inventario: nombre del rubro, un emoji, las secciones (estantes) y 2-4 datos específicos por producto. Todo en español, breve y práctico.`,
            },
          ],
        },
      ],
      generationConfig: { temperature: 0.4, responseMimeType: "application/json", responseSchema: PRESET_SCHEMA },
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new GeminiError(res.status === 429 ? 429 : 502, res.status === 429 ? "La IA está ocupada, intenta en un minuto." : `Error de Gemini (${res.status}) ${t.slice(0, 200)}`);
  }
  const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  try {
    return JSON.parse(text) as GeneratedPreset;
  } catch {
    throw new GeminiError(502, "La IA no devolvió una respuesta válida.");
  }
}
