"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import CoachTip from "@/components/CoachTip";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Category, FieldTemplate, Product, ProductVariant, ProductData } from "@/types/database";
import { applyDefaults, fieldLabel, getEffectiveFields, getValue, normalizeFieldName, productTitle } from "@/lib/fields";
import { cleanCode, scanFrame } from "@/lib/barcode";
import { categoryPath } from "@/lib/categories";
import CategoryPicker from "@/components/CategoryPicker";
import FieldInput from "@/components/FieldInput";
import { useToast } from "@/components/ui/Toast";
import { IconArrowLeft, IconBox, IconCamera, IconCheck, IconChevronRight, IconPlus, IconSearch, IconSparkles, IconTag, IconTrash, IconX, Spinner } from "@/components/ui/Icons";

interface PublicInfo { nombre: string; marca: string; contenido: string; categorias: string[]; imagen: string | null; fuente: string }
type Found =
  | { found: "own"; product: Product; variant?: ProductVariant | null; variants?: ProductVariant[] }
  | { found: "public"; info: PublicInfo; suggestion: { category_id: string; path: string } | null }
  | { found: "none"; info: null; suggestion: null };

/** Elemento de la lista en modo continuo */
interface Row {
  code: string;
  count: number;
  status: "loading" | "own" | "public" | "none";
  product?: Product;
  /** Variantes del producto conocido y la elegida para este código */
  variants?: ProductVariant[];
  variantId?: string | null;
  info?: PublicInfo | null;
  categoryId: string | null;
  nombre: string;
  precio: string;
  done?: "stock" | "created" | "error";
}

