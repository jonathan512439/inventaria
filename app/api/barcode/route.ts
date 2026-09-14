import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CODE_FIELDS, applyDefaults, coerceValue, getEffectiveFields, getValue, normalizeFieldName } from "@/lib/fields";
import { categoryPath } from "@/lib/categories";
import { lookupPublicCatalogs, suggestCategory } from "@/lib/publicCatalog";
import type { ProductData } from "@/types/database";

export const runtime = "edge";

/**
 * GET /api/barcode?code=…
 * 1) Busca el código en el inventario del usuario → repetido (sumar stock)
 * 2) Si no, en los catálogos públicos (Open Food/Beauty/Products/Pet Food Facts) → datos + foto + categoría sugerida
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

  const [{ data: products }, { data: categories }] = await Promise.all([
    supabase.from("products").select("id,data,category_id,image_url,status"),
    supabase.from("categories").select("*"),
  ]);
  const codeKeys = CODE_FIELDS.map(normalizeFieldName);
  const existing = (products ?? []).find((p) =>
    codeKeys.some((k) => {
      const v = getValue(p.data, k);
      return v !== undefined && v !== null && String(v).trim().toUpperCase() === code.toUpperCase();
    })
  );
  if (existing) return NextResponse.json({ found: "own", product: existing });

  const info = await lookupPublicCatalogs(code);
  if (!info) return NextResponse.json({ found: "none", info: null, suggestion: null });
  const cat = suggestCategory(categories ?? [], info);
  return NextResponse.json({
    found: "public",
    info,
    suggestion: cat ? { category_id: cat.id, path: categoryPath(categories ?? [], cat.id) } : null,
  });
}

/**
 * POST /api/barcode  { code, category_id, data, image_url?, status? }
 * Crea el producto sin IA. Si viene image_url (foto del catálogo público) la descarga al Storage.
 */
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    code?: string;
    category_id?: string | null;
    data?: ProductData;
    image_url?: string | null;
    status?: "confirmed" | "draft";
  };
  const code = (body.code ?? "").trim();
  if (!code) return NextResponse.json({ error: "Falta el código" }, { status: 400 });

  const [{ data: categories }, { data: templates }] = await Promise.all([
    supabase.from("categories").select("*"),
    supabase.from("field_templates").select("*").order("sort_order"),
  ]);
  const categoryId = body.category_id && (categories ?? []).some((c) => c.id === body.category_id) ? body.category_id : null;
  const fields = getEffectiveFields(templates ?? [], categories ?? [], categoryId);

  const data: ProductData = {};
  fields.forEach((f) => (data[f.name] = coerceValue(f, body.data?.[f.name])));
  // datos que vienen sin campo definido (p. ej. marca desde el catálogo) se conservan igual
  Object.entries(body.data ?? {}).forEach(([k, v]) => {
    if (!(k in data) && v !== undefined && v !== null && v !== "") data[k] = v as ProductData[string];
  });
  data.codigo_barras = code;
  applyDefaults(fields, data);

  const admin = createAdminClient();
  const id = crypto.randomUUID();
  let image_url: string | null = null;

  // Foto del catálogo público → Storage propio (así no dependemos de un enlace externo)
  if (body.image_url && /^https:\/\/[a-z.]*open(food|beauty|products|petfood)facts\.org\//i.test(body.image_url)) {
    try {
      // El servidor de imágenes público a veces tarda: máximo 8 s, y si no llega, el producto se crea sin foto
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(body.image_url, { headers: { "User-Agent": "InventarIA/1.0" }, signal: ctrl.signal }).finally(() => clearTimeout(timer));
      if (res.ok) {
        const type = res.headers.get("content-type") ?? "image/jpeg";
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length > 0 && bytes.length < 2 * 1024 * 1024) {
          const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
          const path = `${user.id}/${id}.${ext}`;
          const { error } = await admin.storage.from("product-images").upload(path, bytes, { contentType: type, upsert: true });
          if (!error) image_url = admin.storage.from("product-images").getPublicUrl(path).data.publicUrl;
        }
      }
    } catch {
      /* sin foto: el producto se crea igual */
    }
  }

  const { data: product, error } = await admin
    .from("products")
    .insert({
      id,
      user_id: user.id,
      category_id: categoryId,
      status: body.status === "draft" ? "draft" : "confirmed",
      data,
      image_url,
      ai_meta: { etiqueta: `Código ${code}`, modelo: null },
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ product }, { status: 201 });
}
