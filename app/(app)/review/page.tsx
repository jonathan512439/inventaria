"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import CoachTip from "@/components/CoachTip";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Category, FieldTemplate, Product, ProductData, ProductVariant, VariantAxis } from "@/types/database";
import { categoryPath, findSibling, findSimilar, nameKey } from "@/lib/categories";
import { applyDefaults, canonicalizeData, coerceValue, fieldLabel, getEffectiveFields, productTitle } from "@/lib/fields";
import { useQueue, queueSummary, removeByProductId } from "@/lib/queue";
import { getPreset } from "@/lib/presets";
import { axesFor, combos, matchProposals, sameValues, variantLabel } from "@/lib/variants";
import VariantGrid from "@/components/VariantGrid";
import CategoryPicker from "@/components/CategoryPicker";
import FieldInput from "@/components/FieldInput";
import ProductTable from "@/components/ProductTable";
import { CardSkeleton } from "@/components/ui/Skeleton";
import Photo from "@/components/ui/Photo";
import { categoryColor } from "@/lib/colors";
import { useToast } from "@/components/ui/Toast";
import {
  IconArrowLeft,
  IconArrowRight,
  IconCamera,
  IconCheck,
  IconCheckCircle,
  IconChevronRight,
  IconEdit,
  IconList,
  IconRefresh,
  IconPlus,
  IconSparkles,
  IconTable,
  IconTag,
  IconTrash,
  IconX,
  Spinner,
} from "@/components/ui/Icons";

export default function ReviewPage() {
  return (
    <Suspense>
      <Review />
    </Suspense>
  );
}

