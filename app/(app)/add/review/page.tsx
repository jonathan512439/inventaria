"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Category, FieldTemplate, Product, ProductData, ProductVariant, VariantAxis } from "@/types/database";
import { findSibling, nameKey } from "@/lib/categories";
import { applyDefaults, canonicalizeData, coerceValue, fieldLabel, getEffectiveFields, productTitle } from "@/lib/fields";
import { useQueue, queueSummary, removeByProductId } from "@/lib/queue";
import { axesFor, combos, matchProposals, sameValues, variantLabel } from "@/lib/variants";
import { categoryColor } from "@/lib/colors";
import { adjustStock } from "@/lib/data/ops";
import { withCosts } from "@/lib/data/costs";
import { friendlyError } from "@/lib/errors";
import { signedPhotoUrl, storagePath } from "@/lib/photos";
import FieldInput from "@/components/FieldInput";
import ProductTable from "@/components/ProductTable";
import DuplicateNotice from "@/components/review/DuplicateNotice";
import LocationSection from "@/components/review/LocationSection";
import VariantSection, { cellKey } from "@/components/review/VariantSection";
import ExpirySection from "@/components/review/ExpirySection";
import MoreFields from "@/components/review/MoreFields";
import PhotoZoom from "@/components/review/PhotoZoom";
import { SWIPE, useSwipe } from "@/components/review/useSwipe";
import Photo from "@/components/ui/Photo";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { EmptyState, ScreenHeader } from "@/components/ui/Screen";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { IconArrowLeft, IconArrowRight, IconCamera, IconCheck, IconCheckCircle, IconEdit, IconPlus, IconRefresh, IconSparkles, IconTable, IconTrash, Spinner } from "@/components/ui/Icons";

const STOCK_RE = /^(stock|cantidad|existencias)$/i;

export default function ReviewPage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <Review />
    </Suspense>
  );
}

/**
 * Revisar pendientes (C7.4, antes /review): una tarjeta por producto que reconoció la IA.
 * Confirmar y siguiente (o deslizar a la derecha); «¿ya lo tienes?» suma stock; nada entra al inventario sin confirmar.
 * Las partes de la tarjeta viven en components/review/*.
 */
