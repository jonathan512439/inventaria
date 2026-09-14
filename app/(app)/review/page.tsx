"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Category, FieldTemplate, Product, ProductData } from "@/types/database";
import { categoryPath, findSibling, findSimilar } from "@/lib/categories";
import { applyDefaults, canonicalizeData, coerceValue, fieldLabel, getEffectiveFields, productTitle } from "@/lib/fields";
import { useQueue, queueSummary, removeByProductId } from "@/lib/queue";
import { getPreset } from "@/lib/presets";
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
    const [c, t, p] = await Promise.all([
      supabase.from("categories").select("*"),
      supabase.from("field_templates").select("*").order("sort_order"),
      supabase.from("products").select("*").eq("status", "draft").order("created_at", { ascending: true }),
    ]);
    setCategories(c.data ?? []);
    setTemplates(t.data ?? []);
    setProducts(p.data ?? []);
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
  }, [current, templates, categories]);

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
    const { error } = await supabase
      .from("products")
      .update({ data: clean, category_id: draft.categoryId, status })
      .eq("id", current.id);
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
  async function setupAndAssign(body: { presets?: string[]; description?: string }, preferSubName?: string | null) {
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
    const top = all.find((c) => !c.parent_id && c.name.toLowerCase() === typeName?.toLowerCase());
    setSettingUp(false);
    if (!top) return toast("error", "La categoría no se encontró tras crearla");
    setDraft((d) => (d ? { ...d, categoryId: top.id } : d));
    toast("success", `Categoría "${typeName}" lista`);
    // Elegir la subcategoría automáticamente (coincidencia de texto o IA)
    if (current) await autoSubcategory(current.id, top.id);
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
            <Link href="/products" className="btn-ghost">Ver mi inventario</Link>
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
  // Nombre para una categoría general nueva: el propuesto por la IA, o la subcategoría sugerida
  const generalName = meta.categoria_nueva_general || meta.categoria_nueva || null;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Header count={products.length} index={index} onToggle={() => router.replace("/review?view=table")} />

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
          {/* Categoría */}
          <div>
            <label className="label flex items-center gap-1">
              <IconSparkles size={14} className="text-brand-500" /> Categoría
            </label>
            <CategoryPicker
              categories={categories}
              value={draft.categoryId}
              onChange={(v) => setDraft({ ...draft, categoryId: v })}
              onCategoriesChange={setCategories}
              emptyLabel="Sin categoría"
              openIn={openIn}
            />
            {catOfCurrent && (
              <p className="mt-1.5 flex flex-wrap items-center gap-x-1 text-xs text-slate-600">
                {meta.categoria_sugerida && draft.categoryId === current.category_id ? (
                  <><IconSparkles size={12} className="text-brand-500" /> <span className="font-semibold text-brand-700">La IA eligió:</span></>
                ) : (
                  <span className="font-semibold">Elegida:</span>
                )}
                <span>{topOfCurrent?.icon ? `${topOfCurrent.icon} ` : ""}{topOfCurrent?.name}</span>
                {catOfCurrent.parent_id ? (
                  <span>› <b>{catOfCurrent.name}</b></span>
                ) : (
                  <span className="text-amber-700">› sin subcategoría</span>
                )}
                <span className="text-slate-400">· toca arriba para cambiar</span>
              </p>
            )}
            {draft.categoryId && !categories.find((c) => c.id === draft.categoryId)?.parent_id && (
              <div className="mt-2 flex flex-wrap gap-2">
                {categories.some((c) => c.parent_id === draft.categoryId) && (
                  <button type="button" disabled={classifying} onClick={() => autoSubcategory(current.id, draft.categoryId!)} className="chip border-brand-300 bg-brand-50 text-brand-700">
                    {classifying ? <Spinner size={14} /> : <IconSparkles size={14} />} Elegir subcategoría automáticamente
                  </button>
                )}
                {meta.categoria_nueva && !categories.some((c) => c.parent_id === draft.categoryId && c.name.toLowerCase() === meta.categoria_nueva!.toLowerCase()) && (
                  <>
                    {findSimilar(categories, draft.categoryId, meta.categoria_nueva).map((c) => (
                      <button key={c.id} type="button" onClick={() => setDraft({ ...draft, categoryId: c.id })} className="chip border-emerald-300 bg-emerald-50 text-emerald-800" title="Ya existe una parecida">
                        <IconCheck size={14} /> Usar “{c.name}”
                      </button>
                    ))}
                    <button type="button" disabled={settingUp} onClick={() => createSuggestedCategory(draft.categoryId)} className="chip border-brand-300 bg-white text-brand-700">
                      <IconPlus size={14} /> Crear “{meta.categoria_nueva}”
                    </button>
                  </>
                )}
              </div>
            )}

            {!draft.categoryId && (meta.catalogo_sugerido || meta.categoria_nueva_general || meta.categoria_nueva) && (
              <div className="mt-2 space-y-2 rounded-2xl border border-brand-200 bg-brand-50/60 p-3">
                <p className="text-xs font-semibold text-brand-800">
                  <IconSparkles size={12} className="mr-1 inline" />
                  Este producto no encaja en tus categorías. Sugerencias:
                </p>
                {meta.catalogo_sugerido && getPreset(meta.catalogo_sugerido) && (
                  <button type="button" disabled={settingUp} onClick={() => setupAndAssign({ presets: [meta.catalogo_sugerido!] }, meta.categoria_nueva)} className="btn-primary btn-sm w-full justify-start">
                    {settingUp ? <Spinner size={14} /> : <IconPlus size={14} />}
                    Agregar catálogo {getPreset(meta.catalogo_sugerido)!.icon} {getPreset(meta.catalogo_sugerido)!.name}
                    <span className="ml-auto text-[10px] font-normal opacity-80">listo para usar</span>
                  </button>
                )}
                {generalName && (
                  <button type="button" disabled={settingUp} onClick={() => setupAndAssign({ description: `${generalName}. Ejemplo de producto: ${title || meta.etiqueta || ""}` }, meta.categoria_nueva)} className="btn-secondary btn-sm w-full justify-start">
                    {settingUp ? <Spinner size={14} /> : <IconSparkles size={14} className="text-brand-600" />}
                    Crear categoría “{generalName}” con la IA
                    <span className="ml-auto text-[10px] font-normal text-slate-500">subcategorías + datos</span>
                  </button>
                )}
                {meta.categoria_nueva && types.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" disabled={settingUp} onClick={() => createSuggestedCategory()} className="chip border-brand-300 bg-white text-brand-700">
                      <IconPlus size={14} /> Subcategoría “{meta.categoria_nueva}”
                    </button>
                    <select className="input w-auto py-1.5 text-sm" value={newParent ?? types[0]?.id ?? ""} onChange={(e) => setNewParent(e.target.value)}>
                      {types.map((t) => (
                        <option key={t.id} value={t.id}>en {t.icon ? `${t.icon} ` : ""}{t.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}
            {!draft.categoryId && fields.length === 0 && (
              <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">Elige la categoría: ahí aparecerán el precio, el stock y los demás datos para completar.</p>
            )}
          </div>

          {/* Nombre (lo más importante que reconoció la IA) */}
          {nameField && (
            <div>
              <label className="label flex items-center gap-1">{fieldLabel(nameField.name)} <IconSparkles size={12} className="text-brand-500" /></label>
              <FieldInput field={nameField} value={draft.data[nameField.name]} onChange={(v) => setValue(nameField, v)} className="input font-semibold" />
            </div>
          )}

          {/* Precio y stock: lo que completa el usuario, grande */}
          {keyFields.length > 0 && (
            <section>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Completa tú</p>
              <div className="grid grid-cols-2 gap-3">
                {keyFields.map((f) => (
                  <div key={f.id} className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
                    <label className="label mb-1">{fieldLabel(f.name)}</label>
                    <FieldInput field={f} value={draft.data[f.name]} onChange={(v) => setValue(f, v)} className="input-lg text-2xl tabular-nums" />
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Resto de datos, plegado */}
          {otherFields.length > 0 && (
            <section className="rounded-2xl ring-1 ring-slate-200">
              <button type="button" onClick={() => setMoreOpen((v) => !v)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
                <span className="flex-1">
                  <span className="block text-sm font-semibold text-ink">Más datos ({otherFields.length})</span>
                  {!moreOpen && (
                    <span className="mt-0.5 block truncate text-xs text-slate-500">
                      {otherFields
                        .filter((f) => draft.data[f.name] !== "" && draft.data[f.name] !== null && draft.data[f.name] !== undefined)
                        .map((f) => `${fieldLabel(f.name)}: ${draft.data[f.name]}`)
                        .join(" · ") || "Marca, descripción, color…"}
                    </span>
                  )}
                </span>
                <IconChevronRight className={`shrink-0 text-slate-400 transition ${moreOpen ? "rotate-90" : ""}`} />
              </button>
              {moreOpen && (
                <div className="stagger space-y-3 border-t border-slate-100 px-4 py-4">
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

          {/* Acciones */}
          <div className="grid grid-cols-[auto_1fr] gap-2 pt-1">
            <button onClick={remove} className="btn-danger px-4" title="Eliminar" disabled={saving}>
              <IconTrash size={18} />
            </button>
            <button onClick={() => save("confirmed")} className={`btn-success btn-lg ${leaving ? "pulse-success" : ""}`} disabled={saving}>
              {saving ? <Spinner /> : <IconCheck size={20} />} Confirmar y siguiente
            </button>
            <button onClick={() => save("draft")} className="btn-ghost col-span-2 text-slate-500" disabled={saving}>
              Guardar sin confirmar
            </button>
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
      <div className="flex items-center justify-between text-sm">
        <button className="btn-ghost btn-sm" disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>
          <IconArrowLeft size={16} /> Anterior
        </button>
        <span className="text-slate-500">{index + 1} de {products.length} <span className="hidden text-slate-400 sm:inline">· desliza → confirmar</span></span>
        <button className="btn-ghost btn-sm" disabled={index >= products.length - 1} onClick={() => setIndex((i) => Math.min(products.length - 1, i + 1))}>
          Siguiente <IconArrowRight size={16} />
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
