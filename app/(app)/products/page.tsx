"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Category, FieldTemplate, Product, ProductVariant, VariantAxis } from "@/types/database";
import { categoryPath, getDescendantIds } from "@/lib/categories";
import { productTitle } from "@/lib/fields";
import { daysToExpiry, expiringSoon, fromSummary, money, priceOf, stockOf, SUMMARY_COLS } from "@/lib/inventory";
import { bizKey, cacheGet, cacheSet, isNetworkError } from "@/lib/offline";
import { withCosts } from "@/lib/data/costs";
import { friendlyError } from "@/lib/errors";
import { useFlow } from "@/components/FlowProvider";
import BarcodeCamera from "@/components/BarcodeCamera";
import CategoryPicker from "@/components/CategoryPicker";
import ProductTable from "@/components/ProductTable";
import StockAdjust from "@/components/StockAdjust";
import RestockSheet, { restockLines } from "@/components/products/RestockSheet";
import TrashList from "@/components/products/TrashList";
import PriceSheet from "@/components/products/PriceSheet";
import LabelSheet from "@/components/products/LabelSheet";
import Sheet from "@/components/ui/Sheet";
import Photo from "@/components/ui/Photo";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { ChipFilter, EmptyState, ScreenHeader, TaskCard } from "@/components/ui/Screen";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import ExpirySheet from "@/components/products/ExpirySheet";
import { IconAlert, IconBox, IconCamera, IconCheck, IconClipboard, IconDownload, IconFolder, IconList, IconPlus, IconPrinter, IconScan, IconSearch, IconTable, IconTag, IconTrash, IconTruck, IconX, Spinner } from "@/components/ui/Icons";

/** Filtros de la lista (C7.3): reponer, vencer y papelera dejan de ser pantallas aparte. */
const VIEWS = ["all", "pending", "restock", "expiring", "out", "noprice", "nophoto", "trash"] as const;
type View = (typeof VIEWS)[number];
const PAGE = 60;

export default function ProductsPage() {
  return (
    <Suspense fallback={<ListSkeleton rows={5} />}>
      <Products />
    </Suspense>
  );
}

/**
 * Productos (C7.3 · RECONSTRUCCION_VISUAL.md §3.2): una sola lista con buscador y filtros, selección múltiple
 * (precio, etiquetas, mover, Excel, papelera) y vista Tabla en escritorio. Reemplaza los estantes por categoría,
 * /products/c, /products/table, /restock, /trash, /prices y /labels.
 */