/** Escanear código de barras: repetidos, alta desde catálogo público y lotes — sin gastar IA. */
export default function ScanPage() {
  const supabase = createClient();
  const toast = useToast();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopRef = useRef<number | null>(null);
  const lastSeen = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const pausedUntil = useRef(0); // tras cada lectura, pausa breve para no contar el mismo producto 2 o 3 veces
  const [flash, setFlash] = useState<string | null>(null); // código recién leído (destello verde)
  const audioRef = useRef<AudioContext | null>(null);

  /** Beep corto (generado, sin archivo) + vibración. */
  const beep = useCallback((repeat = false) => {
    try {
      const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      audioRef.current ??= new Ctx();
      const ctx = audioRef.current;
      if (ctx.state === "suspended") ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = repeat ? 660 : 1320; // más grave si es un código repetido en el lote
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch {
      /* sin audio: la vibración y el destello bastan */
    }
    navigator.vibrate?.(repeat ? [20, 40, 20] : 35);
  }, []);

  const [continuous, setContinuous] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Found | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [batchCategory, setBatchCategory] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [help, setHelp] = useState(false);

  const [categories, setCategories] = useState<Category[]>([]);
  const [templates, setTemplates] = useState<FieldTemplate[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [data, setData] = useState<ProductData>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [c, t] = await Promise.all([supabase.from("categories").select("*"), supabase.from("field_templates").select("*").order("sort_order")]);
      setCategories(c.data ?? []);
      setTemplates(t.data ?? []);
    })();
  }, [supabase]);

  const stop = useCallback(() => {
    if (loopRef.current) cancelAnimationFrame(loopRef.current);
    loopRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);
  useEffect(() => () => stop(), [stop]);

  const fetchCode = useCallback(async (c: string): Promise<Found | null> => {
    const res = await fetch(`/api/barcode?code=${encodeURIComponent(c)}`);
    const json = (await res.json().catch(() => ({}))) as Found & { error?: string };
    if (!res.ok) {
      toast("error", json.error || "No se pudo consultar el código");
      return null;
    }
    return json;
  }, [toast]);

  /** Modo individual: consulta y muestra el resultado. */
  const lookup = useCallback(
    async (raw: string) => {
      const c = cleanCode(raw);
      if (!c) return;
      setBusy(true);
      setCode(c);
      const json = await fetchCode(c);
      setBusy(false);
      if (!json) return;
      navigator.vibrate?.(25);
      setResult(json);
      if (json.found === "public") {
        setData({ nombre: json.info.nombre, marca: json.info.marca, contenido: json.info.contenido, codigo_barras: c });
        setCategoryId(json.suggestion?.category_id ?? null);
      } else if (json.found === "none") {
        setData({ codigo_barras: c });
        setCategoryId(null);
      }
    },
    [fetchCode]
  );

  /** Modo continuo: agrega a la lista (o suma 1 si ya está). */
  const addToList = useCallback(
    async (raw: string) => {
      const c = cleanCode(raw);
      if (!c) return;
      navigator.vibrate?.(15);
      let exists = false;
      setRows((rs) => {
        exists = rs.some((r) => r.code === c);
        return exists ? rs.map((r) => (r.code === c ? { ...r, count: r.count + 1 } : r)) : [{ code: c, count: 1, status: "loading", categoryId: null, nombre: "", precio: "" }, ...rs];
      });
      if (exists) return;
      const json = await fetchCode(c);
      setRows((rs) =>
        rs.map((r) => {
          if (r.code !== c) return r;
          if (!json) return { ...r, status: "none" };
          if (json.found === "own") return { ...r, status: "own", product: json.product, variants: json.variants ?? [], variantId: json.variant?.id ?? null, nombre: productTitle(json.product.data) };
          if (json.found === "public") return { ...r, status: "public", info: json.info, nombre: json.info.nombre, categoryId: json.suggestion?.category_id ?? null };
          return { ...r, status: "none", info: null };
        })
      );
    },
    [fetchCode]
  );

  async function start() {
    setCamError(null);
    if (!continuous) setResult(null);
    // iPhone solo permite sonido si el audio se inicia desde un toque: lo preparamos aquí (el botón)
    try {
      const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      audioRef.current ??= new Ctx();
      await audioRef.current.resume();
    } catch {
      /* sin audio */
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } } });
      streamRef.current = stream;
      setScanning(true);
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      const tick = async () => {
        if (!streamRef.current) return;
        const now = Date.now();
        if (video.readyState >= 2 && now >= pausedUntil.current) {
          const found = await scanFrame(video);
          if (found) {
            if (!continuous) {
              beep();
              stop();
              await lookup(found);
              return;
            }
            // Lote: el mismo código solo cuenta otra vez si pasaron 4 s o se leyó otro código entre medias
            const isRepeat = found === lastSeen.current.code;
            if (!isRepeat || now - lastSeen.current.at > 4000) {
              lastSeen.current = { code: found, at: now };
              beep(isRepeat);
              setFlash(found);
              pausedUntil.current = now + 1500; // pausa: 1,5 s sin leer nada
              setTimeout(() => setFlash(null), 1500);
              addToList(found);
            }
          }
        }
        loopRef.current = requestAnimationFrame(tick);
      };
      loopRef.current = requestAnimationFrame(tick);
    } catch {
      setScanning(false);
      setCamError("No se pudo abrir la cámara. Escribe el código a mano o usa la foto con IA.");
    }
  }

  // ---- alta individual sin IA ----
  const fields = getEffectiveFields(templates, categories, categoryId);
  const nameField = fields.find((f) => /^(nombre|name|producto|titulo)$/i.test(f.name)) ?? null;
  const keyFields = fields.filter((f) => f.field_type === "number" && /^(precio|price|stock|cantidad|existencias)$/i.test(f.name));
  useEffect(() => {
    if (categoryId) setData((d) => applyDefaults(fields, { ...d }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  async function saveNew() {
    if (!categoryId) return toast("error", "Elige la categoría");
    setSaving(true);
    const res = await fetch("/api/barcode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, category_id: categoryId, data, image_url: result?.found === "public" ? result.info.imagen : null, status: "confirmed" }),
    });
    const json = (await res.json().catch(() => ({}))) as { product?: Product; error?: string };
    setSaving(false);
    if (!res.ok || !json.product) return toast("error", json.error || "No se pudo guardar");
    toast("success", "Producto guardado sin usar IA");
    router.push(`/products/${json.product.id}`);
  }

  /** Suma stock a una variante concreta; si el código no estaba en esa variante, se le asigna para la próxima vez. */
  async function addVariantStock(v: ProductVariant, n: number, scanned: string): Promise<ProductVariant | null> {
    const patch: Partial<ProductVariant> = { stock: v.stock + n };
    if (!v.codigo_barras && scanned) patch.codigo_barras = scanned;
    const { error } = await supabase.from("product_variants").update(patch).eq("id", v.id);
    if (error) {
      toast("error", /product_variants_codigo/.test(error.message) ? "Ese código ya está en otra variante" : error.message);
      return null;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from("stock_movements").insert({ user_id: user!.id, product_id: v.product_id, variant_id: v.id, variant_label: v.label, tipo: "entrada", cantidad: n, motivo: "escáner", stock_resultante: v.stock + n });
    return { ...v, ...patch } as ProductVariant;
  }

  async function addStock(p: Product, n: number) {
    const own = result?.found === "own" ? result : null;
    if (own?.variants?.length) {
      const v = own.variant ?? null;
      if (!v) return toast("info", "Elige primero a qué variante pertenece este código");
      const updated = await addVariantStock(v, n, code);
      if (!updated) return;
      toast("success", `+${n} a ${v.label}: ${v.stock} → ${updated.stock}${!v.codigo_barras ? " · código guardado en esta variante" : ""}`);
      setResult({ ...own, variant: updated, variants: own.variants.map((x) => (x.id === updated.id ? updated : x)) });
      return;
    }
    const keys = Object.keys(p.data);
    const key = ["stock", "cantidad", "existencias"].map((k) => keys.find((x) => normalizeFieldName(x) === k)).find(Boolean);
    if (!key) return toast("error", "Este producto no tiene un campo de stock");
    const current = Number(p.data[key] ?? 0) || 0;
    const { error } = await supabase.from("products").update({ data: { ...p.data, [key]: current + n } }).eq("id", p.id);
    if (error) return toast("error", error.message);
    toast("success", `Stock actualizado: ${current} → ${current + n}`);
    setResult({ found: "own", product: { ...p, data: { ...p.data, [key]: current + n } } });
  }

  // ---- lote ----
  const pendingRows = rows.filter((r) => !r.done && r.status !== "loading");
  const readyRows = pendingRows.filter((r) => (r.status === "own" ? !r.variants?.length || !!r.variantId : (r.categoryId || batchCategory) && r.nombre.trim()));

  async function saveBatch() {
    setBatchBusy(true);
    let ok = 0;
    for (const r of pendingRows) {
      if (r.status === "own" && r.product && r.variants?.length) {
        const v = r.variants.find((x) => x.id === r.variantId);
        if (!v) continue;
        const updated = await addVariantStock(v, r.count, r.code);
        setRows((rs) => rs.map((x) => (x.code === r.code ? { ...x, done: updated ? "stock" : "error" } : x)));
        if (updated) ok++;
        continue;
      }
      if (r.status === "own" && r.product) {
        const keys = Object.keys(r.product.data);
        const key = ["stock", "cantidad", "existencias"].map((k) => keys.find((x) => normalizeFieldName(x) === k)).find(Boolean) ?? "stock";
        const current = Number(r.product.data[key] ?? 0) || 0;
        const { error } = await supabase.from("products").update({ data: { ...r.product.data, [key]: current + r.count } }).eq("id", r.product.id);
        setRows((rs) => rs.map((x) => (x.code === r.code ? { ...x, done: error ? "error" : "stock" } : x)));
        if (!error) ok++;
        continue;
      }
      const cat = r.categoryId || batchCategory;
      if (!cat || !r.nombre.trim()) continue;
      const res = await fetch("/api/barcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: r.code,
          category_id: cat,
          data: { nombre: r.nombre.trim(), marca: r.info?.marca ?? "", contenido: r.info?.contenido ?? "", precio: r.precio || null, stock: r.count },
          image_url: r.info?.imagen ?? null,
          status: "confirmed",
        }),
      });
      setRows((rs) => rs.map((x) => (x.code === r.code ? { ...x, done: res.ok ? "created" : "error" } : x)));
      if (res.ok) ok++;
    }
    setBatchBusy(false);
    navigator.vibrate?.(30);
    toast("success", `${ok} producto${ok === 1 ? "" : "s"} listos — 0 análisis de IA`);
  }

  const reset = () => {
    setResult(null);
    setCode("");
    setData({});
    setCategoryId(null);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header className="animate-in">
        <Link href="/capture" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"><IconArrowLeft size={16} /> Agregar productos</Link>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Escanear código de barras</h1>
        <p className="text-sm text-slate-500">Repetidos, reposición y alta de productos conocidos <b>sin gastar análisis de IA</b>.</p>
      </header>
      <CoachTip screen="scan" title="Apunta al código y espera el beep">
        Si el producto ya está en tu inventario, sumas stock con <b>+1 / +5 / +10</b>. Si no, lo buscamos en catálogos públicos y lo das de alta sin IA.
      </CoachTip>

      {/* Modo */}
      <div className="animate-in grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
        <button onClick={() => { if (scanning) stop(); setContinuous(false); }} className={`rounded-xl px-3 py-2 text-sm font-semibold ${!continuous ? "bg-white text-ink shadow" : "text-slate-500"}`}>Uno por uno</button>
        <button onClick={() => { if (scanning) stop(); setContinuous(true); setResult(null); }} className={`rounded-xl px-3 py-2 text-sm font-semibold ${continuous ? "bg-white text-ink shadow" : "text-slate-500"}`}>Lote continuo</button>
      </div>

      {/* Cámara */}
      {(!result || continuous) && (
        <div className="animate-in card space-y-3">
          <div className={`relative overflow-hidden rounded-2xl bg-slate-900 ${scanning ? "" : "hidden"}`}>
            <video ref={videoRef} playsInline muted className="h-64 w-full object-cover" />
            <div className={`pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-xl border-2 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)] transition ${flash ? "border-emerald-300 bg-emerald-400/40" : "border-emerald-400/90"}`} />
            {flash && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <span className="animate-in rounded-full bg-emerald-500 px-4 py-2 text-lg font-bold text-white shadow-lg">✓ {flash}</span>
              </div>
            )}
            <span className="absolute inset-x-0 bottom-2 text-center text-xs font-semibold text-white">
              {flash ? "Leído · aparta el producto y pasa el siguiente" : continuous ? `Sigue escaneando · ${rows.length} código${rows.length === 1 ? "" : "s"}` : "Apunta al código de barras"}
            </span>
          </div>
          {!scanning ? (
            <button onClick={start} className="btn-primary btn-lg w-full" disabled={busy}>
              {busy ? <Spinner /> : <IconTag size={22} />} {continuous ? "Empezar lote" : "Escanear con la cámara"}
            </button>
          ) : (
            <button onClick={stop} className="btn-destructive w-full"><IconX size={18} /> Detener cámara</button>
          )}
          {camError && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">{camError}</p>}
          <div className="flex gap-2">
            <input className="input" placeholder="…o escribe el código" inputMode="numeric" value={manual} onChange={(e) => setManual(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (continuous ? (addToList(manual), setManual("")) : lookup(manual))} />
            <button onClick={() => { continuous ? (addToList(manual), setManual("")) : lookup(manual); }} disabled={busy || manual.trim().length < 6} className="btn-secondary shrink-0">
              {busy ? <Spinner size={16} /> : <IconSearch size={16} />} {continuous ? "Agregar" : "Buscar"}
            </button>
          </div>
        </div>
      )}

      {/* ---------- Lote continuo ---------- */}
      {continuous && rows.length > 0 && (
        <div className="animate-in card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-ink">Lote ({rows.length})</h2>
            <button onClick={() => setRows([])} className="btn-ghost btn-sm"><IconTrash size={14} /> Vaciar</button>
          </div>
          {pendingRows.some((r) => r.status !== "own" && !r.categoryId) && (
            <div>
              <label className="label">Categoría para los nuevos sin sugerencia</label>
              <CategoryPicker categories={categories} value={batchCategory} onChange={setBatchCategory} onCategoriesChange={setCategories} emptyLabel="Elegir categoría" />
            </div>
          )}
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.code} className={`rounded-2xl border-2 p-3 ${r.done === "error" ? "border-rose-300" : r.done ? "border-emerald-300 bg-emerald-50/50" : "border-slate-200"}`}>
                <div className="flex items-center gap-2">
                  <span className="grid h-8 min-w-[32px] place-items-center rounded-full bg-ink px-2 text-sm font-bold text-white">×{r.count}</span>
                  <span className="min-w-0 flex-1">
                    {r.status === "loading" ? (
                      <span className="flex items-center gap-2 text-sm text-slate-500"><Spinner size={14} /> consultando…</span>
                    ) : r.status === "own" ? (
                      <>
                        <span className="block truncate font-semibold text-ink">{r.nombre || "Sin nombre"}</span>
                        {r.variants?.length ? (
                          <span className="mt-1 flex items-center gap-1 text-xs">
                            <span className="text-violet-800">Variante:</span>
                            <select className="input w-auto py-1 text-xs" value={r.variantId ?? ""} onChange={(e) => setRows((rs) => rs.map((x) => (x.code === r.code ? { ...x, variantId: e.target.value || null } : x)))}>
                              <option value="">¿cuál?</option>
                              {r.variants.map((v) => <option key={v.id} value={v.id}>{v.label} ({v.stock})</option>)}
                            </select>
                          </span>
                        ) : (
                          <span className="block text-xs text-amber-700">Ya en inventario → se suma {r.count} al stock</span>
                        )}
                      </>
                    ) : (
                      <>
                        <input className="input py-1.5 text-sm font-semibold" placeholder="Nombre del producto" value={r.nombre} onChange={(e) => setRows((rs) => rs.map((x) => (x.code === r.code ? { ...x, nombre: e.target.value } : x)))} />
                        <span className="mt-1 block truncate text-xs text-slate-500">
                          {r.status === "public" ? `${r.info?.fuente} · ${r.info?.marca || ""} ${r.info?.imagen ? "· con foto" : ""}` : "no está en los catálogos"} ·{" "}
                          <span className={r.categoryId ? "text-emerald-700" : "text-amber-700"}>{r.categoryId ? categoryPath(categories, r.categoryId) : batchCategory ? categoryPath(categories, batchCategory) : "sin categoría"}</span>
                        </span>
                      </>
                    )}
                  </span>
                  {r.status !== "own" && r.status !== "loading" && (
                    <input className="input w-24 py-1.5 text-right text-sm tabular-nums" placeholder="precio" inputMode="decimal" value={r.precio} onChange={(e) => setRows((rs) => rs.map((x) => (x.code === r.code ? { ...x, precio: e.target.value } : x)))} />
                  )}
                  <span className="shrink-0 text-xs font-semibold">
                    {r.done === "stock" ? <span className="text-emerald-700">+{r.count} ✓</span> : r.done === "created" ? <span className="text-emerald-700">creado ✓</span> : r.done === "error" ? <span className="text-rose-600">error</span> : null}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <button onClick={saveBatch} disabled={batchBusy || readyRows.length === 0} className="btn-success btn-lg w-full">
            {batchBusy ? <Spinner /> : <IconCheck size={20} />} Dar de alta {readyRows.length} · sin IA
          </button>
          {pendingRows.length > readyRows.length && <p className="hint text-center">Los que no tienen nombre o categoría se quedan en la lista hasta completarlos.</p>}
        </div>
      )}

      {/* ---------- Resultado individual ---------- */}
      {!continuous && result && (
        <div className="animate-in space-y-3">
          <div className="flex items-center gap-2 rounded-2xl bg-slate-100 px-3 py-2 text-sm">
            <IconTag size={16} className="text-slate-500" />
            <span className="font-mono font-semibold text-ink">{code}</span>
            <button onClick={reset} className="btn-secondary btn-sm ml-auto"><IconX size={14} /> Otro código</button>
          </div>

          {result.found === "own" && (
            <div className="card space-y-3 border-2 border-amber-300">
              <p className="flex items-center gap-2 font-bold text-amber-900"><IconBox size={20} /> Ya está en tu inventario</p>
              <Link href={`/products/${result.product.id}`} className="flex items-center gap-3 rounded-2xl border-2 border-slate-200 p-3 hover:border-brand-400">
                {result.product.image_url ? <img src={result.product.image_url} alt="" className="h-14 w-14 rounded-xl object-cover" /> : <span className="grid h-14 w-14 place-items-center rounded-xl bg-slate-100 text-slate-400"><IconBox /></span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink">{productTitle(result.product.data) || "Sin nombre"}</span>
                  <span className="block truncate text-xs text-slate-500">{categoryPath(categories, result.product.category_id)}</span>
                </span>
                <IconChevronRight className="text-slate-300" />
              </Link>
              {result.variants?.length ? (
                <div className="rounded-2xl bg-violet-50 p-3">
                  <p className="text-xs font-semibold text-violet-900">{result.variant ? `Este código es de la variante ${result.variant.label}` : "Este producto tiene variantes. ¿A cuál pertenece este código?"}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {result.variants.map((v) => (
                      <button key={v.id} type="button" onClick={() => setResult({ ...result, variant: v })} className={`rounded-full border-2 px-3 py-1 text-sm font-semibold ${result.variant?.id === v.id ? "border-violet-600 bg-violet-600 text-white" : "border-slate-300 bg-white text-slate-700"}`}>
                        {v.label} <span className="opacity-70">{v.stock}</span>
                      </button>
                    ))}
                  </div>
                  {!result.variant && <p className="mt-1 text-[11px] text-violet-800">El código quedará guardado en la variante que elijas.</p>}
                </div>
              ) : (
                <p className="text-xs text-slate-500">Stock actual: <b className="text-ink">{String(getValue(result.product.data, "stock") ?? "—")}</b></p>
              )}
              <div className="grid grid-cols-3 gap-2">
                {[1, 5, 10].map((n) => (
                  <button key={n} onClick={() => addStock((result as { product: Product }).product, n)} className="btn-secondary"><IconPlus size={16} /> {n}</button>
                ))}
              </div>
              <Link href={`/products/${result.product.id}`} className="btn-primary w-full">Abrir y editar</Link>
            </div>
          )}

          {result.found !== "own" && (
            <div className="card space-y-4">
              {result.found === "public" ? (
                <div className="flex gap-3 rounded-2xl bg-emerald-50 p-3">
                  {result.info.imagen && <img src={result.info.imagen} alt="" className="h-16 w-16 shrink-0 rounded-xl object-contain bg-white" />}
                  <div className="min-w-0 text-sm">
                    <p className="flex items-center gap-1.5 font-semibold text-emerald-900"><IconCheck size={16} /> Encontrado en {result.info.fuente}</p>
                    <p className="text-emerald-800">Nombre, marca{result.info.imagen ? " y foto" : ""} listos. {result.suggestion ? <>Categoría sugerida: <b>{result.suggestion.path}</b>.</> : "Elige la categoría."} <b>Sin gastar IA.</b></p>
                  </div>
                </div>
              ) : (
                <p className="rounded-2xl bg-slate-100 p-3 text-sm text-slate-700">El código no está en tu inventario ni en los catálogos públicos. Escribe los datos o usa la foto con IA.</p>
              )}

              <div>
                <label className="label">Categoría</label>
                <CategoryPicker categories={categories} value={categoryId} onChange={setCategoryId} onCategoriesChange={setCategories} emptyLabel="Elegir categoría" />
              </div>

              {categoryId && (
                <>
                  {nameField && (
                    <div>
                      <label className="label">{fieldLabel(nameField.name)} *</label>
                      <FieldInput field={nameField} value={data[nameField.name]} onChange={(v) => setData({ ...data, [nameField.name]: v })} className="input font-semibold" />
                    </div>
                  )}
                  {keyFields.length > 0 && (
                    <div className="grid grid-cols-2 gap-3">
                      {keyFields.map((f) => (
                        <div key={f.id} className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
                          <label className="label mb-1">{fieldLabel(f.name)}</label>
                          <FieldInput field={f} value={data[f.name]} onChange={(v) => setData({ ...data, [f.name]: v })} className="input-lg text-2xl tabular-nums" />
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              <div className="grid gap-2">
                <button onClick={saveNew} disabled={saving || !categoryId} className="btn-success btn-lg w-full">
                  {saving ? <Spinner /> : <IconCheck size={20} />} Guardar sin usar IA
                </button>
                <Link href="/capture" className="btn-secondary w-full">
                  <IconCamera size={18} /> Mejor tomar foto y analizar con IA
                  <span className="ml-auto text-xs font-normal text-slate-500">1 análisis</span>
                </Link>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------- Cómo funciona ---------- */}
      <section className="animate-in">
        <button onClick={() => setHelp((v) => !v)} className="btn-disclosure">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-100 text-brand-700"><IconSparkles size={18} /></span>
          <span className="min-w-0 flex-1">
            <span className="block">¿Cómo funciona el código de barras?</span>
            <span className="block text-xs font-normal text-slate-500">Qué consulta, qué ahorra y qué no puede hacer</span>
          </span>
          <IconChevronRight className={`shrink-0 text-brand-600 transition ${help ? "rotate-90" : ""}`} />
        </button>
        {help && (
          <div className="mt-2 space-y-3 rounded-2xl border-2 border-slate-200 p-4 text-sm text-slate-700">
            <ol className="space-y-2">
              <li className="flex gap-2"><b className="shrink-0 text-brand-700">1.</b><span><b>Tu inventario.</b> Si el código ya existe, no se crea nada: sumas stock con +1/+5/+10 (o ×N en lote).</span></li>
              <li className="flex gap-2"><b className="shrink-0 text-brand-700">2.</b><span><b>Catálogos públicos gratuitos</b> (Open Food, Beauty, Products y Pet Food Facts, consultados a la vez). Si el producto existe: nombre, marca, contenido, <b>foto</b> y una <b>categoría sugerida</b> de las tuyas. Guardas sin usar IA.</span></li>
              <li className="flex gap-2"><b className="shrink-0 text-brand-700">3.</b><span><b>No encontrado.</b> Escribes nombre y precio (el código se guarda igual) o pasas a la foto con IA.</span></li>
            </ol>
            <p><b>Lote continuo:</b> la cámara sigue abierta; cada código se agrega a la lista y las repeticiones suman ×N. Tras cada lectura suena un <b>beep</b>, la pantalla parpadea en verde y se hace una <b>pausa de 1,5 s</b> para que un producto no cuente 2 o 3 veces; el mismo código solo vuelve a contar si pasaron 4 s o leíste otro producto entre medias (beep más grave = repetido). Al final, <i>Dar de alta</i> crea los nuevos con stock = veces escaneado y suma stock a los que ya tenías.</p>
            <p><b>Ahorro:</b> nada de esta pantalla consume cupo de IA. Cada producto resuelto por código = 1 análisis ahorrado.</p>
            <p className="rounded-xl bg-amber-50 p-2 text-amber-900"><b>Límite:</b> los catálogos cubren productos envasados de marca (bebidas, abarrotes, limpieza, farmacia, cosmética, mascotas). Ropa, juguetes o productos locales sin registro solo aprovechan el paso 1; sus datos los da la foto con IA.</p>
          </div>
        )}
      </section>
    </div>
  );
}
