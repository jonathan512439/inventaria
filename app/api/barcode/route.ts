import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { CODE_FIELDS, getValue, normalizeFieldName } from "@/lib/fields";

export const runtime = "edge";

/** Consulta el catálogo público Open Food Facts (gratis, sin clave). No consume cupo de IA. */
async function lookupPublic(code: string) {
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}?fields=product_name,product_name_es,brands,quantity,categories,image_front_small_url`,
      { headers: { "User-Agent": "InventarIA/1.0 (inventaria.pages.dev)" } }
    );
    if (!res.ok) return null;
    const j = (await res.json()) as {
      status?: number;
      product?: { product_name?: string; product_name_es?: string; brands?: string; quantity?: string; categories?: string; image_front_small_url?: string };
    };
    if (j.status !== 1 || !j.product) return null;
    const p = j.product;
    const nombre = (p.product_name_es || p.product_name || "").trim();
    if (!nombre) return null;
    return {
      nombre: [nombre, p.quantity?.trim()].filter(Boolean).join(" ").slice(0, 80),
      marca: (p.brands || "").split(",")[0].trim().slice(0, 40),
      contenido: (p.quantity || "").trim().slice(0, 30),
      categoria_publica: (p.categories || "").split(",").pop()?.trim().slice(0, 40) ?? "",
      imagen: p.image_front_small_url ?? null,
      fuente: "Open Food Facts",
    };
  } catch {
    return null;
  }
}

/**
 * GET /api/barcode?code=7790895000997
 * 1) Busca el código entre los productos del usuario → duplicado (sumar stock)
 * 2) Si no, lo busca en el catálogo público → datos listos sin usar IA
 * Nunca consume cupo de IA.
 */
export async function GET(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const code = (new URL(request.url).searchParams.get("code") ?? "").trim();
  if (!code) return NextResponse.json({ error: "Falta el código" }, { status: 400 });

  const { data: products } = await supabase.from("products").select("id,data,category_id,image_url,status");
  const codeKeys = CODE_FIELDS.map(normalizeFieldName);
  const existing = (products ?? []).find((p) =>
    codeKeys.some((k) => {
      const v = getValue(p.data, k);
      return v !== undefined && v !== null && String(v).trim().toUpperCase() === code.toUpperCase();
    })
  );

  if (existing) {
    return NextResponse.json({ found: "own", product: existing });
  }

  const info = await lookupPublic(code);
  return NextResponse.json({ found: info ? "public" : "none", info });
}
