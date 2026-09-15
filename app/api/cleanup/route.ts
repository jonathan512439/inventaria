import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEffectiveFields, getValue, normalizeFieldName } from "@/lib/fields";
import type { ProductData } from "@/types/database";
import { businessIdsOf } from "@/lib/business";

export const runtime = "edge";

const OLD_DAYS = 7;
const TRASH_DAYS = 30;
/** Datos que nunca se tocan aunque no estén definidos en la categoría. */
const KEEP_KEYS = new Set(["nombre", "name", "producto", "titulo", "precio", "precio_venta", "price", "stock", "cantidad", "existencias", "precio_compra", "costo", "codigo_barras"]);

/** Ids de una categoría y sus subcategorías (sin depender de lib/categories, que tipa Category completo). */
function descendants(cats: { id: string; parent_id: string | null }[], id: string): string[] {
  const out = [id];
  cats.forEach((c) => c.parent_id === id && out.push(c.id));
  return out;
}

/** Borra definitivamente (con su foto) lo que lleva más de 30 días en la papelera. */
async function purgeTrash(userId: string) {
  const admin = createAdminClient();
  const bids = await businessIdsOf(admin, userId);
  if (!bids.length) return 0;
  const limit = new Date(Date.now() - TRASH_DAYS * 86400000).toISOString();
  const { data: rows } = await admin.from("products").select("id,image_url").in("business_id", bids).not("deleted_at", "is", null).lt("deleted_at", limit);
  if (!rows?.length) return 0;
  const paths = rows.map((r) => r.image_url?.split("/product-images/")[1]).filter(Boolean) as string[];
  if (paths.length) await admin.storage.from("product-images").remove(paths);
  await admin.from("products").delete().in("id", rows.map((r) => r.id));
  return rows.length;
}

