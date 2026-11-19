"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import BarcodeCamera from "@/components/BarcodeCamera";
import { useFlow } from "@/components/FlowProvider";
import { createClient } from "@/lib/supabase/client";
import type { Category, FieldTemplate, PriceHistory, Product, ProductData, ProductVariant, StockMovement, VariantAxis } from "@/types/database";
import { categoryPath } from "@/lib/categories";
import { CODE_FIELDS, canonicalizeData, coerceValue, fieldLabel, getEffectiveFields, productTitle } from "@/lib/fields";
import CategoryPicker from "@/components/CategoryPicker";
import FieldInput from "@/components/FieldInput";
import StockAdjust from "@/components/StockAdjust";
import ProductVariants from "@/components/ProductVariants";
import { minStockOf, money, stockOf } from "@/lib/inventory";
import { STOCK_KEYS, newOpId, setStock, withoutStock } from "@/lib/data/ops";
import { friendlyError } from "@/lib/errors";
import { withCosts } from "@/lib/data/costs";
import { storagePath } from "@/lib/photos";
import { StoredImg } from "@/components/ui/Photo";
import { ScreenHeader, Tabs, EmptyState } from "@/components/ui/Screen";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { IconCheck, IconEdit, IconRefresh, IconScan, IconSparkles, IconTag, IconTrash, Spinner } from "@/components/ui/Icons";

type Tab = "datos" | "stock" | "precios" | "historial";
const PRICE_RE = /^(precio|precio_venta|price|precio_compra|costo|cost|precio_mayorista|unidades_por_paquete)$/i;
const COST_RE = /^(precio_compra|costo|cost)$/i;
const STOCK_RE = /^(stock|cantidad|existencias)$/i;

/**
 * Ficha de producto (C7.3): cuatro pestañas ordenadas por tema —
 * Datos (foto, nombre, categoría, campos) · Stock (+/−, variantes, mínimo, vencimiento) ·
 * Precios (venta, compra, mayorista e historial) · Historial (movimientos). Un solo «Guardar cambios».
 */
