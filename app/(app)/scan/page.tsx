"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Category, FieldTemplate, Product, ProductData } from "@/types/database";
import { applyDefaults, coerceValue, fieldLabel, getEffectiveFields, getValue, normalizeFieldName, productTitle } from "@/lib/fields";
import { cleanCode, scanFrame } from "@/lib/barcode";
import { categoryPath } from "@/lib/categories";
import CategoryPicker from "@/components/CategoryPicker";
import FieldInput from "@/components/FieldInput";
import { useToast } from "@/components/ui/Toast";
import { IconArrowLeft, IconBox, IconCamera, IconCheck, IconPlus, IconSearch, IconSparkles, IconTag, IconX, Spinner } from "@/components/ui/Icons";

type Found =
  | { found: "own"; product: Product }
  | { found: "public"; info: { nombre: string; marca: string; contenido: string; categoria_publica: string; imagen: string | null; fuente: string } }
  | { found: "none"; info: null };

/** Escanear código de barras: duplicados y alta sin gastar análisis de IA. */
export default function ScanPage() {
  const supabase = createClient();
  const toast = useToast();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopRef = useRef<number | null>(null);

  const [scanning, setScanning] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Found | null>(null);

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

  const lookup = useCallback(
    async (raw: string) => {
      const c = cleanCode(raw);
      if (!c) return;
      setBusy(true);
      setCode(c);
      const res = await fetch(`/api/barcode?code=${encodeURIComponent(c)}`);
      const json = (await res.json().catch(() => ({}))) as Found & { error?: string };
      setBusy(false);
      if (!res.ok) return toast("error", json.error || "No se pudo consultar el código");
      setResult(json);
      navigator.vibrate?.(25);
      if (json.found === "public") {
        setData({ nombre: json.info.nombre, marca: json.info.marca, codigo_barras: c });
      } else if (json.found === "none") {
        setData({ codigo_barras: c });
      }
    },
    [toast]
  );

  async function start() {
    setCamError(null);
    setResult(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } } });
      streamRef.current = stream;
      setScanning(true);
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      const tick = async () => {
        if (!streamRef.current) return;
        if (video.readyState >= 2) {
          const found = await scanFrame(video);
          if (found) {
            stop();
            await lookup(found);
            return;
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

  // ---- alta rápida sin IA ----
  const fields = getEffectiveFields(templates, categories, categoryId);
  const nameField = fields.find((f) => /^(nombre|name|producto|titulo)$/i.test(f.name)) ?? null;
  const keyFields = fields.filter((f) => f.field_type === "number" && /^(precio|price|stock|cantidad|existencias)$/i.test(f.name));
  const codeField = fields.find((f) => normalizeFieldName(f.name) === "codigo_barras");

  useEffect(() => {
    if (categoryId) setData((d) => applyDefaults(fields, { ...d }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  async function saveNew() {
    if (!categoryId) return toast("error", "Elige la categoría");
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const clean: ProductData = { ...data };
    fields.forEach((f) => (clean[f.name] = coerceValue(f, data[f.name])));
    clean.codigo_barras = code; // siempre guardamos el código, aunque no exista el campo
    const { data: created, error } = await supabase
      .from("products")
      .insert({ user_id: user!.id, category_id: categoryId, status: "confirmed", data: clean, ai_meta: { etiqueta: `Código ${code}` } })
      .select()
      .single();
    setSaving(false);
    if (error) return toast("error", error.message);
    toast("success", "Producto guardado sin usar IA");
    router.push(`/products/${created.id}`);
  }

  async function addStock(p: Product, n: number) {
    const keys = Object.keys(p.data);
    const key = ["stock", "cantidad", "existencias"].map(normalizeFieldName).map((k) => keys.find((x) => normalizeFieldName(x) === k)).find(Boolean);
    if (!key) return toast("error", "Este producto no tiene un campo de stock");
    const current = Number(p.data[key] ?? 0) || 0;
    const { error } = await supabase.from("products").update({ data: { ...p.data, [key]: current + n } }).eq("id", p.id);
    if (error) return toast("error", error.message);
    toast("success", `Stock actualizado: ${current} → ${current + n}`);
    setResult({ found: "own", product: { ...p, data: { ...p.data, [key]: current + n } } });
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
        <p className="text-sm text-slate-500">Detecta repetidos y da de alta productos conocidos <b>sin gastar análisis de IA</b>.</p>
      </header>

      {/* Cámara */}
      {!result && (
        <div className="animate-in card space-y-3">
          <div className={`relative overflow-hidden rounded-2xl bg-slate-900 ${scanning ? "" : "hidden"}`}>
            <video ref={videoRef} playsInline muted className="h-64 w-full object-cover" />
            <div className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-xl border-2 border-emerald-400/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            <span className="absolute inset-x-0 bottom-2 text-center text-xs font-semibold text-white">Apunta al código de barras</span>
          </div>

          {!scanning ? (
            <button onClick={start} className="btn-primary btn-lg w-full" disabled={busy}>
              {busy ? <Spinner /> : <IconTag size={22} />} Escanear con la cámara
            </button>
          ) : (
            <button onClick={stop} className="btn-destructive w-full"><IconX size={18} /> Detener cámara</button>
          )}
          {camError && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">{camError}</p>}

          <div className="flex gap-2">
            <input
              className="input"
              placeholder="…o escribe el código"
              inputMode="numeric"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && lookup(manual)}
            />
            <button onClick={() => lookup(manual)} disabled={busy || manual.trim().length < 6} className="btn-secondary shrink-0">
              {busy ? <Spinner size={16} /> : <IconSearch size={16} />} Buscar
            </button>
          </div>
        </div>
      )}

      {/* Resultado */}
      {result && (
        <div className="animate-in space-y-3">
          <div className="flex items-center gap-2 rounded-2xl bg-slate-100 px-3 py-2 text-sm">
            <IconTag size={16} className="text-slate-500" />
            <span className="font-mono font-semibold text-ink">{code}</span>
            <button onClick={reset} className="btn-secondary btn-sm ml-auto"><IconX size={14} /> Otro código</button>
          </div>

          {/* a) Ya existe en el inventario */}
          {result.found === "own" && (
            <div className="card space-y-3 border-2 border-amber-300">
              <p className="flex items-center gap-2 font-bold text-amber-900"><IconBox size={20} /> Este producto ya está en tu inventario</p>
              <Link href={`/products/${result.product.id}`} className="flex items-center gap-3 rounded-2xl border-2 border-slate-200 p-3 hover:border-brand-400">
                {result.product.image_url ? (
                  <img src={result.product.image_url} alt="" className="h-14 w-14 rounded-xl object-cover" />
                ) : (
                  <span className="grid h-14 w-14 place-items-center rounded-xl bg-slate-100 text-slate-400"><IconBox /></span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink">{productTitle(result.product.data) || "Sin nombre"}</span>
                  <span className="block truncate text-xs text-slate-500">{categoryPath(categories, result.product.category_id)}</span>
                </span>
              </Link>
              <p className="text-xs text-slate-500">Stock actual: <b className="text-ink">{String(getValue(result.product.data, "stock") ?? "—")}</b></p>
              <div className="grid grid-cols-3 gap-2">
                {[1, 5, 10].map((n) => (
                  <button key={n} onClick={() => addStock((result as { product: Product }).product, n)} className="btn-secondary">
                    <IconPlus size={16} /> {n}
                  </button>
                ))}
              </div>
              <Link href={`/products/${result.product.id}`} className="btn-primary w-full">Abrir y editar</Link>
            </div>
          )}

          {/* b) Encontrado en el catálogo público / c) desconocido */}
          {result.found !== "own" && (
            <div className="card space-y-4">
              {result.found === "public" ? (
                <p className="flex items-center gap-2 rounded-2xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">
                  <IconCheck size={18} /> Encontrado en el catálogo público — sin gastar IA
                </p>
              ) : (
                <p className="rounded-2xl bg-slate-100 p-3 text-sm text-slate-700">
                  El código no está en tu inventario ni en el catálogo público. Escribe los datos o usa la foto con IA.
                </p>
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
                  {!codeField && (
                    <p className="hint">El código se guarda igual en el producto (aparecerá en el Excel como “Codigo barras”).</p>
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

      <p className="flex items-start gap-2 rounded-2xl bg-brand-50 p-3 text-xs text-brand-900">
        <IconSparkles size={16} className="mt-0.5 shrink-0 text-brand-600" />
        Escanear no consume cupo de IA. Funciona mejor con productos envasados (bebidas, abarrotes, limpieza). Para ropa, artesanías o productos sin código, usa la foto.
      </p>
    </div>
  );
}