/** Resumen de "cosas por ordenar" del usuario. */
async function summary(userId: string) {
  const admin = createAdminClient();
  await purgeTrash(userId);
  const bids = await businessIdsOf(admin, userId);
  const [{ data: allProducts }, { data: categories }, { data: templates }] = await Promise.all([
    admin.from("products").select("id,status,category_id,data,image_url,created_at,deleted_at").in("business_id", bids),
    admin.from("categories").select("*").in("business_id", bids),
    admin.from("field_templates").select("*").in("business_id", bids).order("sort_order"),
  ]);
  const trash = (allProducts ?? []).filter((p) => p.deleted_at);
  const prods = (allProducts ?? []).filter((p) => !p.deleted_at);
  const cats = categories ?? [];
  const withProducts = new Set(prods.map((p) => p.category_id).filter(Boolean) as string[]);

  const tpls = templates ?? [];

  // ---- Datos (columnas) que sobran ----
  const NEVER = new Set(["nombre", "name", "producto", "titulo", "precio", "precio_venta", "price", "stock", "cantidad", "existencias", "precio_compra", "costo", "codigo_barras"]);
  const hasValue = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== "";

  // 1) Campos definidos que ningún producto llena (con al menos 3 productos en su ámbito)
  const emptyFields: { id: string; name: string; scope: string; products: number }[] = [];
  for (const t of tpls) {
    if (NEVER.has(normalizeFieldName(t.name)) || t.default_value) continue;
    const scopeIds = t.category_id ? new Set(descendants(cats, t.category_id)) : null;
    const inScope = prods.filter((p) => (scopeIds ? p.category_id && scopeIds.has(p.category_id) : true));
    if (inScope.length < 3) continue;
    const used = inScope.some((p) => hasValue(getValue(p.data, t.name)));
    if (!used) emptyFields.push({ id: t.id, name: t.name, scope: t.category_id ? cats.find((c) => c.id === t.category_id)?.name ?? "" : "todas", products: inScope.length });
  }

  // 2) Valores vacíos guardados en los productos (ensucian el Excel y ocupan espacio)
  let emptyValues = 0;
  const emptyValueIds: string[] = [];
  // 3) Datos sueltos: claves con valor que ya no pertenecen a ningún dato de su categoría
  const orphanValues: { key: string; products: number }[] = [];
  const orphanByKey = new Map<string, number>();
  const orphanIds = new Set<string>();
  for (const p of prods) {
    const defined = new Set(getEffectiveFields(tpls, cats, p.category_id).map((f) => normalizeFieldName(f.name)));
    let hasEmpty = false;
    for (const [k, v] of Object.entries(p.data ?? {})) {
      if (!hasValue(v)) {
        hasEmpty = true;
        continue;
      }
      const norm = normalizeFieldName(k);
      if (!defined.has(norm) && !NEVER.has(norm)) {
        orphanByKey.set(k, (orphanByKey.get(k) ?? 0) + 1);
        orphanIds.add(p.id);
      }
    }
    if (hasEmpty) {
      emptyValues++;
      emptyValueIds.push(p.id);
    }
  }
  orphanByKey.forEach((n, key) => orphanValues.push({ key, products: n }));
  orphanValues.sort((a, b) => b.products - a.products);

  const oldLimit = Date.now() - OLD_DAYS * 86400000;
  const drafts = prods.filter((p) => p.status === "draft");
  const oldDrafts = drafts.filter((p) => new Date(p.created_at).getTime() < oldLimit);
  const emptySubs = cats.filter((c) => c.parent_id && !withProducts.has(c.id));
  const emptyTops = cats.filter(
    (c) => !c.parent_id && !withProducts.has(c.id) && !cats.some((x) => x.parent_id === c.id && withProducts.has(x.id))
  );
  const noCategory = prods.filter((p) => !p.category_id);
  const noPrice = prods.filter((p) => {
    const v = ["precio", "precio_venta", "price"].map((k) => getValue(p.data, k)).find((x) => x !== undefined && x !== null && x !== "");
    return v === undefined;
  });

  // Fotos del bucket sin producto (con margen de 10 min)
  const referenced = new Set(prods.map((p) => p.image_url?.split("/product-images/")[1]).filter(Boolean) as string[]);
  const { data: files } = await admin.storage.from("product-images").list(userId, { limit: 1000 });
  const orphanPhotos = (files ?? [])
    .filter((f) => {
      const path = `${userId}/${f.name}`;
      const age = Date.now() - new Date(f.created_at ?? 0).getTime();
      return !referenced.has(path) && age > 10 * 60 * 1000;
    })
    .map((f) => `${userId}/${f.name}`);

  return {
    counts: {
      oldDrafts: oldDrafts.length,
      drafts: drafts.length,
      emptySubs: emptySubs.length,
      emptyTops: emptyTops.length,
      orphanPhotos: orphanPhotos.length,
      noCategory: noCategory.length,
      noPrice: noPrice.length,
      trash: trash.length,
      emptyFields: emptyFields.length,
      emptyValues,
      orphanValues: orphanValues.reduce((s, o) => s + o.products, 0),
    },
    detail: {
      emptyFields: emptyFields.map((f) => `${f.name}${f.scope && f.scope !== "todas" ? ` (${f.scope})` : ""}`),
      orphanValues: orphanValues.slice(0, 12).map((o) => `${o.key} (${o.products})`),
    },
    ids: {
      oldDrafts: oldDrafts.map((p) => p.id),
      emptySubs: emptySubs.map((c) => c.id),
      emptyTops: emptyTops.map((c) => c.id),
      orphanPhotos,
      emptyFields: emptyFields.map((f) => f.id),
      emptyValueIds,
      orphanIds: Array.from(orphanIds),
    },
    oldDays: OLD_DAYS,
    trashDays: TRASH_DAYS,
  };
}

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const s = await summary(user.id);
  return NextResponse.json({ counts: s.counts, detail: s.detail, oldDays: s.oldDays, trashDays: s.trashDays }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * POST /api/cleanup { actions: ["oldDrafts"|"emptySubs"|"emptyTops"|"orphanPhotos"] }
 * Ejecuta solo lo marcado. Los productos sin categoría o sin precio NO se borran nunca (se listan para resolver).
 */
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { actions } = (await request.json().catch(() => ({}))) as { actions?: string[] };
  const set = new Set(actions ?? []);
  const admin = createAdminClient();
  const s = await summary(user.id);
  const done: Record<string, number> = {};

  if (set.has("oldDrafts") && s.ids.oldDrafts.length) {
    // borra también sus fotos
    const { data: rows } = await admin.from("products").select("image_url").in("id", s.ids.oldDrafts);
    const paths = (rows ?? []).map((r) => r.image_url?.split("/product-images/")[1]).filter(Boolean) as string[];
    if (paths.length) await admin.storage.from("product-images").remove(paths);
    const { error } = await admin.from("products").delete().in("id", s.ids.oldDrafts);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    done.oldDrafts = s.ids.oldDrafts.length;
  }
  if (set.has("emptySubs") && s.ids.emptySubs.length) {
    const { error } = await admin.from("categories").delete().in("id", s.ids.emptySubs);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    done.emptySubs = s.ids.emptySubs.length;
  }
  if (set.has("emptyTops") && s.ids.emptyTops.length) {
    const { error } = await admin.from("categories").delete().in("id", s.ids.emptyTops);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    done.emptyTops = s.ids.emptyTops.length;
  }
  if (set.has("orphanPhotos") && s.ids.orphanPhotos.length) {
    await admin.storage.from("product-images").remove(s.ids.orphanPhotos);
    done.orphanPhotos = s.ids.orphanPhotos.length;
  }
  if (set.has("emptyFields") && s.ids.emptyFields.length) {
    // Quita los datos que nadie llena (la información guardada no se toca: esas columnas están vacías)
    const { error } = await admin.from("field_templates").delete().in("id", s.ids.emptyFields);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    done.emptyFields = s.ids.emptyFields.length;
  }
  if ((set.has("emptyValues") || set.has("orphanValues")) && (s.ids.emptyValueIds.length || s.ids.orphanIds.length)) {
    // Limpia dentro de cada producto: valores vacíos y/o datos sueltos que ya no pertenecen a su categoría
    const ids = Array.from(new Set([...(set.has("emptyValues") ? s.ids.emptyValueIds : []), ...(set.has("orphanValues") ? s.ids.orphanIds : [])]));
    const { data: rows } = await admin.from("products").select("id,category_id,data").in("id", ids);
    const bids2 = await businessIdsOf(admin, user.id);
    const [{ data: cats2 }, { data: tpls2 }] = await Promise.all([
      admin.from("categories").select("*").in("business_id", bids2),
      admin.from("field_templates").select("*").in("business_id", bids2),
    ]);
    let cleanedEmpty = 0;
    let cleanedOrphan = 0;
    for (const row of rows ?? []) {
      const defined = new Set(getEffectiveFields(tpls2 ?? [], cats2 ?? [], row.category_id).map((f) => normalizeFieldName(f.name)));
      const next: ProductData = {};
      let changed = false;
      for (const [k, v] of Object.entries(row.data ?? {})) {
        const empty = v === null || v === undefined || String(v).trim() === "";
        const norm = normalizeFieldName(k);
        const orphan = !empty && !defined.has(norm) && !KEEP_KEYS.has(norm);
        if (empty && set.has("emptyValues")) {
          changed = true;
          cleanedEmpty++;
          continue;
        }
        if (orphan && set.has("orphanValues")) {
          changed = true;
          cleanedOrphan++;
          continue;
        }
        next[k] = v as ProductData[string];
      }
      if (changed) await admin.from("products").update({ data: next }).eq("id", row.id);
    }
    if (set.has("emptyValues")) done.emptyValues = cleanedEmpty;
    if (set.has("orphanValues")) done.orphanValues = cleanedOrphan;
  }
  if (set.has("emptyTrash")) {
    // Vaciar la papelera: borrado definitivo con fotos
    const { data: rows } = await admin.from("products").select("id,image_url").in("business_id", await businessIdsOf(admin, user.id)).not("deleted_at", "is", null);
    const paths = (rows ?? []).map((r) => r.image_url?.split("/product-images/")[1]).filter(Boolean) as string[];
    if (paths.length) await admin.storage.from("product-images").remove(paths);
    if (rows?.length) await admin.from("products").delete().in("id", rows.map((r) => r.id));
    done.emptyTrash = rows?.length ?? 0;
  }

  const after = await summary(user.id);
  return NextResponse.json({ done, counts: after.counts, oldDays: after.oldDays });
}
