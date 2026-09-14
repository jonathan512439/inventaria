/**
 * Catálogos públicos de códigos de barras (familia Open *Facts): gratis, sin clave, sin IA.
 * Se consultan en paralelo y gana el primero que tenga el producto.
 */
import type { Category } from "@/types/database";
import { nameKey } from "./categories";

export interface PublicProduct {
  nombre: string;
  marca: string;
  contenido: string;
  categorias: string[]; // en español si el catálogo las trae; si no, palabras clave traducidas
  imagen: string | null;
  fuente: string;
}

const SOURCES = [
  { host: "world.openfoodfacts.org", name: "Open Food Facts" },
  { host: "world.openbeautyfacts.org", name: "Open Beauty Facts" },
  { host: "world.openproductsfacts.org", name: "Open Products Facts" },
  { host: "world.openpetfoodfacts.org", name: "Open Pet Food Facts" },
];

/** Traducción de etiquetas de categoría (en:…) a palabras clave en español para sugerir categoría. */
const TAG_ES: Record<string, string> = {
  beverages: "bebidas", "carbonated-drinks": "gaseosas", sodas: "gaseosas", waters: "agua", "mineral-waters": "agua",
  juices: "jugos", "fruit-juices": "jugos", "energy-drinks": "energizantes", beers: "cerveza", wines: "vinos", "alcoholic-beverages": "licores",
  dairies: "lácteos", milks: "lácteos", yogurts: "lácteos", cheeses: "lácteos", snacks: "snacks", "sweet-snacks": "golosinas", biscuits: "galletas",
  chocolates: "golosinas", candies: "golosinas", cereals: "cereales", breakfasts: "cereales", pastas: "fideos", rices: "arroz", "legumes": "granos",
  oils: "aceites", "canned-foods": "conservas", sauces: "condimentos", spices: "condimentos", coffees: "café", teas: "té", sugars: "azúcar",
  breads: "panadería", "frozen-foods": "congelados", meats: "carnes", seafood: "pescados",
  "cleaning-products": "limpieza", detergents: "detergentes", "laundry-detergents": "detergentes", "dishwashing": "cocina", "air-fresheners": "ambientadores",
  "toilet-papers": "papel", "paper-products": "papel", "hygiene": "cuidado personal", "body-care": "cuidado personal", "hair-care": "cabello", shampoos: "cabello",
  "skin-care": "piel", "face-care": "piel", "oral-care": "cuidado personal", toothpastes: "cuidado personal", deodorants: "cuidado personal",
  makeup: "maquillaje", perfumes: "perfumes", "baby-care": "bebé", diapers: "bebé", "pet-food": "mascotas", "dog-food": "mascotas", "cat-food": "mascotas",
  medicines: "medicamentos", supplements: "vitaminas", batteries: "eléctricos", "light-bulbs": "eléctricos",
};

export async function lookupPublicCatalogs(code: string): Promise<PublicProduct | null> {
  const fields = "product_name,product_name_es,brands,quantity,categories,categories_tags,image_front_url,image_front_small_url";
  const results = await Promise.all(
    SOURCES.map(async (s) => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch(`https://${s.host}/api/v2/product/${encodeURIComponent(code)}?fields=${fields}`, {
          headers: { "User-Agent": "InventarIA/1.0 (inventaria.pages.dev)" },
          signal: ctrl.signal,
        }).finally(() => clearTimeout(timer));
        if (!res.ok) return null;
        const j = (await res.json()) as {
          status?: number;
          product?: {
            product_name?: string; product_name_es?: string; brands?: string; quantity?: string;
            categories?: string; categories_tags?: string[]; image_front_url?: string; image_front_small_url?: string;
          };
        };
        if (j.status !== 1 || !j.product) return null;
        const p = j.product;
        const nombre = (p.product_name_es || p.product_name || "").trim();
        if (!nombre) return null;
        const tags = (p.categories_tags ?? []).map((t) => t.replace(/^[a-z]{2}:/, ""));
        const esFromTags = tags
          .flatMap((t) => (TAG_ES[t] ? [TAG_ES[t]] : t.split("-").map((w) => TAG_ES[w]).filter(Boolean)))
          .filter(Boolean) as string[];
        const esFromText = (p.categories ?? "").split(",").map((c) => c.trim()).filter(Boolean);
        return {
          nombre: [nombre, p.quantity?.trim()].filter(Boolean).join(" ").slice(0, 80),
          marca: (p.brands || "").split(",")[0].trim().slice(0, 40),
          contenido: (p.quantity || "").trim().slice(0, 30),
          categorias: Array.from(new Set([...esFromTags, ...esFromText])).slice(0, 12),
          imagen: p.image_front_url || p.image_front_small_url || null,
          fuente: s.name,
        } as PublicProduct;
      } catch {
        return null;
      }
    })
  );
  return results.find(Boolean) ?? null;
}

/** Sugiere la categoría/subcategoría del usuario que mejor coincide con las categorías del catálogo público (sin IA). */
export function suggestCategory(categories: Category[], info: PublicProduct): Category | null {
  const words = new Set<string>();
  [...info.categorias, info.nombre].forEach((t) =>
    nameKey(t)
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4)
      .forEach((w) => words.add(w))
  );
  if (!words.size) return null;
  const stem = (w: string) => w.slice(0, 5);
  const stems = new Set(Array.from(words).map(stem));
  let best: { c: Category; score: number } | null = null;
  for (const c of categories) {
    const cw = nameKey(c.name).split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
    const hits = cw.filter((w) => stems.has(stem(w))).length;
    if (!hits) continue;
    const score = hits * 2 + (c.parent_id ? 1 : 0); // preferimos subcategorías
    if (!best || score > best.score) best = { c, score };
  }
  return best?.c ?? null;
}
