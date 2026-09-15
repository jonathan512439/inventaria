import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getValue } from "@/lib/fields";

export const runtime = "edge";

const OLD_DAYS = 7;
const TRASH_DAYS = 30;

/** Borra definitivamente (con su foto) lo que lleva más de 30 días en la papelera. */
async function purgeTrash(userId: string) {
  const admin = createAdminClient();
  const limit = new Date(Date.now() - TRASH_DAYS * 86400000).toISOString();
  const { data: rows } = await admin.from("products").select("id,image_url").eq("user_id", userId).not("deleted_at", "is", null).lt("deleted_at", limit);
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
  const [{ data: allProducts }, { data: categories }] = await Promise.all([
    admin.from("products").select("id,status,category_id,data,image_url,created_at,deleted_at").eq("user_id", userId),
    admin.from("categories").select("id,name,parent_id").eq("user_id", userId),
  ]);
  const trash = (allProducts ?? []).filter((p) => p.deleted_at);
  const prods = (allProducts ?? []).filter((p) => !p.deleted_at);
  const cats = categories ?? [];
  const withProducts = new Set(prods.map((p) => p.category_id).filter(Boolean) as string[]);

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
    },
    ids: {
      oldDrafts: oldDrafts.map((p) => p.id),
      emptySubs: emptySubs.map((c) => c.id),
      emptyTops: emptyTops.map((c) => c.id),
      orphanPhotos,
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
  return NextResponse.json({ counts: s.counts, oldDays: s.oldDays, trashDays: s.trashDays }, { headers: { "Cache-Control": "no-store" } });
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
  if (set.has("emptyTrash")) {
    // Vaciar la papelera: borrado definitivo con fotos
    const { data: rows } = await admin.from("products").select("id,image_url").eq("user_id", user.id).not("deleted_at", "is", null);
    const paths = (rows ?? []).map((r) => r.image_url?.split("/product-images/")[1]).filter(Boolean) as string[];
    if (paths.length) await admin.storage.from("product-images").remove(paths);
    if (rows?.length) await admin.from("products").delete().in("id", rows.map((r) => r.id));
    done.emptyTrash = rows?.length ?? 0;
  }

  const after = await summary(user.id);
  return NextResponse.json({ done, counts: after.counts, oldDays: after.oldDays });
}
