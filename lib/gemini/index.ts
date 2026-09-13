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

/** Construye el JSON Schema dinámico a partir de los campos is_ai_fillable. */
export function buildResponseSchema(fields: FieldTemplate[]): GeminiSchema {
  const properties: Record<string, GeminiSchema> = {};
  for (const f of fields) {
    if (f.field_type === "number") {
      properties[f.name] = { type: "NUMBER", nullable: true, description: `Valor numérico de "${f.name}". null si no se puede determinar.` };
    } else if (f.field_type === "select" && f.options?.length) {
      properties[f.name] = {
        type: "STRING",
        enum: [...f.options, UNKNOWN_OPTION],
        description: `Elige una opción para "${f.name}" o "${UNKNOWN_OPTION}" si no puedes determinarla.`,
      };
    } else {
      properties[f.name] = { type: "STRING", description: `Valor de "${f.name}" en español. Cadena vacía si no se puede determinar.` };
    }
  }
  return {
    type: "OBJECT",
    properties,
    required: fields.map((f) => f.name),
    propertyOrdering: fields.map((f) => f.name),
  };
}

export function buildPrompt(fields: FieldTemplate[], context: { categoryPath: string; categoryOptions: string[] }): string {
  const fieldList = fields
    .map((f) => {
      const type = f.field_type === "number" ? "número" : f.field_type === "select" ? `una de: ${f.options?.join(" | ")}` : "texto";
      return `- "${f.name}" (${type})`;
    })
    .join("\n");

  const catHint = context.categoryOptions.length
    ? `\nSi existe un campo de categoría sugerida, elige preferentemente una de estas categorías del usuario: ${context.categoryOptions.join(", ")}.`
    : "";

  return (
    `Analiza la foto de este producto. El usuario lo está registrando en la categoría "${context.categoryPath}".\n` +
    `Devuelve SOLO un JSON que siga exactamente el schema dado, en español, con tus mejores estimaciones visuales.\n` +
    `Si no puedes determinar un campo con confianza razonable, usa cadena vacía (null en campos numéricos, "${UNKNOWN_OPTION}" en listas).\n` +
    `No inventes precios, stock ni datos que no sean visibles en la imagen.\n` +
    `Para "nombre" usa un nombre comercial corto (máx. 8 palabras). Para "descripcion" usa 1-2 frases concretas.\n` +
    `Campos a completar:\n${fieldList}${catHint}`
  );
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
