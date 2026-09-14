"use client";

/**
 * Lectura de códigos de barras en el navegador.
 * Usa la API nativa BarcodeDetector (Chrome/Android) y, si no existe (iOS/Safari),
 * carga bajo demanda un lector equivalente basado en WebAssembly.
 */

export const BARCODE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"] as const;

interface DetectedLike {
  rawValue: string;
  format?: string;
}
interface DetectorLike {
  detect(source: CanvasImageSource | ImageBitmapSource): Promise<DetectedLike[]>;
}

let detector: DetectorLike | null = null;

/** Crea (una vez) el lector: nativo si existe, ponyfill si no. */
export async function getDetector(): Promise<DetectorLike> {
  if (detector) return detector;
  const native = (globalThis as { BarcodeDetector?: new (o: { formats: string[] }) => DetectorLike }).BarcodeDetector;
  if (native) {
    detector = new native({ formats: [...BARCODE_FORMATS] });
    return detector;
  }
  const { BarcodeDetector } = await import("barcode-detector/ponyfill");
  detector = new BarcodeDetector({ formats: [...BARCODE_FORMATS] }) as unknown as DetectorLike;
  return detector;
}

/** Lee el primer código presente en un fotograma de vídeo o imagen. */
export async function scanFrame(source: CanvasImageSource | ImageBitmapSource): Promise<string | null> {
  const d = await getDetector();
  try {
    const found = await d.detect(source);
    const code = found.find((f) => f.rawValue?.trim())?.rawValue.trim();
    return code || null;
  } catch {
    return null;
  }
}

/** Normaliza un código: solo dígitos/letras y sin espacios. */
export function cleanCode(code: string): string {
  return code.replace(/\s+/g, "").toUpperCase().slice(0, 32);
}

export { CODE_FIELDS } from "./fields";