function Review() {
  const supabase = createClient();
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const queue = useQueue();
  const qDone = queueSummary(queue.items).done;

  const [categories, setCategories] = useState<Category[]>([]);
  const [templates, setTemplates] = useState<FieldTemplate[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<{ data: ProductData; categoryId: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [newParent, setNewParent] = useState<string | null>(null);
  const [settingUp, setSettingUp] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [leaving, setLeaving] = useState(false); // animación de salida de la tarjeta confirmada
  const [zoom, setZoom] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [openIn, setOpenIn] = useState<{ id: string; nonce: number } | null>(null);
  const [openPicker, setOpenPicker] = useState<{ step: string | null; nonce: number } | null>(null);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [merging, setMerging] = useState(false);

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
      const keys = Object.keys(existing.data);
      const key = ["stock", "cantidad", "existencias"].map((k) => keys.find((x) => x.toLowerCase() === k)).find(Boolean) ?? "stock";
      const cur = Number(existing.data[key] ?? 0) || 0;
      const { error } = await supabase.from("products").update({ data: { ...existing.data, [key]: cur + qty } }).eq("id", existingId);
      if (error) {
        setMerging(false);
        return toast("error", error.message);
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      await supabase.from("stock_movements").insert({ user_id: user!.id, product_id: existingId, product_name: productTitle(existing.data) || null, tipo: "entrada", cantidad: qty, motivo: "foto repetida", stock_resultante: cur + qty });
    }
    // Borrar el pendiente y su foto
    if (current.image_url) {
      const i = current.image_url.indexOf("/product-images/");
      if (i >= 0) await supabase.storage.from("product-images").remove([current.image_url.slice(i + "/product-images/".length)]);
    }
    await supabase.from("products").delete().eq("id", current.id);
    removeByProductId(current.id);
    setProducts((list) => list.filter((p) => p.id !== current.id));
    setMerging(false);
    navigator.vibrate?.(20);
    toast("success", nVariants ? "Pendiente descartado. Ese producto tiene variantes: suma el stock desde su ficha." : `+${qty} al stock de «${productTitle(existing.data)}». Pendiente descartado.`, nVariants ? { label: "Abrir ficha", onClick: () => router.push(`/products/${existingId}`) } : undefined);
  }

  /** Duplicado: el usuario dice que es otro producto → se quita el aviso. */
  async function notDuplicate() {
    if (!current) return;
    const ai_meta = { ...(current.ai_meta ?? {}), posible_duplicado: null };
    await supabase.from("products").update({ ai_meta }).eq("id", current.id);
    setProducts((list) => list.map((p) => (p.id === current.id ? { ...p, ai_meta } : p)));
  }
  // Variantes: ejes de la categoría, opciones marcadas y stock escrito por celda
  const [axes, setAxes] = useState<VariantAxis[]>([]);
  const [variantsOn, setVariantsOn] = useState<boolean | null>(null);
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const [cellStock, setCellStock] = useState<Record<string, string>>({});
  const [existingVariants, setExistingVariants] = useState<ProductVariant[]>([]);
  const cellKey = (values: Record<string, string>) => JSON.stringify(Object.keys(values).sort().map((k) => [k, values[k]]));

  /** Vuelve a analizar la foto del producto actual (1 petición de IA). */
  async function reanalyze() {
    if (!current) return;
    if (!confirm("La IA volverá a leer la foto y actualizará los datos y la categoría. Precio y stock se conservan.\n\nConsume 1 análisis de tu cupo diario. ¿Continuar?")) return;
    setReanalyzing(true);
    const res = await fetch("/api/reanalyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_id: current.id }),
    });
    const json = (await res.json().catch(() => ({}))) as { changed?: string[]; error?: string };
    setReanalyzing(false);
    if (!res.ok) return toast("error", json.error || "No se pudo volver a analizar");
    await load();
    toast("success", json.changed?.length ? `Actualizado: ${json.changed.map(fieldLabel).join(", ")}` : "La IA no encontró nada nuevo");
  }
  // Gesto: deslizar la tarjeta a la derecha = confirmar, a la izquierda = siguiente
  const [dragX, setDragX] = useState(0);
  const drag = useRef<{ x: number; y: number; active: boolean; horizontal: boolean | null }>({ x: 0, y: 0, active: false, horizontal: null });
  const SWIPE = 110;

  function onPointerDown(e: React.PointerEvent) {
    const t = e.target as HTMLElement;
    if (t.closest("input,select,textarea,button,a,[data-no-swipe]")) return;
    drag.current = { x: e.clientX, y: e.clientY, active: true, horizontal: null };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d.active) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (d.horizontal === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) d.horizontal = Math.abs(dx) > Math.abs(dy);
    if (d.horizontal) setDragX(Math.max(-160, Math.min(160, dx)));
  }
  function onPointerUp() {
    const d = drag.current;
    if (!d.active) return;
    d.active = false;
    const dx = dragX;
    setDragX(0);
    if (dx > SWIPE) save("confirmed");
    else if (dx < -SWIPE && index < products.length - 1) {
      navigator.vibrate?.(8);
      setIndex((i) => i + 1);
    }
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
  const types = useMemo(() => categories.filter((c) => !c.parent_id), [categories]);
  const tableView = params.get("view") === "table";

  const load = useCallback(async () => {
    const [c, t, p, a] = await Promise.all([
      supabase.from("categories").select("*"),
      supabase.from("field_templates").select("*").order("sort_order"),
      supabase.from("products").select("*").eq("status", "draft").is("deleted_at", null).order("created_at", { ascending: true }),
      supabase.from("variant_axes").select("*").order("sort_order"),
    ]);
    setCategories(c.data ?? []);
    setTemplates(t.data ?? []);
    setProducts(p.data ?? []);
    setAxes((a.data ?? []) as VariantAxis[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load, qDone]);

  // Si venimos de una miniatura (?id=), empezamos por ese producto
  useEffect(() => {
    const id = params.get("id");
    if (id && products.length) {
      const i = products.findIndex((p) => p.id === id);
      if (i >= 0) setIndex(i);
    }
  }, [params, products]);

  const current = products[Math.min(index, products.length - 1)];

  // Al cambiar de producto, cargamos su borrador local (con defaults aplicados a lo vacío)
  useEffect(() => {
    if (!current) return setDraft(null);
    const fields = getEffectiveFields(templates, categories, current.category_id);
    const data = applyDefaults(fields, canonicalizeData(current.data, fields));
    setDraft({ data, categoryId: current.category_id });
    // Variantes: las ya guardadas (si volvió a este pendiente) o las que propuso la IA
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
        if (list.length) {
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
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, templates, categories]);

  // Ejes de la categoría elegida y propuestas de la IA emparejadas con ellos
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
  const variantRows = useMemo(
    () => variantCells.map((values) => ({ values, raw: cellStock[cellKey(values)] ?? "" })).filter((c) => c.raw.trim() !== ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [variantCells, cellStock]
  );
  const variantTotal = variantRows.reduce((t, c) => t + (parseInt(c.raw, 10) || 0), 0);

  /** Guarda las variantes del producto: crea/actualiza las casillas con stock y borra las que ya no están. */
  async function saveVariants(productId: string) {
    if (!axesHere.length) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const keep = new Set<string>();
    for (const row of variantRows) {
      const stock = Math.max(0, parseInt(row.raw, 10) || 0);
      const found = existingVariants.find((v) => sameValues(v.values, row.values));
      if (found) {
        keep.add(found.id);
        if (found.stock !== stock) await supabase.from("product_variants").update({ stock }).eq("id", found.id);
      } else {
        await supabase.from("product_variants").insert({ user_id: user!.id, product_id: productId, values: row.values, label: variantLabel(row.values, axesHere), stock });
      }
    }
    const gone = existingVariants.filter((v) => !keep.has(v.id)).map((v) => v.id);
    if (gone.length) await supabase.from("product_variants").delete().in("id", gone);
  }

  const fields = useMemo(
    () => (draft ? getEffectiveFields(templates, categories, draft.categoryId) : []),
    [draft, templates, categories]
  );

  // Precarga la foto del siguiente producto para que el cambio sea inmediato
  useEffect(() => {
    const next = products[index + 1];
    if (next?.image_url) {
      const img = new Image();
      img.src = next.image_url;
    }
  }, [products, index]);
  const aiFields = fields.filter((f) => f.is_ai_fillable);
  const manualFields = fields.filter((f) => !f.is_ai_fillable);

  // Mientras se escribe guardamos el texto tal cual (permite "12." o "0,5"); se convierte al guardar.
  function setValue(f: FieldTemplate, v: string) {
    setDraft((d) => (d ? { ...d, data: { ...d.data, [f.name]: v } } : d));
  }

  async function save(status: "draft" | "confirmed") {
    if (!current || !draft) return;
    setSaving(true);
    const clean: ProductData = { ...draft.data };
    fields.forEach((f) => (clean[f.name] = coerceValue(f, draft.data[f.name])));
    const withVariants = variantsOn === true && variantRows.length > 0;
    if (withVariants) {
      // Con variantes el stock del producto es la suma de sus casillas
      const stockField = fields.find((f) => /^(stock|cantidad|existencias)$/i.test(f.name));
      clean[stockField?.name ?? "stock"] = variantTotal;
    }
    // Sin variantes: se borran ANTES de guardar, para que el stock escrito a mano no sea pisado por la suma
    if (!withVariants && existingVariants.length) await supabase.from("product_variants").delete().eq("product_id", current.id);
    const { error } = await supabase
      .from("products")
      .update({ data: clean, category_id: draft.categoryId, status })
      .eq("id", current.id);
    if (!error && withVariants) await saveVariants(current.id);
    setSaving(false);
    if (error) return toast("error", error.message);
    if (status === "confirmed") {
      const id = current.id;
      const position = index;
      navigator.vibrate?.(20);
      setLeaving(true);
      await new Promise((r) => setTimeout(r, 260));
      setLeaving(false);
      setMoreOpen(false);
      setConfirmedCount((n) => n + 1);
      removeByProductId(id);
      setProducts((list) => list.filter((p) => p.id !== id));
      window.scrollTo({ top: 0, behavior: "smooth" });
      toast("success", "Guardado en inventario", {
        label: "Deshacer",
        onClick: async () => {
          await supabase.from("products").update({ status: "draft" }).eq("id", id);
          await load();
          setIndex(position); // vuelve a la tarjeta deshecha
        },
      });
    } else {
      setProducts((list) => list.map((p) => (p.id === current.id ? { ...p, data: clean, category_id: draft.categoryId } : p)));
      toast("success", "Guardado. Sigue pendiente de confirmar");
      // avanza a la siguiente tarjeta si la hay
      if (index < products.length - 1) {
        setIndex((i) => i + 1);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    }
  }

  async function remove() {
    if (!current || !confirm("¿Eliminar este producto y su foto?")) return;
    if (current.image_url) {
      const i = current.image_url.indexOf("/product-images/");
      if (i >= 0) await supabase.storage.from("product-images").remove([current.image_url.slice(i + "/product-images/".length)]);
    }
    await supabase.from("products").delete().eq("id", current.id);
    setProducts((list) => list.filter((p) => p.id !== current.id));
  }

  async function createSuggestedCategory(parentOverride?: string | null) {
    const name = current?.ai_meta?.categoria_nueva;
    if (!name) return;
    const parent = parentOverride ?? newParent ?? types[0]?.id ?? null;
    const dup = findSibling(categories, parent, name);
    if (dup) {
      setDraft((d) => (d ? { ...d, categoryId: dup.id } : d));
      return toast("info", `Ya existía “${dup.name}”: asignada`);
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error } = await supabase.from("categories").insert({ name, parent_id: parent, user_id: user!.id }).select().single();
    if (error) return toast("error", error.message);
    setCategories((c) => [...c, data]);
    setDraft((d) => (d ? { ...d, categoryId: data.id } : d));
    toast("success", `Subcategoría "${name}" creada`);
  }

  /** Agrega un catálogo preconfigurado o crea una categoría nueva con la IA, y asigna el producto. */
  async function setupAndAssign(body: { presets?: string[]; description?: string; ensure_section?: string }, preferSubName?: string | null) {
    setSettingUp(true);
    const res = await fetch("/api/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as { error?: string; types?: string[] };
    if (!res.ok) {
      setSettingUp(false);
      return toast("error", json.error || "No se pudo crear");
    }
    const [{ data: cats }, { data: tpls }] = await Promise.all([
      supabase.from("categories").select("*"),
      supabase.from("field_templates").select("*").order("sort_order"),
    ]);
    const all = cats ?? [];
    setCategories(all);
    setTemplates(tpls ?? []);
    const typeName = json.types?.[0];
    const top = all.find((c) => !c.parent_id && nameKey(c.name) === nameKey(typeName ?? ""));
    setSettingUp(false);
    if (!top) return toast("error", "La categoría no se encontró tras crearla");
    // Subcategoría: la que sugirió la IA si se creó; si no, la elige el clasificador
    const sub = preferSubName ? all.find((c) => c.parent_id === top.id && nameKey(c.name) === nameKey(preferSubName)) : undefined;
    if (sub) {
      setDraft((d) => (d ? { ...d, categoryId: sub.id } : d));
      toast("success", `Asignado a ${top.icon ? top.icon + " " : ""}${top.name} › ${sub.name}. Puedes cambiarlo con “Cambiar”.`);
    } else {
      setDraft((d) => (d ? { ...d, categoryId: top.id } : d));
      toast("success", `Categoría "${typeName}" creada`);
      if (current) await autoSubcategory(current.id, top.id);
    }
  }

  // ---------- Vistas ----------
  if (loading)
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Header count={0} onToggle={() => {}} />
        <CardSkeleton />
      </div>
    );

  if (tableView) {
    return (
      <div className="space-y-4">
        <Header count={products.length} tableView onToggle={() => router.replace("/review")} />
        <ProductTable products={products} categories={categories} templates={templates} mode="draft" onChanged={load} />
      </div>
    );
  }

  if (!current || !draft) {
    return (
      <Centered>
        <div className="animate-in card max-w-sm text-center">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-emerald-600">
            <IconCheckCircle size={34} />
          </span>
          <h2 className="mt-4 text-xl font-bold">
            {confirmedCount > 0 ? `¡${confirmedCount} producto${confirmedCount > 1 ? "s" : ""} al inventario!` : "Nada pendiente"}
          </h2>
          <p className="mt-1 text-sm text-slate-500">Toma más fotos cuando quieras.</p>
          <div className="mt-5 grid gap-2">
            <Link href="/capture" className="btn-primary"><IconCamera size={18} /> Agregar con foto</Link>
            <Link href="/products/new" className="btn-secondary"><IconPlus size={18} /> Escribir un producto a mano</Link>
            <Link href="/products" className="btn-secondary">Ver mi inventario</Link>
          </div>
        </div>
      </Centered>
    );
  }

  const title = productTitle(draft.data);
  const meta = current.ai_meta ?? {};
  const nameField = fields.find((f) => /^(nombre|name|producto|titulo)$/i.test(f.name)) ?? null;
  const keyFields = manualFields.filter((f) => f.field_type === "number" && /^(precio|price|stock|cantidad|existencias)$/i.test(f.name));
  const otherFields = fields.filter((f) => f !== nameField && !keyFields.includes(f));
  const catOfCurrent = draft.categoryId ? categories.find((c) => c.id === draft.categoryId) ?? null : null;
  const topOfCurrent = catOfCurrent?.parent_id ? categories.find((c) => c.id === catOfCurrent.parent_id) ?? catOfCurrent : catOfCurrent;
  const catColor = categoryColor(topOfCurrent?.name);
  const emptyOthers = otherFields.filter((f) => {
    const v = draft.data[f.name];
    return v === "" || v === null || v === undefined;
  }).length;
  // Estado de la ubicación: completo / falta subcategoría / sin categoría
  const locState = !draft.categoryId
    ? { label: "Sin categoría", chip: "bg-rose-100 text-rose-800", border: "border-rose-200 bg-rose-50/40" }
    : !catOfCurrent?.parent_id && categories.some((c) => c.parent_id === draft.categoryId)
      ? { label: "Falta subcategoría", chip: "bg-amber-100 text-amber-800", border: "border-amber-200 bg-amber-50/40" }
      : meta.categoria_sugerida && draft.categoryId === current.category_id
        ? { label: "✨ Asignado por la IA", chip: "bg-emerald-100 text-emerald-800", border: "border-emerald-200 bg-emerald-50/40" }
        : { label: "Ubicación elegida", chip: "bg-emerald-100 text-emerald-800", border: "border-emerald-200 bg-emerald-50/40" };
  // Nombre para una categoría general nueva: el propuesto por la IA, o la subcategoría sugerida
  const generalName = meta.categoria_nueva_general || meta.categoria_nueva || null;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Header count={products.length} index={index} onToggle={() => router.replace("/review?view=table")} />
      <CoachTip screen="review" title="¿Está bien este producto?">
        Arriba, lo que reconoció la IA (corrige solo si se equivocó). Abajo, <b>precio</b> y <b>stock</b>. Luego el botón verde fijo: <b>Confirmar y pasar al siguiente</b>. Desliza la tarjeta a la derecha para confirmar más rápido.
      </CoachTip>

      <div className="relative">
        {/* Indicadores del gesto */}
        {dragX > 30 && (
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 flex w-28 items-center justify-center rounded-l-3xl bg-emerald-500/90 text-white" style={{ opacity: Math.min(1, dragX / SWIPE) }}>
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
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* Foto (toca para ampliar) */}
        <button type="button" onClick={() => setZoom(true)} className="relative block aspect-[4/3] w-full overflow-hidden rounded-t-3xl bg-slate-100 text-left">
          {current.image_url && <Photo src={current.image_url} wrapperClassName="h-full w-full" className="h-full w-full object-contain" />}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-5 pb-3 pt-10 text-white">
            <p className="truncate text-lg font-bold">{title || "Sin nombre"}</p>
          </div>
          <span className="absolute right-3 top-3 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">Toca para ampliar</span>
          {catOfCurrent && (
            <span className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${catColor.bg} ${catColor.text} ${catColor.ring}`}>
              {catOfCurrent.icon ? `${catOfCurrent.icon} ` : ""}{catOfCurrent.name}
            </span>
          )}
        </button>

        <div className="stagger space-y-5 px-5 pb-5">
          {/* ¿Ya lo tienes? (posible duplicado detectado al analizar) */}
          {meta.posible_duplicado && (
            <section className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-3">
              <p className="text-sm font-bold text-amber-900">¿Es el mismo producto que ya tienes?</p>
              <p className="mt-0.5 text-xs text-amber-800">
                <b>«{meta.posible_duplicado.nombre}»</b> · {meta.posible_duplicado.motivo}.{" "}
                <Link href={`/products/${meta.posible_duplicado.product_id}`} className="font-semibold underline">Ver ese producto</Link>
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button type="button" disabled={merging} onClick={() => mergeIntoExisting(meta.posible_duplicado!.product_id)} className="btn-success btn-sm">
                  {merging ? <Spinner size={14} /> : <IconCheck size={14} />} Sí, sumar {Math.max(1, parseInt(String(draft.data.stock ?? 1), 10) || 1)} al stock
                </button>
                <button type="button" disabled={merging} onClick={notDuplicate} className="btn-secondary btn-sm">No, es otro</button>
              </div>
            </section>
          )}

          {/* ¿Dónde va este producto? */}
          <section className={`rounded-2xl border-2 p-3 ${locState.border}`}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-ink">¿Dónde va este producto?</h2>
              <span className={`badge ${locState.chip}`}>{locState.label}</span>
            </div>

            <div className="space-y-2">
              <div className="row-action">
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Categoría</span>
                  <span className="block truncate font-semibold text-ink">
                    {topOfCurrent ? `${topOfCurrent.icon ? topOfCurrent.icon + " " : ""}${topOfCurrent.name}` : "— sin asignar —"}
                  </span>
                </span>
                <button type="button" onClick={() => setOpenPicker({ step: null, nonce: Date.now() })} className="btn-secondary btn-sm shrink-0">
                  <IconEdit size={14} /> Cambiar
                </button>
              </div>

              <div className="row-action">
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Subcategoría</span>
                  <span className={`block truncate font-semibold ${catOfCurrent?.parent_id ? "text-ink" : "text-amber-700"}`}>
                    {catOfCurrent?.parent_id ? catOfCurrent.name : topOfCurrent ? "— falta elegir —" : "—"}
                  </span>
                </span>
                {topOfCurrent && (
                  <button type="button" onClick={() => setOpenPicker({ step: topOfCurrent!.id, nonce: Date.now() })} className="btn-secondary btn-sm shrink-0">
                    <IconEdit size={14} /> Cambiar
                  </button>
                )}
              </div>
            </div>

            {/* Selector (se abre desde los botones Cambiar) */}
            <div className="sr-only">
              <CategoryPicker
                categories={categories}
                value={draft.categoryId}
                onChange={(v) => setDraft({ ...draft, categoryId: v })}
                onCategoriesChange={setCategories}
                emptyLabel="Sin categoría"
                openIn={openPicker?.step ? { id: openPicker.step, nonce: openPicker.nonce } : openIn}
                openNonce={openPicker?.step === null ? openPicker.nonce : undefined}
              />
            </div>

            {/* Falta subcategoría dentro de una categoría que sí tiene */}
            {draft.categoryId && !catOfCurrent?.parent_id && categories.some((c) => c.parent_id === draft.categoryId) && (
              <div className="mt-3 space-y-2 rounded-2xl bg-brand-50 p-3">
                <p className="text-xs font-semibold text-brand-900">Elige la subcategoría para terminar de ordenarlo:</p>
                <div className="flex flex-wrap gap-2">
                  {(meta.categoria_nueva ? findSimilar(categories, draft.categoryId, meta.categoria_nueva) : []).map((c) => (
                    <button key={c.id} type="button" onClick={() => setDraft({ ...draft, categoryId: c.id })} className="chip border-emerald-400 bg-emerald-50 text-emerald-800">
                      <IconCheck size={14} /> {c.name}
                    </button>
                  ))}
                  <button type="button" onClick={() => setOpenPicker({ step: draft.categoryId!, nonce: Date.now() })} className="chip">
                    <IconList size={14} /> Ver todas
                  </button>
                  {meta.categoria_nueva && !categories.some((c) => c.parent_id === draft.categoryId && nameKey(c.name) === nameKey(meta.categoria_nueva!)) ? (
                    <button type="button" disabled={settingUp} onClick={() => createSuggestedCategory(draft.categoryId)} className="chip border-brand-500 bg-brand-600 text-white hover:bg-brand-700">
                      <IconSparkles size={14} /> Crear subcategoría “{meta.categoria_nueva}” y asignar
                    </button>
                  ) : (
                    <button type="button" disabled={classifying} onClick={() => autoSubcategory(current.id, draft.categoryId!)} className="chip border-brand-400 bg-white text-brand-700">
                      {classifying ? <Spinner size={14} /> : <IconSparkles size={14} />} Que la elija la IA
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Sin categoría: opciones en orden de preferencia */}
            {!draft.categoryId && (
              <div className="mt-3 space-y-2 rounded-2xl bg-amber-50 p-3">
                <p className="text-sm font-semibold text-amber-900">Este producto no encaja en tus categorías.</p>
                <p className="text-xs text-amber-800">
                  La IA creará la categoría <b>{generalName || title || "nueva"}</b>
                  {meta.categoria_nueva ? <> con la subcategoría <b>{meta.categoria_nueva}</b></> : " con sus subcategorías"} y sus datos, y pondrá este producto ahí. Luego puedes cambiarlo con <b>Cambiar</b>.
                </p>
                <button
                  type="button"
                  disabled={settingUp}
                  onClick={() =>
                    setupAndAssign(
                      { description: `${generalName || title || meta.etiqueta || "Productos varios"}. Ejemplo de producto: ${title || meta.etiqueta || ""}`, ensure_section: meta.categoria_nueva ?? undefined },
                      meta.categoria_nueva
                    )
                  }
                  className="btn-primary btn-lg w-full"
                >
                  {settingUp ? <Spinner size={18} /> : <IconSparkles size={20} />}
                  {settingUp ? "Creando y asignando…" : "Crear categoría y subcategoría con IA"}
                </button>
                <p className="text-center text-[11px] text-amber-800">Consume 1 análisis · o toca <b>Cambiar</b> arriba para elegir una existente</p>
              </div>
            )}
          </section>

          {/* Nombre (lo más importante que reconoció la IA) */}
          {nameField && (
            <div>
              <label className="label flex items-center gap-1">{fieldLabel(nameField.name)} <IconSparkles size={12} className="text-brand-500" /></label>
              <FieldInput field={nameField} value={draft.data[nameField.name]} onChange={(v) => setValue(nameField, v)} className="input font-semibold" />
            </div>
          )}

          {/* Variantes: solo si la categoría las maneja (talla, color…) */}
          {axesHere.length > 0 && (
            <section className="rounded-2xl border-2 border-violet-200 bg-violet-50/40 p-3">
              <p className="text-sm font-semibold text-violet-900">
                ¿Viene en varias {axesHere.map((a) => a.label.toLowerCase()).join(" / ")}?
                {Object.keys(proposals).length > 0 && <span className="ml-1 text-xs font-normal text-violet-700">✨ la IA vio {Object.values(proposals).flat().slice(0, 6).join(", ")}</span>}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setVariantsOn(true)} className={`rounded-xl border-2 px-3 py-2 text-sm font-semibold ${variantsOn === true ? "border-violet-600 bg-violet-600 text-white" : "border-slate-300 bg-white text-slate-700"}`}>
                  Sí, tiene variantes
                </button>
                <button type="button" onClick={() => setVariantsOn(false)} className={`rounded-xl border-2 px-3 py-2 text-sm font-semibold ${variantsOn === false ? "border-slate-700 bg-slate-700 text-white" : "border-slate-300 bg-white text-slate-700"}`}>
                  No, es único
                </button>
              </div>
              {variantsOn === true && (
                <div className="mt-3">
                  <VariantGrid
                    axes={axesHere}
                    chosen={chosen}
                    onChosen={setChosen}
                    suggested={proposals}
                    getCell={(values) => {
                      const raw = cellStock[cellKey(values)] ?? "";
                      return { exists: raw.trim() !== "", stock: raw === "" ? null : raw };
                    }}
                    onStockInput={(values, raw) => setCellStock((m) => ({ ...m, [cellKey(values)]: raw }))}
                  />
                  <p className="mt-2 text-sm text-violet-900">
                    Stock total: <b>{variantTotal}</b> en <b>{variantRows.length}</b> variante{variantRows.length === 1 ? "" : "s"}
                    {variantCells.length > 0 && variantRows.length === 0 && <span className="text-xs text-amber-700"> · escribe el stock en las casillas</span>}
                  </p>
                </div>
              )}
            </section>
          )}
          {axesHere.length === 0 && draft.categoryId && current.ai_meta?.variantes_propuestas && Object.keys(current.ai_meta.variantes_propuestas).length > 0 && (
            <p className="rounded-2xl bg-violet-50 p-3 text-xs text-violet-900">
              ✨ La IA vio varias opciones ({Object.values(current.ai_meta.variantes_propuestas).flat().slice(0, 6).join(", ")}). Para llevar el stock de cada una, agrega variantes a <b>{topOfCurrent?.name}</b> en{" "}
              <Link href="/store" className="font-semibold underline">Mi tienda</Link>.
            </p>
          )}

          {/* Precio y stock: lo que completa el usuario, grande */}
          {keyFields.length > 0 && (
            <section>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Completa tú</p>
              <div className="grid grid-cols-2 gap-3">
                {keyFields.map((f) =>
                  variantsOn === true && variantRows.length > 0 && /^(stock|cantidad|existencias)$/i.test(f.name) ? (
                    <div key={f.id} className="rounded-2xl bg-violet-50 p-3 ring-1 ring-violet-200">
                      <label className="label mb-1">{fieldLabel(f.name)}</label>
                      <p className="text-2xl font-bold tabular-nums text-violet-900">{variantTotal}</p>
                      <p className="text-[11px] text-violet-700">suma de las variantes</p>
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

          {/* Resto de datos, plegado */}
          {otherFields.length > 0 && (
            <section>
              <button type="button" onClick={() => setMoreOpen((v) => !v)} className="btn-disclosure">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-100 text-brand-700">
                  <IconList size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block">{moreOpen ? "Ocultar los demás datos" : `Revisar los demás datos (${otherFields.length})`}</span>
                  <span className="block truncate text-xs font-normal text-slate-500">
                    {emptyOthers > 0 ? `${emptyOthers} sin completar · ` : "todos completos · "}
                    {otherFields.map((f) => fieldLabel(f.name)).join(", ")}
                  </span>
                </span>
                {emptyOthers > 0 && !moreOpen && <span className="badge shrink-0 bg-amber-100 text-amber-800">{emptyOthers}</span>}
                <IconChevronRight className={`shrink-0 text-brand-600 transition ${moreOpen ? "rotate-90" : ""}`} />
              </button>
              {moreOpen && (
                <div className="stagger mt-2 space-y-3 rounded-2xl border-2 border-slate-200 px-4 py-4">
                  {otherFields.map((f) => (
                    <div key={f.id}>
                      <label className="label flex items-center gap-1">
                        {fieldLabel(f.name)} {f.is_ai_fillable && <IconSparkles size={12} className="text-brand-500" />}
                      </label>
                      <FieldInput field={f} value={draft.data[f.name]} onChange={(v) => setValue(f, v)} />
                    </div>
                  ))}
                  {meta.etiqueta && (
                    <div className="flex gap-2 rounded-2xl bg-slate-50 p-3 text-xs text-slate-600">
                      <IconTag size={16} className="mt-0.5 shrink-0 text-slate-400" />
                      <p><span className="font-semibold text-slate-700">En la etiqueta se lee:</span> {meta.etiqueta}</p>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {fields.length === 0 && draft.categoryId && (
            <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">
              Esta categoría aún no tiene datos definidos.{" "}
              <Link href="/templates" className="font-semibold underline">Definir datos</Link>
            </p>
          )}

          {/* Acciones: la principal queda fija abajo */}
          <div className="grid gap-2 pt-1">
            <div className="sticky-action">
              <button onClick={() => save("confirmed")} className={`btn-success btn-lg w-full ${leaving ? "pulse-success" : ""}`} disabled={saving}>
                {saving ? <Spinner /> : <IconCheck size={22} />} Confirmar y pasar al siguiente
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => save("draft")} className="btn-secondary" disabled={saving}>
                <IconEdit size={16} /> Guardar y seguir
              </button>
              <button onClick={remove} className="btn-destructive" disabled={saving}>
                <IconTrash size={16} /> Eliminar
              </button>
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

      {/* Foto ampliada (pellizca para hacer zoom) */}
      {zoom && current.image_url && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90" onClick={() => setZoom(false)}>
          <div className="h-full w-full overflow-auto" style={{ touchAction: "pinch-zoom" }}>
            <img src={current.image_url} alt="" className="mx-auto h-full w-auto max-w-none object-contain" />
          </div>
          <button type="button" className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white backdrop-blur" onClick={() => setZoom(false)}>
            <IconX size={22} />
          </button>
          {meta.etiqueta && (
            <p className="absolute inset-x-4 bottom-6 rounded-2xl bg-black/60 p-3 text-center text-xs text-white/90">{meta.etiqueta}</p>
          )}
        </div>
      )}

      {/* Navegación entre pendientes */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <button className="btn-secondary justify-self-start" disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>
          <IconArrowLeft size={18} /> Anterior
        </button>
        <span className="text-center text-sm font-semibold text-slate-600">
          {index + 1} de {products.length}
          <span className="hidden text-xs font-normal text-slate-400 sm:block">o desliza la tarjeta</span>
        </span>
        <button className="btn-secondary justify-self-end" disabled={index >= products.length - 1} onClick={() => setIndex((i) => Math.min(products.length - 1, i + 1))}>
          Siguiente <IconArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}

function Header({ count, index, tableView, onToggle }: { count: number; index?: number; tableView?: boolean; onToggle: () => void }) {
  return (
    <header className="animate-in flex items-end justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Revisar pendientes</h1>
        <p className="text-sm text-slate-500">{count === 0 ? "Sin pendientes" : `${count} por revisar`}</p>
      </div>
      <button onClick={onToggle} className="chip hidden md:inline-flex" title={tableView ? "Ver como tarjetas" : "Ver como tabla"}>
        {tableView ? <IconCheckCircle size={16} /> : <IconTable size={16} />}
        {tableView ? "Tarjetas" : "Tabla"}
      </button>
    </header>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[60vh] items-center justify-center">{children}</div>;
}