export default function ProductDetailClient() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();
  const toast = useToast();
  const ask = useConfirm();
  const { isOwner, alerts } = useFlow();
  const [tab, setTab] = useState<Tab>("datos");
  const [product, setProduct] = useState<Product | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [templates, setTemplates] = useState<FieldTemplate[]>([]);
  const [data, setData] = useState<ProductData>({});
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [minStock, setMinStock] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [moreActions, setMoreActions] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [movements, setMovements] = useState<StockMovement[] | null>(null);
  const [priceHist, setPriceHist] = useState<PriceHistory[]>([]);
  const [axes, setAxes] = useState<VariantAxis[]>([]);
  const [variants, setVariants] = useState<ProductVariant[]>([]);

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
    supabase.from("stock_movements").select("*").eq("product_id", id).order("created_at", { ascending: false }).limit(30).then(({ data }) => setMovements((data ?? []) as StockMovement[]));
    supabase.from("price_history").select("*").eq("product_id", id).order("created_at", { ascending: false }).limit(20).then(({ data }) => setPriceHist((data ?? []) as PriceHistory[]));
    // El costo vive en product_costs (025): para el dueño se vuelve a poner en data; al vendedor no le llega
    const full = p.data ? (await withCosts(supabase, [p.data]))[0] : null;
    if (!full) setNotFound(true);
    else {
      setProduct(full);
      setData(canonicalizeData(full.data, getEffectiveFields(t.data ?? [], c.data ?? [], full.category_id)));
      setCategoryId(full.category_id);
      setMinStock(full.min_stock === null || full.min_stock === undefined ? "" : String(full.min_stock));
      setExpiresAt(full.expires_at ?? "");
    }
    setLoading(false);
  }, [supabase, id]);

  useEffect(() => {
    load();
  }, [load]);

  /** Vuelve a analizar la foto con la IA (1 petición). Conserva precio, stock y datos manuales. */
  async function reanalyze(keepCategory: boolean) {
    if (!product) return;
    const ok = await ask({
      title: "¿Que la IA lea la foto otra vez?",
      body: keepCategory ? "Actualiza nombre, marca y descripción. No toca el precio, el stock ni la categoría." : "Actualiza los datos y puede cambiarlo de categoría. No toca el precio ni el stock.",
      details: [{ label: "Análisis que usa", value: "1 de tu cupo diario", tone: "warn" }],
      confirmLabel: "Sí, analizar de nuevo",
      tone: "primary",
    });
    if (!ok) return;
    setReanalyzing(true);
    const res = await fetch("/api/reanalyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product_id: product.id, keep_category: keepCategory }) });
    const json = (await res.json().catch(() => ({}))) as { changed?: string[]; error?: string };
    setReanalyzing(false);
    if (!res.ok) return toast("error", json.error || "No se pudo volver a analizar");
    await load();
    const n = json.changed?.length ?? 0;
    toast("success", n ? `Actualizado: ${json.changed!.map(fieldLabel).join(", ")}` : "La IA no encontró nada nuevo que cambiar");
  }

  const fields = getEffectiveFields(templates, categories, categoryId);
  // Dato donde vive el código de barras (el definido por la categoría, o uno propio)
  const codeField = fields.find((f) => CODE_FIELDS.includes(f.name.toLowerCase()))?.name ?? "codigo_barras";
  const isCode = (n: string) => CODE_FIELDS.includes(n.toLowerCase());
  const dataFields = fields.filter((f) => !isCode(f.name) && !PRICE_RE.test(f.name) && !STOCK_RE.test(f.name));
  const priceFields = fields.filter((f) => PRICE_RE.test(f.name) && (isOwner || !COST_RE.test(f.name)));
  const stockField = fields.find((f) => STOCK_RE.test(f.name)) ?? null;
  // Valores guardados que no pertenecen a ningún campo actual (p. ej. campo eliminado)
  const orphanKeys = Object.keys(data).filter((k) => !fields.some((f) => f.name === k) && !STOCK_RE.test(k) && !isCode(k) && (isOwner || !COST_RE.test(k)));

  async function save(status?: Product["status"]) {
    if (!product) return;
    setSaving(true);
    setError(null);
    const clean: ProductData = { ...data };
    fields.forEach((f) => (clean[f.name] = coerceValue(f, data[f.name])));
    const min = minStock.trim() === "" ? null : Math.max(0, parseInt(minStock, 10) || 0);
    // Stock: NO viaja con `data` (la base conserva el stock real, aunque se haya vendido mientras se editaba).
    // Si la persona lo cambió a mano (sin variantes), se registra como ajuste con su movimiento (021).
    const stockKey = Object.keys(clean).find((k) => STOCK_KEYS.includes(k.toLowerCase()));
    const typed = stockKey && clean[stockKey] !== null && clean[stockKey] !== "" ? Number(clean[stockKey]) : null;
    const stockChanged = !variants.length && typed !== null && Number.isFinite(typed) && typed !== (stockOf(product) ?? 0);
    // El historial de precios lo escribe la base al detectar el cambio (021)
    const { error } = await supabase
      .from("products")
      .update({ data: withoutStock(clean), category_id: categoryId, min_stock: min, expires_at: expiresAt || null, ...(status ? { status } : {}) })
      .eq("id", product.id);
    if (error) {
      setSaving(false);
      return setError(friendlyError(error));
    }
    if (stockChanged) {
      try {
        await setStock(supabase, { id: newOpId(), productId: product.id, value: typed!, motivo: "corrección desde la ficha" });
      } catch (e) {
        setSaving(false);
        return setError(friendlyError(e));
      }
    }
    setSaving(false);
    toast("success", "Cambios guardados");
    // Tras editar, se vuelve a la lista de donde vino el producto
    router.push(status === "draft" || (!status && product.status === "draft") ? "/add/review" : "/products");
  }

  async function remove() {
    if (!product) return;
    if (product.status === "confirmed") {
      // Papelera: se puede recuperar durante 30 días (la foto se conserva)
      const ok = await ask({ title: "¿Enviar a la papelera?", body: "Sale del inventario pero no se borra: puedes recuperarlo durante 30 días con el filtro Papelera de Productos.", confirmLabel: "Sí, a la papelera", tone: "danger" });
      if (!ok) return;
      const { error } = await supabase.from("products").update({ deleted_at: new Date().toISOString() }).eq("id", product.id);
      if (error) return setError(friendlyError(error));
      toast("success", "Enviado a la papelera", { label: "Deshacer", onClick: async () => { await supabase.from("products").update({ deleted_at: null }).eq("id", product.id); } });
      router.push("/products");
      return;
    }
    const okDraft = await ask({ title: "¿Eliminar este pendiente?", body: "Se borra junto con su foto. Como todavía no estaba en el inventario, no se puede recuperar.", confirmLabel: "Eliminar", tone: "danger" });
    if (!okDraft) return;
    const { error } = await supabase.from("products").delete().eq("id", product.id);
    if (error) return setError(friendlyError(error));
    const path = storagePath(product.image_url);
    if (path) await supabase.storage.from("product-images").remove([path]);
    router.push("/add/review");
  }

  async function restore() {
    if (!product) return;
    const { error } = await supabase.from("products").update({ deleted_at: null }).eq("id", product.id);
    if (error) return setError(friendlyError(error));
    toast("success", "Producto recuperado");
    load();
  }

  if (loading) return <ListSkeleton rows={4} />;
  if (notFound || !product)
    return <EmptyState title="Producto no encontrado" body="Puede que lo hayan borrado." action={<Link href="/products" className="btn-primary">Volver a Productos</Link>} />;

  const isDraft = product.status === "draft";
  const totalStock = variants.length ? variants.reduce((t, v) => t + v.stock, 0) : stockOf(product) ?? 0;
  const effMin = minStockOf({ ...product, min_stock: minStock.trim() === "" ? null : Number(minStock) }, categories, alerts);
  const price = Number(data.precio ?? data.precio_venta ?? "") || null;
  const cost = Number(data.precio_compra ?? data.costo ?? "") || null;

  return (
    <div className={`${tab === "historial" ? "" : "has-action"} mx-auto w-full max-w-3xl space-y-4 overflow-x-hidden`}>
      <ScreenHeader
        back={isDraft ? { href: "/add/review", label: "Pendientes" } : { href: "/products", label: "Productos" }}
        title={<span className="break-words">{productTitle(data) || "Producto"}</span>}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{categoryPath(categories, product.category_id) || "Sin categoría"}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${isDraft ? "bg-info-100 text-info-700" : totalStock <= 0 ? "bg-danger-100 text-danger-700" : "bg-ok-100 text-ok-700"}`}>
              {isDraft ? "Pendiente" : totalStock <= 0 ? "Agotado" : "En inventario"}
            </span>
          </span>
        }
        help={
          <>
            <p><b>Datos:</b> foto, nombre, categoría y código. <b>Stock:</b> sumar o restar unidades, tallas y colores, cuándo avisarte y el vencimiento. <b>Precios:</b> venta, mayorista y su historial. <b>Historial:</b> cada venta, entrada y retiro.</p>
            <p>Lo que cambies en Datos, Stock o Precios se guarda junto con <b>Guardar cambios</b>. El botón <b>+/− Stock</b> se guarda al instante.</p>
          </>
        }
      />

      {product.deleted_at && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-danger-50 p-3 text-sm text-danger-800">
          <IconTrash size={16} />
          <span className="flex-1">Está en la <b>papelera</b> desde el {new Date(product.deleted_at).toLocaleDateString("es")}. Se borra definitivamente a los 30 días.</span>
          {isOwner && <button onClick={restore} className="btn-success btn-sm min-h-[44px]">Recuperar</button>}
        </div>
      )}

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { value: "datos", label: "Datos" },
          { value: "stock", label: "Stock" },
          { value: "precios", label: "Precios" },
          { value: "historial", label: "Historial" },
        ]}
      />

      {/* DATOS */}
      {tab === "datos" && (
        <div className="animate-in grid gap-4 md:grid-cols-[260px_1fr]">
          <div className="space-y-3">
            <div className="card overflow-hidden p-0">
              {product.image_url ? <StoredImg src={product.image_url} alt="" className="max-h-72 w-full object-contain" /> : <div className="flex h-40 items-center justify-center text-sm text-muted">Sin foto</div>}
            </div>
            {product.ai_meta?.etiqueta && (
              <p className="flex gap-2 rounded-2xl bg-slate-50 p-3 text-xs text-slate-600">
                <IconTag size={16} className="mt-0.5 shrink-0 text-slate-400" />
                <span><b className="text-slate-700">En la etiqueta se lee:</b> {product.ai_meta.etiqueta}</span>
              </p>
            )}
            {product.image_url && (
              <div className="rounded-2xl border-2 border-brand-200 bg-brand-50/60 p-3">
                <p className="flex items-center gap-1.5 text-xs font-bold text-brand-900"><IconSparkles size={14} className="text-brand-600" /> ¿La IA se equivocó?</p>
                <p className="mt-0.5 text-xs text-slate-600">Vuelve a leer la foto. Precio y stock no se tocan.</p>
                <div className="mt-2 grid gap-2">
                  <button onClick={() => reanalyze(true)} disabled={reanalyzing} className="btn-primary btn-sm min-h-[44px] w-full justify-start">
                    {reanalyzing ? <Spinner size={14} /> : <IconRefresh size={16} />} Actualizar los datos
                  </button>
                  <button onClick={() => reanalyze(false)} disabled={reanalyzing} className="btn-secondary btn-sm min-h-[44px] w-full justify-start">
                    <IconRefresh size={16} className="text-brand-600" /> Analizar y recolocar
                    <span className="ml-auto text-xs font-normal text-muted">puede cambiar la categoría</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="card min-w-0 space-y-4">
            <div>
              <label className="label">Categoría</label>
              <CategoryPicker categories={categories} value={categoryId} onChange={setCategoryId} onCategoriesChange={setCategories} emptyLabel="Sin categoría" />
            </div>
            {dataFields.map((f) => (
              <div key={f.id}>
                <label className="label flex items-center gap-1">{fieldLabel(f.name)} {f.is_ai_fillable && <IconSparkles size={12} className="text-brand-500" />}</label>
                <FieldInput field={f} value={data[f.name]} onChange={(v) => setData({ ...data, [f.name]: v })} />
              </div>
            ))}
            {/* Código de barras: se puede leer con la cámara (la IA no siempre lo ve en la foto) */}
            <div>
              <label className="label" htmlFor="code">Código de barras</label>
              <div className="flex flex-wrap items-center gap-2">
                <input id="code" className="input w-auto min-w-[10rem] flex-1 font-mono text-sm" placeholder="Sin código" value={String(data[codeField] ?? "")} onChange={(e) => setData({ ...data, [codeField]: e.target.value })} />
                <button type="button" onClick={() => setScanning((v) => !v)} className={`chip min-h-[44px] shrink-0 ${scanning ? "chip-active" : ""}`}>
                  <IconScan size={16} /> {scanning ? "Cerrar cámara" : data[codeField] ? "Volver a escanear" : "Escanear"}
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
                      toast("success", `Código ${code} listo. Toca Guardar cambios para confirmarlo.`);
                    }}
                  />
                </div>
              )}
              <p className="mt-1 text-xs text-muted">Con el código, Vender y Contar reconocen este producto al instante. Sin código, crea uno interno al imprimir etiquetas.</p>
            </div>
            {orphanKeys.length > 0 && (
              <details className="text-xs text-muted">
                <summary className="cursor-pointer">Otros datos guardados ({orphanKeys.length})</summary>
                <ul className="mt-1 space-y-1">
                  {orphanKeys.map((k) => (
                    <li key={k}><span className="font-medium">{k}:</span> {String(data[k] ?? "")}</li>
                  ))}
                </ul>
              </details>
            )}

            <button type="button" onClick={() => setMoreActions((v) => !v)} className="min-h-[44px] text-sm font-semibold text-muted underline hover:text-ink">
              {moreActions ? "Ocultar más opciones" : "Más opciones"}
            </button>
            {moreActions && (
              <div className="animate-in grid gap-2 rounded-2xl border-2 border-slate-200 p-3">
                {isDraft ? (
                  <button className="btn-secondary w-full justify-start" onClick={() => save()} disabled={saving}>
                    <IconEdit size={16} /> Guardar sin pasarlo al inventario <span className="ml-auto text-xs font-normal text-muted">sigue en Pendientes</span>
                  </button>
                ) : (
                  <button className="btn-secondary w-full justify-start" onClick={() => save("draft")} disabled={saving}>
                    <IconEdit size={16} /> Marcar para revisar de nuevo <span className="ml-auto text-xs font-normal text-muted">vuelve a Pendientes</span>
                  </button>
                )}
                {(isDraft || isOwner) && !product.deleted_at && (
                  <button className="btn-destructive w-full justify-start" onClick={remove} disabled={saving}>
                    <IconTrash size={16} /> {isDraft ? "Eliminar este pendiente" : "Enviar a la papelera"} <span className="ml-auto text-xs font-normal">{isDraft ? "y su foto" : "recuperable 30 días"}</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* STOCK */}
      {tab === "stock" && (
        <div className="animate-in space-y-4">
          <div className="card flex flex-wrap items-center gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">{variants.length ? "Stock (suma de las variantes)" : "Stock"}</p>
              <p className={`text-4xl font-bold tabular-nums ${totalStock <= 0 ? "text-danger-700" : totalStock <= effMin ? "text-warn-700" : "text-ink"}`}>{totalStock}</p>
              <p className="text-xs text-muted">{totalStock <= 0 ? "Agotado" : totalStock <= effMin ? `Por reponer: avisa con ${effMin} o menos` : `Avisa con ${effMin} o menos`}</p>
            </div>
            {!isDraft && (
              <button onClick={() => setAdjusting(true)} className="btn-primary btn-lg">
                <IconCheck size={20} /> +/− Stock
              </button>
            )}
          </div>
          {!isDraft && <p className="-mt-2 text-xs text-muted">+/− registra al instante una venta, una entrada o un retiro, con su motivo.</p>}

          <ProductVariants product={{ ...product, data }} categories={categories} axes={axes} variants={variants} onChanged={load} />

          <div className="card space-y-4">
            {stockField && !variants.length && (
              <div>
                <label className="label">{isDraft ? "Cantidad que tienes" : "Corregir el stock"}</label>
                <FieldInput field={stockField} value={data[stockField.name]} onChange={(v) => setData({ ...data, [stockField.name]: v })} />
                {!isDraft && <p className="mt-1 text-xs text-muted">Úsalo solo si contaste y no coincide; queda como «corrección» en el historial.</p>}
              </div>
            )}
            <div>
              <label className="label" htmlFor="min-stock">Avisarme cuando queden</label>
              <div className="flex items-center gap-2">
                <input id="min-stock" type="number" min={0} inputMode="numeric" className="input h-11 w-20 shrink-0 text-center tabular-nums" placeholder={String(minStockOf({ ...product, min_stock: null }, categories, alerts))} value={minStock} onChange={(e) => setMinStock(e.target.value)} />
                <span className="min-w-0 flex-1 text-xs text-muted">unidades o menos. Vacío = usa el de su categoría.</span>
              </div>
            </div>
            <div>
              <label className="label" htmlFor="expires">Vence el</label>
              <div className="flex flex-wrap items-center gap-2">
                <input id="expires" type="date" className="input h-11 w-auto min-w-[9.5rem] flex-1" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
                <button type="button" onClick={() => setExpiresAt("")} className={`chip min-h-[44px] shrink-0 ${expiresAt === "" ? "chip-active" : ""}`}>Sin fecha</button>
              </div>
              <p className="mt-1 text-xs text-muted">{expiresAt ? `Te avisamos ${alerts.expiryDays} días antes.` : "Sin fecha: no vence."}</p>
            </div>
          </div>
        </div>
      )}

      {/* PRECIOS */}
      {tab === "precios" && (
        <div className="animate-in space-y-4">
          <div className="card space-y-4">
            {priceFields.length === 0 && <p className="text-sm text-muted">Esta categoría no tiene datos de precio. Agrégalos en Ajustes → Categorías y datos.</p>}
            {priceFields.map((f) => (
              <div key={f.id}>
                <label className="label">{fieldLabel(f.name)}{COST_RE.test(f.name) && <span className="ml-1 text-xs font-normal text-muted">(solo lo ves tú)</span>}</label>
                <FieldInput field={f} value={data[f.name]} onChange={(v) => setData({ ...data, [f.name]: v })} />
              </div>
            ))}
            {isOwner && price !== null && cost !== null && (
              <p className={`rounded-2xl px-3 py-2 text-sm ${price > cost ? "bg-ok-50 text-ok-800" : "bg-danger-50 text-danger-800"}`}>
                {price > cost ? <>Ganas <b>{money(price - cost)}</b> por unidad ({Math.round(((price - cost) / cost) * 100)} % sobre el costo).</> : <>Lo vendes a <b>costo o menos</b>: revisa el precio.</>}
              </p>
            )}
          </div>
          {isOwner && (
            <section className="card">
              <h2 className="mb-2 text-sm font-bold text-ink">Historial de precios</h2>
              {priceHist.length === 0 ? (
                <p className="text-sm text-muted">Todavía no cambió de precio.</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {priceHist.map((h) => (
                    <li key={h.id} className="flex items-center gap-2 py-2">
                      <span className="w-28 shrink-0 text-xs text-muted">{new Date(h.created_at).toLocaleDateString("es", { day: "2-digit", month: "short", year: "2-digit" })} · {h.field === "precio" ? "venta" : h.field === "precio_compra" ? "compra" : "mayorista"}</span>
                      <span className="tabular-nums text-slate-400 line-through">{h.old_value === null ? "—" : money(Number(h.old_value))}</span>
                      <span className="font-bold tabular-nums text-ink">{h.new_value === null ? "—" : money(Number(h.new_value))}</span>
                      <span className="ml-auto truncate text-xs text-muted">{h.source}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}

      {/* HISTORIAL */}
      {tab === "historial" && (
        <section className="animate-in card">
          {movements === null ? (
            <ListSkeleton rows={3} />
          ) : movements.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted">Todavía no tiene ventas, entradas ni retiros.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {movements.map((m) => (
                <li key={m.id} className="flex items-center gap-2 py-2">
                  <span className={`w-16 shrink-0 rounded-full px-1.5 py-0.5 text-center text-xs font-bold ${m.tipo === "venta" ? "bg-ok-100 text-ok-800" : m.tipo === "entrada" ? "bg-info-100 text-info-700" : "bg-slate-200 text-slate-700"}`}>
                    {m.tipo === "venta" ? "venta" : m.tipo === "entrada" ? "entrada" : "retiro"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-slate-600">
                    {new Date(m.created_at).toLocaleDateString("es", { day: "2-digit", month: "short" })}
                    {m.variant_label ? ` · ${m.variant_label}` : ""}
                    {m.motivo ? ` · ${m.motivo}` : ""}
                  </span>
                  <span className="font-bold tabular-nums text-ink">{m.tipo === "entrada" ? "+" : "−"}{m.cantidad}</span>
                  {m.tipo === "venta" && <span className="w-20 text-right font-semibold tabular-nums text-ok-700">{money(m.total ?? 0)}</span>}
                </li>
              ))}
            </ul>
          )}
          <Link href="/movements" className="mt-2 inline-flex min-h-[44px] items-center text-sm font-semibold text-brand-700 hover:underline">Ver todos los movimientos →</Link>
        </section>
      )}

      {error && <p className="text-sm text-danger-700">{error}</p>}

      {tab !== "historial" && (
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
      )}

      {adjusting && <StockAdjust product={{ ...product, data }} variants={variants} onClose={() => setAdjusting(false)} onSaved={() => load()} />}
    </div>
  );
}