function Products() {
  const params = useSearchParams();
  const router = useRouter();
  const supabase = createClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { alerts, isOwner } = useFlow();

  // Las redirecciones de Cloudflare pegan la consulta antigua con «?» (p. ej. filter=expiring?tab=vencer): se corta ahí
  const param = (k: string) => params.get(k)?.split("?")[0] || null;
  const view: View = (VIEWS as readonly string[]).includes(param("filter") ?? "") ? (param("filter") as View) : "all";
  const categoryId = param("category"); // "none" = sin categoría
  const table = params.get("view") === "table";

  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [loading, setLoading] = useState(true);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<Set<string> | null>(null); // ids que coinciden en el servidor (descripción, etiqueta…)
  const [limit, setLimit] = useState(PAGE);
  const [selecting, setSelecting] = useState(params.get("select") === "1");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState<"category" | "restock" | "price" | "labels" | "move" | "scan" | null>(null);
  const [adjusting, setAdjusting] = useState<Product | null>(null);
  const [expiring, setExpiring] = useState<Product | null>(null);
  const [busy, setBusy] = useState(false);
  const [moveTo, setMoveTo] = useState<string | null>(null);
  // Tabla (escritorio) y Excel: filas completas, campos y ejes, solo cuando se usan
  const [full, setFull] = useState<Product[] | null>(null);
  const [templates, setTemplates] = useState<FieldTemplate[]>([]);

  const load = useCallback(async () => {
    // Vista ligera (≈200 B por producto): nombre, precio, stock y costo (solo el dueño) ya resueltos en la base
    const [c, p, v] = await Promise.all([
      supabase.from("categories").select("*"),
      supabase.from("product_summaries").select(SUMMARY_COLS).order("updated_at", { ascending: false }),
      supabase.from("product_variants").select("*").order("created_at"),
    ]);
    if ((c.error && isNetworkError(c.error)) || (p.error && isNetworkError(p.error))) {
      const cached = await cacheGet<{ categories: Category[]; products: Product[]; variants?: ProductVariant[] }>(bizKey("inventory"));
      if (cached) {
        setCategories(cached.data.categories);
        setProducts(cached.data.products);
        setVariants(cached.data.variants ?? []);
        setCachedAt(cached.at);
      }
      setLoading(false);
      return;
    }
    const cats = c.data ?? [];
    const list = (p.data ?? []).map(fromSummary);
    const vs = (v.data ?? []) as ProductVariant[];
    setCategories(cats);
    setProducts(list);
    setVariants(vs);
    setCachedAt(null);
    setLoading(false);
    cacheSet(bizKey("inventory"), { categories: cats, products: list, variants: vs });
  }, [supabase]);
  useEffect(() => {
    load();
  }, [load]);

  /** Cambia un parámetro de la dirección (filtro, categoría, vista) sin recargar. */
  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value === null) next.delete(key);
      else next.set(key, value);
      next.delete("select");
      const qs = next.toString();
      router.replace(qs ? `/products?${qs}` : "/products", { scroll: false });
      setLimit(PAGE);
    },
    [params, router]
  );

  const variantsOf = useMemo(() => {
    const m = new Map<string, ProductVariant[]>();
    variants.forEach((v) => m.set(v.product_id, [...(m.get(v.product_id) ?? []), v]));
    return m;
  }, [variants]);
  const confirmed = useMemo(() => products.filter((p) => p.status === "confirmed"), [products]);
  const drafts = useMemo(() => products.filter((p) => p.status === "draft"), [products]);

  // 1) Categoría
  const inCategory = useCallback(
    (list: Product[]) => {
      if (!categoryId) return list;
      if (categoryId === "none") return list.filter((p) => !p.category_id || !categories.some((c) => c.id === p.category_id));
      const ids = new Set(getDescendantIds(categories, categoryId));
      return list.filter((p) => p.category_id && ids.has(p.category_id));
    },
    [categoryId, categories]
  );
  const scoped = useMemo(() => inCategory(confirmed), [inCategory, confirmed]);
  const restockIds = useMemo(() => new Set(restockLines(scoped, variantsOf, categories, alerts).map((l) => l.productId)), [scoped, variantsOf, categories, alerts]);
  const isOut = useCallback((p: Product) => (stockOf(p) ?? 0) <= 0 || (variantsOf.get(p.id) ?? []).some((v) => v.stock <= 0), [variantsOf]);

  // 2) Filtro
  const filtered = useMemo(() => {
    switch (view) {
      case "pending":
        return inCategory(drafts);
      case "restock":
        return scoped.filter((p) => restockIds.has(p.id)).sort((a, b) => (stockOf(a) ?? 0) - (stockOf(b) ?? 0));
      case "expiring":
        return scoped.filter((p) => expiringSoon(p, alerts, categories)).sort((a, b) => (daysToExpiry(a.expires_at) ?? 0) - (daysToExpiry(b.expires_at) ?? 0));
      case "out":
        return scoped.filter(isOut);
      case "noprice":
        return scoped.filter((p) => priceOf(p) === null);
      case "nophoto":
        return scoped.filter((p) => !p.image_url);
      default:
        return scoped;
    }
  }, [view, scoped, drafts, inCategory, restockIds, alerts, categories, isOut]);

  // 3) Búsqueda: nombre, marca y código aquí mismo (también sin conexión) + descripción/etiqueta en el servidor
  const q = search.trim().toLowerCase();
  useEffect(() => {
    if (!q) return setHits(null);
    const t = setTimeout(async () => {
      const { data } = await supabase.from("product_summaries").select("id").ilike("search", `%${q.replace(/[%_]/g, "")}%`).limit(300);
      setHits(new Set((data ?? []).map((r) => r.id as string)));
    }, 250);
    return () => clearTimeout(t);
  }, [q, supabase]);
  const visible = useMemo(() => {
    if (!q) return filtered;
    return filtered.filter((p) => {
      if (hits?.has(p.id)) return true;
      const hay = `${productTitle(p.data)} ${p.data.marca ?? ""} ${p.data.codigo_barras ?? ""}`.toLowerCase();
      return hay.includes(q) || (variantsOf.get(p.id) ?? []).some((v) => (v.codigo_barras ?? "").toLowerCase() === q);
    });
  }, [filtered, q, hits, variantsOf]);

  const counts = useMemo(
    () => ({
      pending: inCategory(drafts).length,
      restock: restockIds.size,
      expiring: scoped.filter((p) => expiringSoon(p, alerts, categories)).length,
      out: scoped.filter(isOut).length,
      noprice: scoped.filter((p) => priceOf(p) === null).length,
      nophoto: scoped.filter((p) => !p.image_url).length,
    }),
    [inCategory, drafts, restockIds, scoped, alerts, categories, isOut]
  );
  const saleValue = useMemo(() => scoped.reduce((s, p) => s + (priceOf(p) ?? 0) * Math.max(0, stockOf(p) ?? 0), 0), [scoped]);

  // Tabla en escritorio: filas completas de lo visible (con costo solo para el dueño)
  async function loadFull(ids: string[]): Promise<Product[]> {
    const out: Product[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await supabase.from("products").select("*").in("id", ids.slice(i, i + 100));
      out.push(...(await withCosts(supabase, (data ?? []) as Product[])));
    }
    const order = new Map(ids.map((id, i) => [id, i]));
    return out.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }
  async function loadTemplates() {
    if (templates.length) return templates;
    const { data } = await supabase.from("field_templates").select("*").order("sort_order");
    setTemplates(data ?? []);
    return data ?? [];
  }
  const tableIds = table && view !== "trash" ? visible.slice(0, 300).map((p) => p.id).join(",") : "";
  useEffect(() => {
    if (!tableIds) return setFull(null);
    let alive = true;
    (async () => {
      await loadTemplates();
      const rows = await loadFull(tableIds.split(","));
      if (alive) setFull(rows);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableIds]);

  // Selección
  const chosen = useMemo(() => products.filter((p) => selected.has(p.id)), [products, selected]);
  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function stopSelecting() {
    setSelecting(false);
    setSelected(new Set());
  }
  const allVisibleSelected = visible.length > 0 && visible.every((p) => selected.has(p.id));

  async function moveSelected() {
    if (!chosen.length) return;
    setBusy(true);
    const ids = chosen.map((p) => p.id);
    const { error } = await supabase.from("products").update({ category_id: moveTo }).in("id", ids);
    setBusy(false);
    if (error) return toast("error", friendlyError(error));
    setProducts((ps) => ps.map((p) => (selected.has(p.id) ? { ...p, category_id: moveTo } : p)));
    toast("success", `${ids.length} producto${ids.length === 1 ? "" : "s"} movido${ids.length === 1 ? "" : "s"} a ${moveTo ? categoryPath(categories, moveTo) : "Sin categoría"}`);
    setSheet(null);
    stopSelecting();
  }

  async function trashSelected() {
    const ids = chosen.map((p) => p.id);
    const ok = await confirm({
      title: `¿Enviar ${ids.length} a la papelera?`,
      body: "Salen del inventario pero no se borran: puedes recuperarlos durante 30 días con el filtro Papelera.",
      confirmLabel: "Sí, a la papelera",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    const { error } = await supabase.from("products").update({ deleted_at: new Date().toISOString() }).in("id", ids);
    setBusy(false);
    if (error) return toast("error", friendlyError(error));
    const removed = products.filter((p) => ids.includes(p.id));
    setProducts((ps) => ps.filter((p) => !ids.includes(p.id)));
    stopSelecting();
    toast("success", `${ids.length} en la papelera`, {
      label: "Deshacer",
      onClick: async () => {
        await supabase.from("products").update({ deleted_at: null }).in("id", ids);
        setProducts((ps) => [...removed, ...ps]);
      },
    });
  }

  async function exportSelected(list: Product[], name: string) {
    if (!list.length) return;
    setBusy(true);
    try {
      const [rows, tpl, { data: axes }, { exportToExcel }] = await Promise.all([loadFull(list.map((p) => p.id)), loadTemplates(), supabase.from("variant_axes").select("*").order("sort_order"), import("@/lib/export")]);
      const ids = new Set(list.map((p) => p.id));
      await exportToExcel({ products: rows, categories, templates: tpl, fileName: name, variants: variants.filter((v) => ids.has(v.product_id)), axes: (axes ?? []) as VariantAxis[] });
      toast("success", "Excel descargado");
    } catch (e) {
      toast("error", friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  /** Escáner: si el código es de un producto, abre su ficha; si no, lo deja en el buscador. */
  function onScan(code: string) {
    setSheet(null);
    const c = code.trim().toLowerCase();
    const p = products.find((x) => String(x.data.codigo_barras ?? "").toLowerCase() === c);
    const v = variants.find((x) => (x.codigo_barras ?? "").toLowerCase() === c);
    const id = p?.id ?? v?.product_id;
    if (id) router.push(`/products/${id}`);
    else {
      setSearch(code);
      toast("info", "Ningún producto tiene ese código todavía");
    }
  }

  const usedCodes = useMemo(() => new Set<string>([...products.map((p) => String(p.data.codigo_barras ?? "").toUpperCase()), ...variants.map((v) => (v.codigo_barras ?? "").toUpperCase())].filter(Boolean)), [products, variants]);
  const catLabel = categoryId === "none" ? "Sin categoría" : categoryId ? categories.find((c) => c.id === categoryId)?.name ?? "Categoría" : "Todas las categorías";
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

  const chips: { value: View; label: string; count?: number; tone?: "warn" | "danger" | "info" }[] = [
    { value: "pending", label: "Pendientes", count: counts.pending, tone: "info" },
    { value: "restock", label: "Por reponer", count: counts.restock, tone: "warn" },
    { value: "expiring", label: "Por vencer", count: counts.expiring, tone: "warn" },
    { value: "out", label: "Agotados", count: counts.out, tone: "danger" },
    { value: "noprice", label: "Sin precio", count: counts.noprice, tone: "warn" },
    { value: "nophoto", label: "Sin foto", count: counts.nophoto },
    ...(isOwner ? [{ value: "trash" as View, label: "Papelera" }] : []),
  ];

  return (
    <div className="has-action w-full space-y-4 overflow-x-hidden">
      <ScreenHeader
        title="Productos"
        subtitle={loading ? " " : `${plural(scoped.length, "producto")} en inventario${saleValue > 0 ? ` · valen ${money(saleValue)}` : ""}`}
        help={
          <>
            <p>Aquí está todo tu inventario en una sola lista. Busca por nombre, marca o código, o toca el escáner.</p>
            <p>Los botones de abajo del buscador filtran: <b>Por reponer</b> (con la lista de pedido para WhatsApp), <b>Por vencer</b>, <b>Agotados</b>, <b>Papelera</b>…</p>
            <p>Toca <b>Seleccionar</b> para cambiar el precio, imprimir etiquetas, mover de categoría, descargar en Excel o enviar a la papelera varios productos a la vez.</p>
            <p>El botón <b>±</b> de cada fila suma o resta stock sin abrir la ficha.</p>
            <p><b>Entrada de inventario</b> suma al stock lo que te entregaron (escaneando o tocando en la lista). <b>Contar</b> revisa un estante y corrige las diferencias.</p>
          </>
        }
      />

      {/* Mercadería (C7.5): entradas y conteo viven dentro de Productos */}
      {!selecting && view !== "trash" && (
        <div className="animate-in grid grid-cols-2 gap-2">
          <Link href="/stock/in" className="btn-secondary min-h-[44px]"><IconTruck size={18} /> Entrada de inventario</Link>
          <Link href="/stock/count" className="btn-secondary min-h-[44px]"><IconClipboard size={18} /> Contar</Link>
        </div>
      )}

      {cachedAt && (
        <p className="animate-in rounded-2xl bg-slate-800 px-3 py-2 text-center text-xs font-semibold text-white">
          Sin conexión · inventario guardado a las {new Date(cachedAt).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}
        </p>
      )}

      {/* Buscar o escanear */}
      <div className="animate-in relative">
        <IconSearch size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="input h-12 pl-11 pr-24" placeholder="Buscar por nombre, marca o código…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="absolute right-1 top-1/2 flex -translate-y-1/2 gap-1">
          {search && <button onClick={() => setSearch("")} className="btn-ghost btn-sm h-10 w-10 p-0" aria-label="Borrar búsqueda"><IconX size={16} /></button>}
          <button onClick={() => setSheet("scan")} className="btn-ghost btn-sm h-10 w-10 p-0 text-brand-700" aria-label="Escanear código"><IconScan size={20} /></button>
        </span>
      </div>

      {/* Categoría + filtros */}
      <div className="animate-in space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setSheet("category")} className={`chip min-h-[40px] ${categoryId ? "chip-active" : ""}`}>
            <IconFolder size={14} /> {catLabel} ▾
          </button>
          {categoryId && <button onClick={() => setParam("category", null)} className="text-sm font-semibold text-brand-700 underline">Quitar</button>}
          <span className="flex-1" />
          {view !== "trash" && (
            <button onClick={() => (selecting ? stopSelecting() : setSelecting(true))} className={`btn-sm min-h-[40px] ${selecting ? "btn-primary" : "btn-secondary"}`}>
              <IconCheck size={14} /> {selecting ? "Listo" : "Seleccionar"}
            </button>
          )}
          {view !== "trash" && (
            <button onClick={() => setParam("view", table ? null : "table")} className="btn-secondary btn-sm hidden min-h-[40px] md:inline-flex">
              {table ? <IconList size={14} /> : <IconTable size={14} />} {table ? "Lista" : "Tabla"}
            </button>
          )}
        </div>
        <ChipFilter value={[view]} onToggle={(v) => setParam("filter", v === view ? null : v)} items={chips} />
      </div>

      {/* Avisos y acciones del filtro */}
      {view === "all" && !q && counts.pending > 0 && (
        <TaskCard icon={<IconAlert size={20} />} tone="info" title={`${plural(counts.pending, "pendiente")} por revisar`} body="Todavía no cuentan en el inventario." href="/add/review" cta="Revisar" />
      )}
      {view === "pending" && counts.pending > 0 && (
        <Link href="/add/review" className="btn-success w-full">Revisarlos uno por uno</Link>
      )}
      {view === "restock" && counts.restock > 0 && (
        <button onClick={() => setSheet("restock")} className="btn-success w-full"><IconList size={18} /> Lista de pedido ({counts.restock})</button>
      )}
      {selecting && (
        <div className="animate-in flex items-center gap-2 rounded-2xl bg-brand-50 px-3 py-2 text-sm text-brand-900">
          <span className="flex-1"><b>{selected.size}</b> elegido{selected.size === 1 ? "" : "s"}. Toca los productos para marcarlos.</span>
          <button
            onClick={() => setSelected((s) => {
              const n = new Set(s);
              visible.forEach((p) => (allVisibleSelected ? n.delete(p.id) : n.add(p.id)));
              return n;
            })}
            className="btn-ghost btn-sm min-h-[40px]"
          >
            {allVisibleSelected ? "Ninguno" : `Todos (${visible.length})`}
          </button>
        </div>
      )}

      {/* Lista */}
      {view === "trash" ? (
        <TrashList categories={categories} onRestored={load} />
      ) : loading ? (
        <ListSkeleton rows={6} />
      ) : confirmed.length === 0 && view === "all" && !categoryId ? (
        <EmptyState
          icon={<IconBox size={24} />}
          title="Tu inventario está vacío"
          body={drafts.length ? `Tienes ${plural(drafts.length, "pendiente")} de revisar.` : "Empieza tomando una foto de un producto: la IA llena los datos."}
          action={drafts.length ? <Link href="/add/review" className="btn-success">Revisar pendientes</Link> : <Link href="/add" className="btn-primary"><IconCamera size={18} /> Agregar con foto</Link>}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title={q ? "Nada coincide con tu búsqueda" : view === "all" ? "No hay productos en esta categoría" : "Nada con este filtro"}
          body={q ? "Prueba con otra palabra o escanea el código." : view === "restock" ? "Todo está por encima de su mínimo." : view === "expiring" ? `Nada vence en los próximos ${alerts.expiryDays} días.` : undefined}
        />
      ) : table ? (
        full ? (
          <ProductTable
            products={full}
            categories={categories}
            templates={templates}
            mode={view === "pending" ? "draft" : "confirmed"}
            onChanged={async () => {
              await load();
              if (tableIds) setFull(await loadFull(tableIds.split(",")));
            }}
          />
        ) : (
          <ListSkeleton rows={6} />
        )
      ) : (
        <>
          {view === "expiring" && visible.length > 0 && (
            <p className="rounded-2xl bg-warn-50 px-3 py-2 text-sm text-warn-900">Toca <b>Qué hacer</b> en cada producto: ponerlo en oferta, retirarlo del stock, devolverlo al proveedor o cambiar la fecha.</p>
          )}
          <ul className="stagger grid w-full grid-cols-1 gap-2 lg:grid-cols-2">
            {visible.slice(0, limit).map((p) => (
              <ProductLine
                key={p.id}
                p={p}
                categories={categories}
                variants={variantsOf.get(p.id)}
                restock={restockIds.has(p.id)}
                showExpiry={view === "expiring"}
                selecting={selecting}
                selected={selected.has(p.id)}
                onToggle={() => toggle(p.id)}
                onAdjust={() => setAdjusting(p)}
                onExpiry={view === "expiring" ? () => setExpiring(p) : undefined}
              />
            ))}
          </ul>
          {visible.length > limit && (
            <button onClick={() => setLimit((l) => l + PAGE)} className="btn-secondary mx-auto flex">Ver más ({visible.length - limit} restantes)</button>
          )}
          {view === "all" && !selecting && (
            <p className="text-center">
              <button onClick={() => exportSelected(visible, categoryId ? catLabel.toLowerCase().replace(/\s+/g, "-") : "inventario")} disabled={busy} className="btn-ghost btn-sm min-h-[44px]">
                {busy ? <Spinner size={14} /> : <IconDownload size={14} />} Descargar esta lista en Excel
              </button>
            </p>
          )}
        </>
      )}

      {/* Acción fija: Agregar, o las acciones de la selección */}
      {selecting ? (
        <div className="sticky-action">
          <div className="no-scrollbar mx-auto flex max-w-3xl gap-2 overflow-x-auto">
            {isOwner && <SelAction icon={<IconTag size={18} />} label="Precio" disabled={!chosen.length || busy} onClick={() => setSheet("price")} />}
            <SelAction icon={<IconPrinter size={18} />} label="Etiquetas" disabled={!chosen.length || busy} onClick={() => setSheet("labels")} />
            <SelAction icon={<IconFolder size={18} />} label="Mover" disabled={!chosen.length || busy} onClick={() => { setMoveTo(null); setSheet("move"); }} />
            <SelAction icon={<IconDownload size={18} />} label="Excel" disabled={!chosen.length || busy} onClick={() => exportSelected(chosen, "seleccion")} />
            {isOwner && <SelAction icon={<IconTrash size={18} />} label="Papelera" danger disabled={!chosen.length || busy} onClick={trashSelected} />}
          </div>
        </div>
      ) : (
        <div className="sticky-action">
          <Link href="/add" className="btn-primary btn-lg mx-auto flex w-full max-w-3xl"><IconPlus size={20} /> Agregar productos</Link>
        </div>
      )}

      {/* Hojas */}
      <Sheet open={sheet === "category"} onClose={() => setSheet(null)} title="Elegir categoría">
        <CategoryList
          categories={categories}
          products={confirmed}
          value={categoryId}
          onPick={(id) => {
            setParam("category", id);
            setSheet(null);
          }}
        />
      </Sheet>

      <Sheet open={sheet === "scan"} onClose={() => setSheet(null)} title="Escanear código">
        {sheet === "scan" && <BarcodeCamera label="Apuntar al código" onCode={onScan} />}
      </Sheet>

      <Sheet
        open={sheet === "move"}
        onClose={() => setSheet(null)}
        title={`Mover ${plural(chosen.length, "producto")}`}
        footer={<button onClick={moveSelected} disabled={busy} className="btn-primary btn-lg w-full">{busy ? <Spinner /> : <IconFolder size={18} />} Mover a {moveTo ? categoryPath(categories, moveTo) : "Sin categoría"}</button>}
      >
        <p className="mb-3 text-sm text-muted">Elige la categoría o subcategoría nueva. Sus datos no se pierden.</p>
        <CategoryPicker categories={categories} value={moveTo} onChange={setMoveTo} onCategoriesChange={setCategories} emptyLabel="Sin categoría" />
      </Sheet>

      {isOwner && (
        <PriceSheet
          open={sheet === "price"}
          onClose={() => setSheet(null)}
          products={chosen}
          onApplied={(rows) => setProducts((ps) => ps.map((p) => {
            const r = rows.find((x) => x.id === p.id);
            return r ? { ...p, data: { ...p.data, [r.field]: r.value } } : p;
          }))}
        />
      )}

      <LabelSheet open={sheet === "labels"} onClose={() => setSheet(null)} products={chosen} variantsOf={variantsOf} usedCodes={usedCodes} onCodesAssigned={load} />

      <RestockSheet
        open={sheet === "restock"}
        onClose={() => setSheet(null)}
        products={scoped}
        variantsOf={variantsOf}
        categories={categories}
        onDismissed={(id, off) => setProducts((ps) => ps.map((p) => (p.id === id ? { ...p, alerts_off: off } : p)))}
      />

      {expiring && <ExpirySheet product={expiring} variants={variantsOf.get(expiring.id)} onClose={() => setExpiring(null)} onDone={() => load()} />}

      {adjusting && (
        <StockAdjust
          product={adjusting}
          variants={variantsOf.get(adjusting.id)}
          onClose={() => setAdjusting(null)}
          onSaved={(u, v) => {
            setProducts((ps) => ps.map((x) => (x.id === u.id ? { ...x, data: { ...x.data, stock: (u.data.stock ?? u.data.cantidad ?? u.data.existencias) as number | null } } : x)));
            if (v) setVariants((vs) => vs.map((x) => (x.id === v.id ? v : x)));
          }}
        />
      )}
    </div>
  );
}

/** Botón de la barra de selección (44 px de alto como mínimo). */
function SelAction({ icon, label, onClick, disabled, danger }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className={`flex min-h-[52px] min-w-[72px] flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl px-2 text-xs font-semibold transition disabled:opacity-40 ${danger ? "bg-danger-50 text-danger-700" : "bg-slate-100 text-ink hover:bg-slate-200"}`}>
      {icon}
      {label}
    </button>
  );
}

/** Una fila de la lista: foto, nombre, dónde está, precio y stock; ± para mover stock sin abrir la ficha. */
function ProductLine({
  p,
  categories,
  variants,
  restock,
  showExpiry,
  selecting,
  selected,
  onToggle,
  onAdjust,
  onExpiry,
}: {
  p: Product;
  categories: Category[];
  variants?: ProductVariant[];
  restock: boolean;
  showExpiry: boolean;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
  onAdjust: () => void;
  /** Por vencer (R5): en vez de ±, «Qué hacer» abre oferta / retirar / devolver / cambiar fecha */
  onExpiry?: () => void;
}) {
  const price = priceOf(p);
  const stock = stockOf(p) ?? 0;
  const days = daysToExpiry(p.expires_at);
  const draft = p.status === "draft";
  const badge = draft
    ? { t: "Pendiente", c: "bg-info-100 text-info-700" }
    : stock <= 0
      ? { t: "Agotado", c: "bg-danger-100 text-danger-700" }
      : restock
        ? { t: `Quedan ${stock}`, c: "bg-warn-100 text-warn-800" }
        : { t: `${stock} en inventario`, c: "bg-slate-100 text-slate-600" };
  const sub = [p.category_id ? categoryPath(categories, p.category_id) : "Sin categoría", variants?.length ? `${variants.length} variantes` : null, p.data.marca ? String(p.data.marca) : null].filter(Boolean).join(" · ");
  const body = (
    <>
      {selecting && (
        <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg border-2 ${selected ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white"}`} aria-hidden>
          {selected && <IconCheck size={14} />}
        </span>
      )}
      {p.image_url ? <Photo src={p.image_url} wrapperClassName="h-14 w-14 shrink-0 rounded-xl" className="h-14 w-14 object-cover" /> : <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-400"><IconBox /></span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-ink">{productTitle(p.data) || "Sin nombre"}</span>
        <span className="block truncate text-xs text-muted">{sub}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badge.c}`}>{badge.t}</span>
          {showExpiry && days !== null && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${days < 0 ? "bg-danger-600 text-white" : days <= 7 ? "bg-danger-100 text-danger-700" : "bg-warn-100 text-warn-800"}`}>
              {days < 0 ? `vencido hace ${-days} d` : days === 0 ? "vence hoy" : `vence en ${days} d`}
            </span>
          )}
        </span>
      </span>
      <span className={`shrink-0 text-right text-base font-bold tabular-nums ${price === null ? "text-warn-700" : "text-ink"}`}>{price === null ? <span className="text-xs">sin precio</span> : money(price)}</span>
    </>
  );
  const cls = `flex min-h-[72px] min-w-0 flex-1 items-center gap-3 p-3 text-left`;
  return (
    <li className={`flex min-w-0 items-stretch overflow-hidden rounded-2xl bg-white shadow-card ring-1 transition ${selected ? "ring-2 ring-brand-500" : "ring-slate-900/10 hover:ring-brand-300"}`}>
      {selecting ? (
        <button type="button" onClick={onToggle} className={cls} aria-pressed={selected}>{body}</button>
      ) : (
        <Link href={`/products/${p.id}`} className={cls}>{body}</Link>
      )}
      {!selecting && !draft && onExpiry && (
        <button type="button" onClick={onExpiry} className="w-20 shrink-0 border-l border-slate-100 px-1 text-xs font-bold leading-tight text-warn-800 hover:bg-warn-50" aria-label="Qué hacer con este producto por vencer">Qué hacer</button>
      )}
      {!selecting && !draft && !onExpiry && (
        <button type="button" onClick={onAdjust} className="w-12 shrink-0 border-l border-slate-100 text-lg font-bold text-brand-700 hover:bg-brand-50" aria-label="Sumar o restar stock">±</button>
      )}
    </li>
  );
}

/** Categorías con su cantidad de productos y lo que valen (lo que antes mostraban los estantes). */
function CategoryList({ categories, products, value, onPick }: { categories: Category[]; products: Product[]; value: string | null; onPick: (id: string | null) => void }) {
  const stats = (ids: Set<string>) => {
    const list = products.filter((p) => p.category_id && ids.has(p.category_id));
    return { n: list.length, value: list.reduce((s, p) => s + (priceOf(p) ?? 0) * Math.max(0, stockOf(p) ?? 0), 0) };
  };
  const roots = categories.filter((c) => !c.parent_id).sort((a, b) => a.name.localeCompare(b.name, "es"));
  const orphans = products.filter((p) => !p.category_id || !categories.some((c) => c.id === p.category_id)).length;
  const Row = ({ id, label, n, val, sub = false }: { id: string | null; label: React.ReactNode; n: number; val?: number; sub?: boolean }) => (
    <li>
      <button type="button" onClick={() => onPick(id)} className={`flex min-h-[48px] w-full items-center gap-2 rounded-xl px-3 text-left transition hover:bg-brand-50 ${value === id ? "bg-brand-50 font-bold text-brand-800" : ""} ${sub ? "pl-8 text-sm" : "font-semibold"}`}>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {!!val && <span className="text-xs text-muted">{money(val)}</span>}
        <span className="rounded-full bg-slate-100 px-2 text-xs font-bold text-slate-600">{n}</span>
      </button>
    </li>
  );
  return (
    <ul className="space-y-0.5">
      <Row id={null} label="Todas las categorías" n={products.length} />
      {roots.map((r) => {
        const s = stats(new Set(getDescendantIds(categories, r.id)));
        const children = categories.filter((c) => c.parent_id === r.id).sort((a, b) => a.name.localeCompare(b.name, "es"));
        return (
          <li key={r.id}>
            <ul>
              <Row id={r.id} label={<>{r.icon ? `${r.icon} ` : ""}{r.name}</>} n={s.n} val={s.value} />
              {children.map((c) => {
                const cs = stats(new Set(getDescendantIds(categories, c.id)));
                return <Row key={c.id} id={c.id} label={c.name} n={cs.n} sub />;
              })}
            </ul>
          </li>
        );
      })}
      {orphans > 0 && <Row id="none" label="Sin categoría" n={orphans} />}
    </ul>
  );
}
