"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import CoachTip from "@/components/CoachTip";
import BarcodeCamera from "@/components/BarcodeCamera";
import { CODE_FIELDS } from "@/lib/fields";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Category, FieldTemplate, Product, ProductData, ProductVariant, VariantAxis } from "@/types/database";
import { categoryPath } from "@/lib/categories";
import { canonicalizeData, coerceValue, fieldLabel, getEffectiveFields, productTitle } from "@/lib/fields";
import CategoryPicker from "@/components/CategoryPicker";
import FieldInput from "@/components/FieldInput";
import { IconArrowLeft, IconCheck, IconEdit, IconRefresh, IconSparkles, IconTag, IconTrash, Spinner } from "@/components/ui/Icons";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import StockAdjust from "@/components/StockAdjust";
import ProductVariants from "@/components/ProductVariants";
import { fmtMoney } from "@/lib/inventory";
import type { PriceHistory, StockMovement } from "@/types/database";

export default function ProductDetailClient() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();
  const [product, setProduct] = useState<Product | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [templates, setTemplates] = useState<FieldTemplate[]>([]);
  const [data, setData] = useState<ProductData>({});
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [minStock, setMinStock] = useState<string>("");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [moreActions, setMoreActions] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [priceHist, setPriceHist] = useState<PriceHistory[]>([]);
  const [axes, setAxes] = useState<VariantAxis[]>([]);
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const toast = useToast();
  const ask = useConfirm();

  /** Vuelve a analizar la foto con la IA (1 petición). Conserva precio, stock y datos manuales. */
  async function reanalyze(keepCategory: boolean) {
    if (!product) return;
    const ok = await ask({
      title: "¿Que la IA lea la foto otra vez?",
      body: keepCategory
        ? "Actualiza nombre, marca y descripción. No toca el precio, el stock ni la categoría."
        : "Actualiza los datos y puede cambiarlo de categoría. No toca el precio ni el stock.",
      details: [{ label: "Análisis que usa", value: "1 de tu cupo diario", tone: "warn" }],
      confirmLabel: "Sí, analizar de nuevo",
      tone: "primary",
    });
    if (!ok) return;
    setReanalyzing(true);
    const res = await fetch("/api/reanalyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_id: product.id, keep_category: keepCategory }),
    });
    const json = (await res.json().catch(() => ({}))) as { product?: Product; changed?: string[]; error?: string };
    setReanalyzing(false);
    if (!res.ok) return toast("error", json.error || "No se pudo volver a analizar");
    await load();
    const n = json.changed?.length ?? 0;
    toast("success", n ? `Actualizado: ${json.changed!.map(fieldLabel).join(", ")}` : "La IA no encontró nada nuevo que cambiar");
  }

  const load = useCallback(async () => {
    const [p, c, t, a, v] = await Promise.all([
      supabase.from("products").select("*").eq("id", id).maybeSingle(),
      supabase.from("categories").select("*"),
      supabase.from("field_templates").select("*").order("sort_order"),
      supabase.from("variant_axes").select("*").order("sort_order"),
      supabase.from("product_variants").select("*").eq("product_id", id).order("created_at"),
    ]);
    setCategories(c.data ?? []);
    setTemplates(t.data ?? []);
    setAxes((a.data ?? []) as VariantAxis[]);
    setVariants((v.data ?? []) as ProductVariant[]);
    supabase.from("stock_movements").select("*").eq("product_id", id).order("created_at", { ascending: false }).limit(8).then(({ data }) => setMovements((data ?? []) as StockMovement[]));
    supabase.from("price_history").select("*").eq("product_id", id).order("created_at", { ascending: false }).limit(6).then(({ data }) => setPriceHist((data ?? []) as PriceHistory[]));
    if (!p.data) setNotFound(true);
    else {
      setProduct(p.data);
      setData(canonicalizeData(p.data.data, getEffectiveFields(t.data ?? [], c.data ?? [], p.data.category_id)));
      setCategoryId(p.data.category_id);
      setMinStock(p.data.min_stock === null || p.data.min_stock === undefined ? "" : String(p.data.min_stock));
      setExpiresAt(p.data.expires_at ?? "");
    }
    setLoading(false);
  }, [supabase, id]);

  useEffect(() => {
    load();
  }, [load]);

  const fields = getEffectiveFields(templates, categories, categoryId);
  // Dato donde vive el código de barras (el definido por la categoría, o uno propio)
  const codeField = fields.find((f) => CODE_FIELDS.includes(f.name.toLowerCase()))?.name ?? "codigo_barras";
  // Valores guardados que no pertenecen a ningún campo actual (p. ej. campo eliminado)
  const orphanKeys = Object.keys(data).filter((k) => !fields.some((f) => f.name === k));

  async function save(status?: Product["status"]) {
    if (!product) return;
    setSaving(true);
    setError(null);
    const clean: ProductData = { ...data };
    fields.forEach((f) => (clean[f.name] = coerceValue(f, data[f.name])));
    if (variants.length) {
      const stockField = fields.find((f) => /^(stock|cantidad|existencias)$/i.test(f.name));
      clean[stockField?.name ?? "stock"] = variants.reduce((t, v) => t + v.stock, 0);
    }
    const min = minStock.trim() === "" ? null : Math.max(0, parseInt(minStock, 10) || 0);
    // Historial de precios: se anota cada cambio de precio de venta / compra
    const priceChanges: { field: string; old: number | null; nu: number | null }[] = [];
    for (const f of ["precio", "precio_compra", "precio_mayorista"]) {
      const before = product.data[f];
      const after = clean[f];
      const b = before === null || before === undefined || before === "" ? null : Number(before);
      const a = after === null || after === undefined || after === "" ? null : Number(after);
      if ((b ?? null) !== (a ?? null)) priceChanges.push({ field: f, old: b, nu: a });
    }
    const { error } = await supabase
      .from("products")
      .update({ data: clean, category_id: categoryId, min_stock: min, expires_at: expiresAt || null, ...(status ? { status } : {}) })
      .eq("id", product.id);
    setSaving(false);
    if (error) return setError(error.message);
    if (priceChanges.length) {
      await supabase.from("price_history").insert(priceChanges.map((c) => ({ user_id: product.user_id, product_id: product.id, field: c.field, old_value: c.old, new_value: c.nu, source: "ficha" })));
    }
    toast("success", "Cambios guardados");
    // Tras editar, se vuelve a la lista de donde vino el producto
    if (status === "draft") router.push("/review");
    else router.push("/products");
  }

  async function remove() {
    if (!product) return;
    if (product.status === "confirmed") {
      // Papelera: se puede recuperar durante 30 días (la foto se conserva)
      const ok = await ask({
        title: "¿Enviar a la papelera?",
        body: "Sale del inventario pero no se borra: puedes recuperarlo durante 30 días desde Ordenar y limpiar → Papelera.",
        confirmLabel: "Sí, a la papelera",
        tone: "danger",
      });
      if (!ok) return;
      const { error } = await supabase.from("products").update({ deleted_at: new Date().toISOString() }).eq("id", product.id);
      if (error) return setError(error.message);
      toast("success", "Enviado a la papelera", { label: "Deshacer", onClick: async () => { await supabase.from("products").update({ deleted_at: null }).eq("id", product.id); } });
      router.push("/products");
      return;
    }
    const okDraft = await ask({ title: "¿Eliminar este pendiente?", body: "Se borra junto con su foto. Como todavía no estaba en el inventario, no se puede recuperar.", confirmLabel: "Eliminar", tone: "danger" });
    if (!okDraft) return;
    if (product.image_url) {
      const idx = product.image_url.indexOf("/product-images/");
      if (idx >= 0) await supabase.storage.from("product-images").remove([product.image_url.slice(idx + "/product-images/".length)]);
    }
    const { error } = await supabase.from("products").delete().eq("id", product.id);
    if (error) return setError(error.message);
    router.push("/review");
  }

  async function restore() {
    if (!product) return;
    const { error } = await supabase.from("products").update({ deleted_at: null }).eq("id", product.id);
    if (error) return setError(error.message);
    toast("success", "Producto recuperado");
    load();
  }

  if (loading) return <p className="text-sm text-slate-500">Cargando...</p>;
  if (notFound || !product)
    return (
      <div className="card text-sm">
        Producto no encontrado. <Link href="/products" className="text-brand-600 underline">Volver</Link>
      </div>
    );

  const isDraft = product.status === "draft";

  return (
    <div className="has-action mx-auto w-full max-w-4xl space-y-5 overflow-x-hidden">
      <div className="animate-in flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <Link href={isDraft ? "/review" : "/products"} className="mb-1 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700">
            <IconArrowLeft size={16} /> {isDraft ? "Pendientes" : "Inventario"}
          </Link>
          <h1 className="break-words text-2xl font-bold tracking-tight text-ink">{productTitle(data) || "Producto"}</h1>
          <p className="text-xs text-slate-500">
            {categoryPath(categories, product.category_id)} · {new Date(product.created_at).toLocaleDateString("es")}
          </p>
        </div>
        <span className={`badge ${isDraft ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
          {isDraft ? "Pendiente" : "En inventario"}
        </span>
      </div>

      <CoachTip screen="product" title="¿Qué cambio?">
        Para stock usa <b>+/− Stock</b> (registra ventas y reposiciones). Para el resto, edita y toca <b>Guardar cambios</b>, fijo abajo. Lo demás está en <b>Más opciones</b>.
      </CoachTip>

      <div className="mx-auto grid w-full max-w-xl grid-cols-1 gap-5 md:max-w-none md:grid-cols-[340px_1fr]">
        <div className="animate-in space-y-3">
          <div className="card overflow-hidden p-0">
            {product.image_url ? (
              <img src={product.image_url} alt="" className="w-full object-contain" />
            ) : (
              <div className="flex h-48 items-center justify-center text-sm text-slate-400">Sin foto</div>
            )}
          </div>
          {/* Sumar / restar stock */}
          <button onClick={() => setAdjusting(true)} className="btn-primary w-full justify-start">
            <IconCheck size={18} /> +/− Stock: sumar, vender o retirar
            <span className="ml-auto text-xs font-normal opacity-80">sin editar el producto</span>
          </button>
          <ProductVariants product={{ ...product, data }} categories={categories} axes={axes} variants={variants} onChanged={load} />
          {movements.length > 0 && (
            <div className="rounded-2xl border-2 border-slate-200 p-3">
              <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">Últimos movimientos</p>
              <ul className="space-y-1 text-xs">
                {movements.map((m) => (
                  <li key={m.id} className="flex items-center gap-2">
                    <span className={`w-14 shrink-0 rounded-full px-1.5 py-0.5 text-center font-bold ${m.tipo === "venta" ? "bg-emerald-100 text-emerald-800" : m.tipo === "entrada" ? "bg-brand-100 text-brand-800" : "bg-slate-200 text-slate-700"}`}>{m.tipo === "venta" ? "venta" : m.tipo === "entrada" ? "entrada" : "retiro"}</span>
                    <span className="flex-1 text-slate-600">{new Date(m.created_at).toLocaleDateString("es", { day: "2-digit", month: "short" })}{m.variant_label ? ` · ${m.variant_label}` : ""}{m.motivo ? ` · ${m.motivo}` : ""}</span>
                    <span className="font-bold tabular-nums text-ink">{m.tipo === "entrada" ? "+" : "−"}{m.cantidad}</span>
                    {m.tipo === "venta" && <span className="font-semibold text-emerald-700">Bs {fmtMoney(m.total ?? 0)}</span>}
                  </li>
                ))}
              </ul>
              <Link href="/movements" className="mt-2 inline-block text-xs font-semibold text-brand-700 hover:underline">Ver todos →</Link>
            </div>
          )}

          {priceHist.length > 0 && (
            <div className="rounded-2xl border-2 border-slate-200 p-3">
              <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">Historial de precios</p>
              <ul className="space-y-1 text-xs">
                {priceHist.map((h) => (
                  <li key={h.id} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 text-slate-500">{new Date(h.created_at).toLocaleDateString("es", { day: "2-digit", month: "short" })} · {h.field === "precio" ? "venta" : h.field === "precio_compra" ? "compra" : "mayorista"}</span>
                    <span className="tabular-nums text-slate-400 line-through">{h.old_value === null ? "—" : `Bs ${fmtMoney(Number(h.old_value))}`}</span>
                    <span className="font-bold tabular-nums text-ink">{h.new_value === null ? "—" : `Bs ${fmtMoney(Number(h.new_value))}`}</span>
                    <span className="ml-auto text-slate-400">{h.source}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Volver a analizar con IA */}
          <div className="rounded-2xl border-2 border-brand-200 bg-brand-50/60 p-3">
            <p className="flex items-center gap-1.5 text-xs font-bold text-brand-900">
              <IconSparkles size={14} className="text-brand-600" /> ¿La IA se equivocó?
            </p>
            <p className="mt-0.5 text-xs text-slate-600">Vuelve a leer la foto y corrige los datos. Precio y stock no se tocan.</p>
            <div className="mt-2 grid gap-2">
              <button onClick={() => reanalyze(false)} disabled={reanalyzing || !product.image_url} className="btn-primary btn-sm w-full justify-start">
                {reanalyzing ? <Spinner size={14} /> : <IconRefresh size={16} />} Volver a analizar con IA
                <span className="ml-auto text-[11px] font-normal opacity-80">puede recolocarlo</span>
              </button>
              <button onClick={() => reanalyze(true)} disabled={reanalyzing || !product.image_url} className="btn-secondary btn-sm w-full justify-start">
                <IconRefresh size={16} className="text-brand-600" /> Solo actualizar los datos
                <span className="ml-auto text-[11px] font-normal text-slate-500">mantiene la categoría</span>
              </button>
            </div>
          </div>

          {product.ai_meta?.etiqueta && (
            <div className="flex gap-2 rounded-2xl bg-slate-50 p-3 text-xs text-slate-600">
              <IconTag size={16} className="mt-0.5 shrink-0 text-slate-400" />
              <p><span className="font-semibold text-slate-700">En la etiqueta se lee:</span> {product.ai_meta.etiqueta}</p>
            </div>
          )}
        </div>

        <div className="animate-in card min-w-0 space-y-4">
          {product.deleted_at && (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-rose-50 p-3 text-sm text-rose-900">
              <IconTrash size={16} />
              <span className="flex-1">Este producto está en la <b>papelera</b> desde el {new Date(product.deleted_at).toLocaleDateString("es")}. Se borrará definitivamente a los 30 días.</span>
              <button onClick={restore} className="btn-success btn-sm">Recuperar</button>
            </div>
          )}
          <div>
            <label className="label">Categoría</label>
            <CategoryPicker categories={categories} value={categoryId} onChange={setCategoryId} onCategoriesChange={setCategories} emptyLabel="Sin categoría" />
          </div>

          {/* Control de stock: mínimo y vencimiento */}
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="min-stock">Avisarme cuando queden</label>
              <div className="flex items-center gap-2">
                <input id="min-stock" type="number" min={0} inputMode="numeric" className="input w-20 shrink-0 py-2 text-center tabular-nums" placeholder="3" value={minStock} onChange={(e) => setMinStock(e.target.value)} />
                <span className="min-w-0 flex-1 text-xs text-slate-500">unidades o menos. Vacío = usa el de su categoría.</span>
              </div>
            </div>
            <div>
              <label className="label" htmlFor="expires">Vence el</label>
              <div className="flex flex-wrap items-center gap-2">
                <input id="expires" type="date" className="input w-auto min-w-[9.5rem] flex-1 py-2" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
                <button type="button" onClick={() => setExpiresAt("")} className={`chip shrink-0 ${expiresAt === "" ? "chip-active" : ""}`} title="Producto que no vence">
                  Sin fecha
                </button>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">{expiresAt ? "Se avisa antes de que venza (los días se ajustan en Cuándo avisarme)." : "Sin fecha: no vence. Toca el calendario solo si quieres ponerle una."}</p>
            </div>
          </div>

          {/* Código de barras: se puede leer con la cámara (la IA no siempre lo ve en la foto) */}
          <div>
            <label className="label" htmlFor="code">Código de barras</label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="code"
                className="input w-auto min-w-[10rem] flex-1 font-mono text-sm"
                placeholder="Sin código"
                value={String(data[codeField] ?? "")}
                onChange={(e) => setData({ ...data, [codeField]: e.target.value })}
              />
              <button type="button" onClick={() => setScanning((v) => !v)} className={`chip shrink-0 ${scanning ? "chip-active" : ""}`}>
                <IconTag size={14} /> {scanning ? "Cerrar cámara" : data[codeField] ? "Volver a escanear" : "Escanear"}
              </button>
            </div>
            {scanning && (
              <div className="mt-2">
                <BarcodeCamera
                  label="Apuntar al código"
                  onCode={(code) => {
                    setData((d) => ({ ...d, [codeField]: code }));
                    setScanning(false);
                    navigator.vibrate?.(20);
                    toast("success", `Código ${code} guardado en el formulario. Toca Guardar para confirmarlo.`);
                  }}
                />
              </div>
            )}
            <p className="mt-1 text-[11px] text-slate-500">Con el código, el escáner y el conteo reconocen este producto al instante.</p>
          </div>

          {fields.map((f) =>
            CODE_FIELDS.includes(f.name.toLowerCase()) ? null :
            variants.length > 0 && /^(stock|cantidad|existencias)$/i.test(f.name) ? (
              <div key={f.id}>
                <label className="label">{fieldLabel(f.name)}</label>
                <p className="rounded-xl bg-violet-50 px-3 py-2 text-lg font-bold tabular-nums text-violet-900">
                  {variants.reduce((t, v) => t + v.stock, 0)} <span className="text-xs font-normal text-violet-700">· suma de las variantes (se cambia desde la cuadrícula)</span>
                </p>
              </div>
            ) : (
              <div key={f.id}>
                <label className="label flex items-center gap-1">
                  {fieldLabel(f.name)} {f.is_ai_fillable && <IconSparkles size={12} className="text-brand-500" />}
                </label>
                <FieldInput field={f} value={data[f.name]} onChange={(v) => setData({ ...data, [f.name]: v })} />
              </div>
            )
          )}

          {orphanKeys.length > 0 && (
            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer">Otros datos guardados ({orphanKeys.length})</summary>
              <ul className="mt-1 space-y-1">
                {orphanKeys.map((k) => (
                  <li key={k}><span className="font-medium">{k}:</span> {String(data[k] ?? "")}</li>
                ))}
              </ul>
            </details>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          {/* Acciones: una principal clara + el resto en "Más opciones" */}
          <div className="grid w-full gap-2 pt-2">
            <div className="sticky-action">
              {isDraft ? (
                <button className="btn-success btn-lg w-full" onClick={() => save("confirmed")} disabled={saving}>
                  {saving ? <Spinner /> : <IconCheck size={20} />} Guardar en el inventario
                </button>
              ) : (
                <button className="btn-primary btn-lg w-full" onClick={() => save()} disabled={saving}>
                  {saving ? <Spinner /> : <IconEdit size={18} />} Guardar cambios
                </button>
              )}
            </div>

            <button type="button" onClick={() => setMoreActions((v) => !v)} className="text-sm font-semibold text-slate-500 underline hover:text-ink">
              {moreActions ? "Ocultar más opciones" : "Más opciones"}
            </button>

            {moreActions && (
              <div className="animate-in grid gap-2 rounded-2xl border-2 border-slate-200 p-3">
                {isDraft ? (
                  <button className="btn-secondary w-full justify-start" onClick={() => save()} disabled={saving}>
                    <IconEdit size={16} /> Guardar sin pasarlo al inventario
                    <span className="ml-auto text-xs font-normal text-slate-500">sigue en pendientes</span>
                  </button>
                ) : (
                  <button className="btn-secondary w-full justify-start" onClick={() => save("draft")} disabled={saving}>
                    <IconEdit size={16} /> Marcar para revisar de nuevo
                    <span className="ml-auto text-xs font-normal text-slate-500">vuelve a pendientes</span>
                  </button>
                )}
                <button className="btn-destructive w-full justify-start" onClick={remove} disabled={saving}>
                  <IconTrash size={16} /> {isDraft ? "Eliminar este pendiente" : "Enviar a la papelera"}
                  <span className="ml-auto text-xs font-normal">{isDraft ? "y su foto" : "recuperable 30 días"}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {adjusting && product && (
        <StockAdjust
          product={{ ...product, data }}
          variants={variants}
          onClose={() => setAdjusting(false)}
          onSaved={() => load()}
        />
      )}
    </div>
  );
}