function Review() {
  const supabase = createClient();
  const toast = useToast();
  const ask = useConfirm();
  const router = useRouter();
  const params = useSearchParams();
  const queue = useQueue();
  const qDone = queueSummary(queue.items).done;
  const tableView = params.get("view")?.split("?")[0] === "table";

  const [categories, setCategories] = useState<Category[]>([]);
  const [templates, setTemplates] = useState<FieldTemplate[]>([]);
  const [axes, setAxes] = useState<VariantAxis[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<{ data: ProductData; categoryId: string | null } | null>(null);
  const [expiresAt, setExpiresAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [settingUp, setSettingUp] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [openIn, setOpenIn] = useState<{ id: string; nonce: number } | null>(null);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [merging, setMerging] = useState(false);
  // Variantes: opciones marcadas y stock escrito por casilla
  const [variantsOn, setVariantsOn] = useState<boolean | null>(null);
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const [cellStock, setCellStock] = useState<Record<string, string>>({});
  const [existingVariants, setExistingVariants] = useState<ProductVariant[]>([]);

  const load = useCallback(async () => {
    const [c, t, p, a] = await Promise.all([
      supabase.from("categories").select("*"),
      supabase.from("field_templates").select("*").order("sort_order"),
      supabase.from("products").select("*").eq("status", "draft").is("deleted_at", null).order("created_at", { ascending: true }),
      supabase.from("variant_axes").select("*").order("sort_order"),
    ]);
    setCategories(c.data ?? []);
    setTemplates(t.data ?? []);
    setProducts(await withCosts(supabase, p.data ?? [])); // costo (025): solo le llega al dueño
    setAxes((a.data ?? []) as VariantAxis[]);
    setLoading(false);
  }, [supabase]);
  useEffect(() => {
    load();
  }, [load, qDone]);

  // Si venimos de una miniatura (?id=), empezamos por ese producto
  const startId = params.get("id")?.split("?")[0];
  useEffect(() => {
    if (startId && products.length) {
      const i = products.findIndex((p) => p.id === startId);
      if (i >= 0) setIndex(i);
    }
  }, [startId, products]);

  const current = products[Math.min(index, products.length - 1)];

  // Al cambiar de producto: su borrador local (con valores por defecto en lo vacío) y sus variantes
  useEffect(() => {
    if (!current) return setDraft(null);
    const fields = getEffectiveFields(templates, categories, current.category_id);
    setDraft({ data: applyDefaults(fields, canonicalizeData(current.data, fields)), categoryId: current.category_id });
    setExpiresAt(current.expires_at ?? "");
    setVariantsOn(null);
    setChosen({});
    setCellStock({});
    setExistingVariants([]);
    supabase
      .from("product_variants")
      .select("*")
      .eq("product_id", current.id)
      .then(({ data: vs }) => {
        const list = (vs ?? []) as ProductVariant[];
        setExistingVariants(list);
        if (!list.length) return;
        const ch: Record<string, string[]> = {};
        const st: Record<string, string> = {};
        list.forEach((v) => {
          Object.entries(v.values).forEach(([k, val]) => {
            ch[k] = ch[k] ?? [];
            if (!ch[k].includes(val)) ch[k].push(val);
          });
          st[cellKey(v.values)] = String(v.stock);
        });
        setChosen(ch);
        setCellStock(st);
        setVariantsOn(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, templates, categories]);

  // Precarga la foto del siguiente (enlace firmado: el bucket es privado desde 026)
  useEffect(() => {
    const next = products[index + 1];
    if (next?.image_url)
      signedPhotoUrl(next.image_url).then((u) => {
        if (u) new Image().src = u;
      });
  }, [products, index]);

  // Variantes: ejes de la categoría elegida y propuestas de la IA emparejadas con ellos
  const axesHere = useMemo(() => (draft ? axesFor(axes, categories, draft.categoryId) : []), [axes, categories, draft]);
  const proposals = useMemo(() => matchProposals(current?.ai_meta?.variantes_propuestas, axesHere), [current, axesHere]);
  useEffect(() => {
    // Si la IA vio variantes y la categoría las maneja, se pre-marcan (solo si el usuario aún no decidió)
    if (variantsOn === null && axesHere.length && Object.keys(proposals).length && !existingVariants.length) {
      setChosen(proposals);
      setVariantsOn(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposals, axesHere.length]);
  const variantCells = useMemo(() => (variantsOn && axesHere.length ? combos(axesHere, chosen) : []), [variantsOn, axesHere, chosen]);
  const variantRows = useMemo(() => variantCells.map((values) => ({ values, raw: cellStock[cellKey(values)] ?? "" })).filter((c) => c.raw.trim() !== ""), [variantCells, cellStock]);
  const variantTotal = variantRows.reduce((t, c) => t + (parseInt(c.raw, 10) || 0), 0);

  const fields = useMemo(() => (draft ? getEffectiveFields(templates, categories, draft.categoryId) : []), [draft, templates, categories]);
  const setValue = (f: FieldTemplate, v: string) => setDraft((d) => (d ? { ...d, data: { ...d.data, [f.name]: v } } : d));

  const next = () => {
    if (index < products.length - 1) {
      navigator.vibrate?.(8);
      setIndex((i) => i + 1);
    }
  };
  const swipe = useSwipe(() => save("confirmed"), next);

  /**
   * Guarda las variantes mientras el producto sigue Pendiente: crea/actualiza las casillas con stock y borra las demás.
   * Debe ir ANTES de confirmarlo: con el producto ya «En inventario», la base (024) solo deja cambiar su stock
   * dentro de una operación (venta, entrada, ajuste, conteo) y rechazaría estas escrituras.
   */
  async function saveVariants(productId: string): Promise<string | null> {
    const keep = new Set<string>();
    for (const row of variantRows) {
      const stock = Math.max(0, parseInt(row.raw, 10) || 0);
      const found = existingVariants.find((v) => sameValues(v.values, row.values));
      if (found) {
        keep.add(found.id);
        if (found.stock !== stock) {
          const { error } = await supabase.from("product_variants").update({ stock }).eq("id", found.id);
          if (error) return friendlyError(error);
        }
      } else {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const { error } = await supabase.from("product_variants").insert({ user_id: user!.id, product_id: productId, values: row.values, label: variantLabel(row.values, axesHere), stock });
        if (error) return friendlyError(error);
      }
    }
    const gone = existingVariants.filter((v) => !keep.has(v.id)).map((v) => v.id);
    if (gone.length) {
      const { error } = await supabase.from("product_variants").delete().in("id", gone);
      if (error) return friendlyError(error);
    }
    return null;
  }

  async function save(status: "draft" | "confirmed") {
    if (!current || !draft || saving) return;
    setSaving(true);
    const clean: ProductData = { ...draft.data };
    fields.forEach((f) => (clean[f.name] = coerceValue(f, draft.data[f.name])));
    const withVariants = variantsOn === true && variantRows.length > 0 && axesHere.length > 0;
    if (withVariants) {
      // Con variantes el stock del producto es la suma de sus casillas
      clean[fields.find((f) => STOCK_RE.test(f.name))?.name ?? "stock"] = variantTotal;
      const err = await saveVariants(current.id);
      if (err) {
        setSaving(false);
        return toast("error", err);
      }
    } else if (existingVariants.length) {
      // Sin variantes: se borran antes, para que el stock escrito a mano no sea pisado por la suma
      await supabase.from("product_variants").delete().eq("product_id", current.id);
    }
    const { error } = await supabase.from("products").update({ data: clean, category_id: draft.categoryId, status, expires_at: expiresAt || null }).eq("id", current.id);
    setSaving(false);
    if (error) return toast("error", friendlyError(error));
    if (status === "confirmed") {
      const id = current.id;
      const position = index;
      navigator.vibrate?.(20);
      setLeaving(true);
      await new Promise((r) => setTimeout(r, 260));
      setLeaving(false);
      setConfirmedCount((n) => n + 1);
      removeByProductId(id);
      setProducts((list) => list.filter((p) => p.id !== id));
      window.scrollTo({ top: 0, behavior: "smooth" });
      toast("success", "Guardado en el inventario", {
        label: "Deshacer",
        onClick: async () => {
          await supabase.from("products").update({ status: "draft" }).eq("id", id);
          await load();
          setIndex(position);
        },
      });
    } else {
      setProducts((list) => list.map((p) => (p.id === current.id ? { ...p, data: clean, category_id: draft.categoryId } : p)));
      toast("success", "Guardado. Sigue pendiente de confirmar");
      if (index < products.length - 1) {
        setIndex((i) => i + 1);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    }
  }

  async function deletePending(p: Product) {
    const { error } = await supabase.from("products").delete().eq("id", p.id);
    if (error) return friendlyError(error);
    const path = storagePath(p.image_url);
    if (path) await supabase.storage.from("product-images").remove([path]);
    setProducts((list) => list.filter((x) => x.id !== p.id));
    return null;
  }

  async function remove() {
    if (!current) return;
    const ok = await ask({ title: "¿Eliminar este producto?", body: "Se borra junto con su foto. Todavía no estaba en el inventario, así que no se puede recuperar.", confirmLabel: "Eliminar", tone: "danger" });
    if (!ok) return;
    const err = await deletePending(current);
    if (err) toast("error", err);
  }

  /** Duplicado: sumar el stock del pendiente al producto existente y borrar el pendiente (y su foto). */
  async function mergeIntoExisting(existingId: string) {
    if (!current || !draft) return;
    setMerging(true);
    const { data: existing } = await supabase.from("products").select("*").eq("id", existingId).maybeSingle();
    if (!existing) {
      setMerging(false);
      return toast("error", "El producto original ya no existe");
    }
    const { count: nVariants } = await supabase.from("product_variants").select("id", { count: "exact", head: true }).eq("product_id", existingId);
    const qty = Math.max(1, parseInt(String(draft.data.stock ?? draft.data.cantidad ?? 1), 10) || 1);
    if (!nVariants) {
      // Suma atómica en el servidor (021); el id del pendiente hace que repetir el toque no sume dos veces
      try {
        await adjustStock(supabase, { id: current.id, productId: existingId, delta: qty, tipo: "entrada", motivo: "foto repetida" });
      } catch (e) {
        setMerging(false);
        return toast("error", friendlyError(e));
      }
    }
    const err = await deletePending(current);
    removeByProductId(current.id);
    setMerging(false);
    if (err) return toast("error", err);
    navigator.vibrate?.(20);
    toast(
      "success",
      nVariants ? "Pendiente descartado. Ese producto tiene variantes: suma el stock desde su ficha." : `+${qty} al stock de «${productTitle(existing.data)}». Pendiente descartado.`,
      nVariants ? { label: "Abrir ficha", onClick: () => router.push(`/products/${existingId}`) } : undefined
    );
  }

  /** Duplicado: es otro producto → se quita el aviso. */
  async function notDuplicate() {
    if (!current) return;
    const ai_meta = { ...(current.ai_meta ?? {}), posible_duplicado: null };
    await supabase.from("products").update({ ai_meta }).eq("id", current.id);
    setProducts((list) => list.map((p) => (p.id === current.id ? { ...p, ai_meta } : p)));
  }

  /** Vuelve a analizar la foto del producto actual (1 petición de IA). */
  async function reanalyze() {
    if (!current) return;
    const ok = await ask({
      title: "¿Que la IA lea la foto otra vez?",
      body: "Vuelve a llenar los datos y puede cambiar la categoría. No toca el precio ni el stock.",
      details: [{ label: "Análisis que usa", value: "1 de tu cupo diario", tone: "warn" }],
      confirmLabel: "Sí, analizar de nuevo",
      tone: "primary",
    });
    if (!ok) return;
    setReanalyzing(true);
    const res = await fetch("/api/reanalyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product_id: current.id }) });
    const json = (await res.json().catch(() => ({}))) as { changed?: string[]; error?: string };
    setReanalyzing(false);
    if (!res.ok) return toast("error", json.error || "No se pudo volver a analizar");
    await load();
    toast("success", json.changed?.length ? `Actualizado: ${json.changed.map(fieldLabel).join(", ")}` : "La IA no encontró nada nuevo");
  }

  /** Pide al servidor que elija la subcategoría dentro de una categoría (texto → IA si hace falta). */
  async function autoSubcategory(productId: string, categoryId: string) {
    setClassifying(true);
    const res = await fetch("/api/classify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product_id: productId, category_id: categoryId }) });
    const json = (await res.json().catch(() => ({}))) as { category_id?: string; subcategory?: string | null; error?: string };
    setClassifying(false);
    if (!res.ok) return toast("error", json.error || "No se pudo elegir la subcategoría");
    if (json.category_id) setDraft((d) => (d ? { ...d, categoryId: json.category_id! } : d));
    if (json.subcategory) toast("success", `Subcategoría: ${json.subcategory}`);
    else {
      toast("info", "Sin subcategoría clara: elige o crea una");
      setOpenIn({ id: categoryId, nonce: Date.now() });
    }
  }

  /** Crea la subcategoría que sugirió la IA dentro de la categoría elegida (o usa la que ya existía). */
  async function createSuggestedCategory(parent: string) {
    const name = current?.ai_meta?.categoria_nueva;
    if (!name) return;
    const dup = findSibling(categories, parent, name);
    if (dup) {
      setDraft((d) => (d ? { ...d, categoryId: dup.id } : d));
      return toast("info", `Ya existía «${dup.name}»: asignada`);
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error } = await supabase.from("categories").insert({ name, parent_id: parent, user_id: user!.id }).select().single();
    if (error) return toast("error", friendlyError(error));
    setCategories((c) => [...c, data]);
    setDraft((d) => (d ? { ...d, categoryId: data.id } : d));
    toast("success", `Subcategoría «${name}» creada`);
  }

  /** Crea con la IA una categoría nueva para un producto que no encaja y lo asigna. */
  async function setupAndAssign() {
    if (!current || !draft) return;
    const meta = current.ai_meta ?? {};
    const title = productTitle(draft.data);
    const generalName = meta.categoria_nueva_general || meta.categoria_nueva || null;
    setSettingUp(true);
    const res = await fetch("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: `${generalName || title || meta.etiqueta || "Productos varios"}. Ejemplo de producto: ${title || meta.etiqueta || ""}`, ensure_section: meta.categoria_nueva ?? undefined }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string; types?: string[] };
    if (!res.ok) {
      setSettingUp(false);
      return toast("error", json.error || "No se pudo crear");
    }
    const [{ data: cats }, { data: tpls }] = await Promise.all([supabase.from("categories").select("*"), supabase.from("field_templates").select("*").order("sort_order")]);
    const all = cats ?? [];
    setCategories(all);
    setTemplates(tpls ?? []);
    const typeName = json.types?.[0];
    const top = all.find((c) => !c.parent_id && nameKey(c.name) === nameKey(typeName ?? ""));
    setSettingUp(false);
    if (!top) return toast("error", "La categoría no se encontró tras crearla");
    // Subcategoría: la que sugirió la IA si se creó; si no, la elige el clasificador
    const sub = meta.categoria_nueva ? all.find((c) => c.parent_id === top.id && nameKey(c.name) === nameKey(meta.categoria_nueva!)) : undefined;
    if (sub) {
      setDraft((d) => (d ? { ...d, categoryId: sub.id } : d));
      toast("success", `Asignado a ${top.icon ? top.icon + " " : ""}${top.name} › ${sub.name}. Puedes cambiarlo con «Cambiar».`);
    } else {
      setDraft((d) => (d ? { ...d, categoryId: top.id } : d));
      toast("success", `Categoría «${typeName}» creada`);
      await autoSubcategory(current.id, top.id);
    }
  }

  // ---------- Vistas ----------
  const header = (
    <ScreenHeader
      title="Revisar pendientes"
      subtitle={loading ? " " : products.length ? `${products.length} por revisar` : "Sin pendientes"}
      back={{ href: "/add", label: "Agregar" }}
      action={
        products.length > 0 && (
          <button onClick={() => router.replace(tableView ? "/add/review" : "/add/review?view=table")} className="chip hidden min-h-[44px] md:inline-flex">
            {tableView ? <IconCheckCircle size={16} /> : <IconTable size={16} />} {tableView ? "Tarjetas" : "Tabla"}
          </button>
        )
      }
      help={
        <>
          <p>Cada tarjeta es un producto que reconoció la IA. Arriba, dónde va (categoría y subcategoría); luego el nombre, el <b>precio</b> y el <b>stock</b>.</p>
          <p>Toca <b>Confirmar y pasar al siguiente</b> (o desliza la tarjeta a la derecha). Deslizar a la izquierda salta al siguiente sin guardar.</p>
          <p>Si la IA cree que ya tienes ese producto, te ofrece <b>sumar el stock</b> en vez de duplicarlo.</p>
        </>
      }
    />
  );

  if (loading)
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {header}
        <CardSkeleton />
      </div>
    );

  if (tableView)
    return (
      <div className="space-y-4">
        {header}
        <ProductTable products={products} categories={categories} templates={templates} mode="draft" onChanged={load} />
      </div>
    );

  if (!current || !draft)
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {header}
        <EmptyState
          icon={<IconCheckCircle size={28} />}
          title={confirmedCount > 0 ? `¡${confirmedCount} producto${confirmedCount > 1 ? "s" : ""} al inventario!` : "Nada pendiente"}
          body="Cuando agregues productos con foto, aparecen aquí para que los confirmes."
          action={
            <div className="grid gap-2">
              <Link href="/add?mode=photo" className="btn-primary"><IconCamera size={18} /> Agregar con foto</Link>
              <Link href="/add?mode=manual" className="btn-secondary"><IconPlus size={18} /> Escribir uno a mano</Link>
              <Link href="/products" className="btn-secondary">Ver Productos</Link>
            </div>
          }
        />
      </div>
    );

  const title = productTitle(draft.data);
  const meta = current.ai_meta ?? {};
  const nameField = fields.find((f) => /^(nombre|name|producto|titulo)$/i.test(f.name)) ?? null;
  const keyFields = fields.filter((f) => !f.is_ai_fillable && f.field_type === "number" && /^(precio|price|stock|cantidad|existencias)$/i.test(f.name));
  const otherFields = fields.filter((f) => f !== nameField && !keyFields.includes(f));
  const cat = draft.categoryId ? categories.find((c) => c.id === draft.categoryId) ?? null : null;
  const color = categoryColor((cat?.parent_id ? categories.find((c) => c.id === cat.parent_id) : cat)?.name);
  const variantsLive = variantsOn === true && variantRows.length > 0;
  const { dragX } = swipe;

  return (
    <div className="has-action mx-auto max-w-2xl space-y-4">
      {header}

      <div className="relative">
        {/* Indicadores del gesto */}
        {dragX > 30 && (
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 flex w-28 items-center justify-center rounded-l-3xl bg-ok-500/90 text-white" style={{ opacity: Math.min(1, dragX / SWIPE) }}>
            <span className="flex flex-col items-center text-xs font-bold"><IconCheck size={28} /> Confirmar</span>
          </div>
        )}
        {dragX < -30 && (
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 flex w-28 items-center justify-center rounded-r-3xl bg-slate-700/90 text-white" style={{ opacity: Math.min(1, -dragX / SWIPE) }}>
            <span className="flex flex-col items-center text-xs font-bold"><IconArrowRight size={28} /> Siguiente</span>
          </div>
        )}
        <article
          key={current.id}
          className={`card space-y-5 p-0 ${leaving ? "animate-out-left" : dragX === 0 ? "animate-in-right" : ""}`}
          style={{ transform: dragX ? `translateX(${dragX}px) rotate(${dragX / 40}deg)` : undefined, transition: dragX ? "none" : "transform 0.2s", touchAction: "pan-y" }}
          {...swipe.handlers}
        >
          {/* Foto (toca para ampliar) */}
          <button type="button" onClick={() => setZoom(true)} className="relative block aspect-[4/3] w-full overflow-hidden rounded-t-3xl bg-slate-100 text-left">
            {current.image_url && <Photo src={current.image_url} wrapperClassName="h-full w-full" className="h-full w-full object-contain" />}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-5 pb-3 pt-10 text-white">
              <p className="truncate text-lg font-bold">{title || "Sin nombre"}</p>
            </div>
            <span className="absolute right-3 top-3 rounded-full bg-black/45 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur">Toca para ampliar</span>
            {cat && <span className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${color.bg} ${color.text} ${color.ring}`}>{cat.icon ? `${cat.icon} ` : ""}{cat.name}</span>}
          </button>

          <div className="stagger space-y-5 px-5 pb-5">
            {meta.posible_duplicado && (
              <DuplicateNotice
                dup={meta.posible_duplicado}
                qty={Math.max(1, parseInt(String(draft.data.stock ?? 1), 10) || 1)}
                busy={merging}
                onMerge={() => mergeIntoExisting(meta.posible_duplicado!.product_id)}
                onNotDuplicate={notDuplicate}
              />
            )}

            <LocationSection
              product={current}
              title={title}
              categories={categories}
              onCategoriesChange={setCategories}
              categoryId={draft.categoryId}
              onCategory={(v) => setDraft((d) => (d ? { ...d, categoryId: v } : d))}
              openIn={openIn}
              busy={{ settingUp, classifying }}
              onCreateSuggested={createSuggestedCategory}
              onAutoSub={(catId) => autoSubcategory(current.id, catId)}
              onSetup={setupAndAssign}
            />

            {nameField && (
              <div>
                <label className="label flex items-center gap-1">{fieldLabel(nameField.name)} <IconSparkles size={12} className="text-brand-500" /></label>
                <FieldInput field={nameField} value={draft.data[nameField.name]} onChange={(v) => setValue(nameField, v)} className="input font-semibold" />
              </div>
            )}

            {axesHere.length > 0 && (
              <VariantSection
                axes={axesHere}
                proposals={proposals}
                on={variantsOn}
                onToggle={setVariantsOn}
                chosen={chosen}
                onChosen={setChosen}
                cellStock={cellStock}
                onCellStock={(values, raw) => setCellStock((m) => ({ ...m, [cellKey(values)]: raw }))}
                total={variantTotal}
                rows={variantRows.length}
                cells={variantCells.length}
              />
            )}
            {axesHere.length === 0 && draft.categoryId && meta.variantes_propuestas && Object.keys(meta.variantes_propuestas).length > 0 && (
              <p className="rounded-2xl bg-violet-50 p-3 text-xs text-violet-900">
                ✨ La IA vio varias opciones ({Object.values(meta.variantes_propuestas).flat().slice(0, 6).join(", ")}). Para llevar el stock de cada una, agrega variantes a la categoría en{" "}
                <Link href="/store" className="font-semibold underline">Mi tienda</Link>.
              </p>
            )}

            {/* Precio y stock: lo que completa la persona, grande */}
            {keyFields.length > 0 && (
              <section>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Completa tú</p>
                <div className="grid grid-cols-2 gap-3">
                  {keyFields.map((f) =>
                    variantsLive && STOCK_RE.test(f.name) ? (
                      <div key={f.id} className="rounded-2xl bg-violet-50 p-3 ring-1 ring-violet-200">
                        <label className="label mb-1">{fieldLabel(f.name)}</label>
                        <p className="text-2xl font-bold tabular-nums text-violet-900">{variantTotal}</p>
                        <p className="text-xs text-violet-700">suma de las variantes</p>
                      </div>
                    ) : (
                      <div key={f.id} className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
                        <label className="label mb-1">{fieldLabel(f.name)}</label>
                        <FieldInput field={f} value={draft.data[f.name]} onChange={(v) => setValue(f, v)} className="input-lg text-2xl tabular-nums" />
                      </div>
                    )
                  )}
                </div>
              </section>
            )}

            <ExpirySection value={expiresAt} readFromPackage={!!current.expires_at && expiresAt === current.expires_at} onChange={setExpiresAt} />

            <MoreFields fields={otherFields} data={draft.data} etiqueta={meta.etiqueta} onChange={setValue} />

            {fields.length === 0 && draft.categoryId && (
              <p className="rounded-2xl bg-warn-50 p-3 text-sm text-warn-800">
                Esta categoría aún no tiene datos definidos. <Link href="/templates" className="font-semibold underline">Definir datos</Link>
              </p>
            )}

            <div className="grid gap-2 pt-1">
              <div className="sticky-action">
                <button onClick={() => save("confirmed")} className={`btn-success btn-lg w-full ${leaving ? "pulse-success" : ""}`} disabled={saving}>
                  {saving ? <Spinner /> : <IconCheck size={22} />} Confirmar y pasar al siguiente
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => save("draft")} className="btn-secondary" disabled={saving}><IconEdit size={16} /> Guardar y seguir</button>
                <button onClick={remove} className="btn-destructive" disabled={saving}><IconTrash size={16} /> Eliminar</button>
              </div>
              {current.image_url && (
                <button onClick={reanalyze} disabled={saving || reanalyzing} className="btn-secondary w-full border-brand-300 text-brand-700">
                  {reanalyzing ? <Spinner size={16} /> : <IconRefresh size={16} />} ¿Se equivocó la IA? Volver a analizar la foto
                </button>
              )}
            </div>
          </div>
        </article>
      </div>

      {zoom && current.image_url && <PhotoZoom src={current.image_url} caption={meta.etiqueta} onClose={() => setZoom(false)} />}

      {/* Navegación entre pendientes */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <button className="btn-secondary min-h-[44px] justify-self-start" disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}><IconArrowLeft size={18} /> Anterior</button>
        <span className="text-center text-sm font-semibold text-slate-600">
          {index + 1} de {products.length}
          <span className="hidden text-xs font-normal text-muted sm:block">o desliza la tarjeta</span>
        </span>
        <button className="btn-secondary min-h-[44px] justify-self-end" disabled={index >= products.length - 1} onClick={next}>Siguiente <IconArrowRight size={18} /></button>
      </div>
    </div>
  );
}
