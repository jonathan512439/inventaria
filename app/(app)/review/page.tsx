"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Category, FieldTemplate, Product, ProductData } from "@/types/database";
import { categoryPath } from "@/lib/categories";
import { applyDefaults, coerceValue, fieldLabel, getEffectiveFields, productTitle } from "@/lib/fields";
import { useQueue, queueSummary } from "@/lib/queue";
import CategorySelect from "@/components/CategorySelect";
import FieldInput from "@/components/FieldInput";
import ProductTable from "@/components/ProductTable";
import { useToast } from "@/components/ui/Toast";
import {
  IconArrowLeft,
  IconArrowRight,
  IconCamera,
  IconCheck,
  IconCheckCircle,
  IconPlus,
  IconSparkles,
  IconTable,
  IconTag,
  IconTrash,
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
    const data = applyDefaults(fields, { ...current.data });
    setDraft({ data, categoryId: current.category_id });
  }, [current, templates, categories]);

  const fields = useMemo(
    () => (draft ? getEffectiveFields(templates, categories, draft.categoryId) : []),
    [draft, templates, categories]
  );
  const aiFields = fields.filter((f) => f.is_ai_fillable);
  const manualFields = fields.filter((f) => !f.is_ai_fillable);

  function setValue(f: FieldTemplate, v: string) {
    setDraft((d) => (d ? { ...d, data: { ...d.data, [f.name]: coerceValue(f, v) } } : d));
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
      setConfirmedCount((n) => n + 1);
      setProducts((list) => list.filter((p) => p.id !== id));
      toast("success", "Guardado en inventario", {
        label: "Deshacer",
        onClick: async () => {
          await supabase.from("products").update({ status: "draft" }).eq("id", id);
          load();
        },
      });
    } else {
      setProducts((list) => list.map((p) => (p.id === current.id ? { ...p, data: clean, category_id: draft.categoryId } : p)));
      toast("success", "Cambios guardados");
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

  async function createSuggestedCategory() {
    const name = current?.ai_meta?.categoria_nueva;
    if (!name) return;
    const parent = newParent ?? types[0]?.id ?? null;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error } = await supabase.from("categories").insert({ name, parent_id: parent, user_id: user!.id }).select().single();
    if (error) return toast("error", error.message);
    setCategories((c) => [...c, data]);
    setDraft((d) => (d ? { ...d, categoryId: data.id } : d));
    toast("success", `Sección "${name}" creada`);
  }

  // ---------- Vistas ----------
  if (loading) return <Centered><Spinner size={28} className="text-brand-500" /></Centered>;

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
            <Link href="/capture" className="btn-primary"><IconCamera size={18} /> Agregar productos</Link>
            <Link href="/products" className="btn-secondary">Ver mi inventario</Link>
          </div>
        </div>
      </Centered>
    );
  }

  const title = productTitle(draft.data);
  const meta = current.ai_meta ?? {};

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Header count={products.length} index={index} onToggle={() => router.replace("/review?view=table")} />

      <article key={current.id} className="animate-in card space-y-5 p-0">
        {/* Foto */}
        <div className="relative aspect-[4/3] overflow-hidden rounded-t-3xl bg-slate-100">
          {current.image_url && <img src={current.image_url} alt="" className="h-full w-full object-contain" />}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-5 pb-3 pt-10 text-white">
            <p className="truncate text-lg font-bold">{title || "Sin nombre"}</p>
          </div>
        </div>

        <div className="space-y-5 px-5 pb-5">
          {/* Sección */}
          <div>
            <label className="label flex items-center gap-1">
              <IconSparkles size={14} className="text-brand-500" /> Sección
            </label>
            <CategorySelect categories={categories} value={draft.categoryId} onChange={(v) => setDraft({ ...draft, categoryId: v })} emptyLabel="— Elige una sección —" />
            {!draft.categoryId && meta.categoria_nueva && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" onClick={createSuggestedCategory} className="chip border-brand-300 bg-brand-50 text-brand-700">
                  <IconPlus size={14} /> Crear sección “{meta.categoria_nueva}”
                </button>
                {types.length > 1 && (
                  <select className="input w-auto py-1.5 text-sm" value={newParent ?? types[0]?.id ?? ""} onChange={(e) => setNewParent(e.target.value)}>
                    {types.map((t) => (
                      <option key={t.id} value={t.id}>en {t.icon ? `${t.icon} ` : ""}{t.name}</option>
                    ))}
                  </select>
                )}
              </div>
            )}
            {!draft.categoryId && fields.length === 0 && (
              <p className="mt-2 text-xs text-slate-500">Elige la sección para ver y completar los datos del producto.</p>
            )}
          </div>

          {/* Lo que leyó en la etiqueta */}
          {meta.etiqueta && (
            <div className="flex gap-2 rounded-2xl bg-slate-50 p-3 text-xs text-slate-600">
              <IconTag size={16} className="mt-0.5 shrink-0 text-slate-400" />
              <p><span className="font-semibold text-slate-700">En la etiqueta se lee:</span> {meta.etiqueta}</p>
            </div>
          )}

          {/* Campos que llenó la IA */}
          {aiFields.length > 0 && (
            <section className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">
                <IconSparkles size={12} className="mr-1 inline" /> Lo reconoció la IA
              </p>
              {aiFields.map((f) => (
                <div key={f.id}>
                  <label className="label">{fieldLabel(f.name)}</label>
                  <FieldInput field={f} value={draft.data[f.name]} onChange={(v) => setValue(f, v)} />
                </div>
              ))}
            </section>
          )}

          {/* Campos manuales */}
          {manualFields.length > 0 && (
            <section className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Completa tú</p>
              <div className="grid grid-cols-2 gap-3">
                {manualFields.map((f) => (
                  <div key={f.id} className={f.field_type === "text" ? "col-span-2" : ""}>
                    <label className="label">{fieldLabel(f.name)}</label>
                    <FieldInput field={f} value={draft.data[f.name]} onChange={(v) => setValue(f, v)} className={f.field_type === "number" ? "input-lg" : "input"} />
                  </div>
                ))}
              </div>
            </section>
          )}

          {fields.length === 0 && (
            <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">
              Esta sección aún no tiene datos definidos.{" "}
              <Link href="/templates" className="font-semibold underline">Definir datos</Link>
            </p>
          )}

          {/* Acciones */}
          <div className="grid grid-cols-[auto_1fr] gap-2 pt-1">
            <button onClick={remove} className="btn-danger px-4" title="Eliminar" disabled={saving}>
              <IconTrash size={18} />
            </button>
            <button onClick={() => save("confirmed")} className="btn-success btn-lg" disabled={saving}>
              {saving ? <Spinner /> : <IconCheck size={20} />} Confirmar y siguiente
            </button>
            <button onClick={() => save("draft")} className="btn-ghost col-span-2 text-slate-500" disabled={saving}>
              Guardar sin confirmar
            </button>
          </div>
        </div>
      </article>

      {/* Navegación entre pendientes */}
      <div className="flex items-center justify-between text-sm">
        <button className="btn-ghost btn-sm" disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>
          <IconArrowLeft size={16} /> Anterior
        </button>
        <span className="text-slate-500">{index + 1} de {products.length}</span>
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
