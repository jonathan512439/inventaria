"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useToast } from "./ui/Toast";
import { IconAlert, IconCheck, IconChevronRight, IconTrash, Spinner } from "./ui/Icons";

interface Counts {
  oldDrafts: number;
  drafts: number;
  emptySubs: number;
  emptyTops: number;
  orphanPhotos: number;
  noCategory: number;
  noPrice: number;
}

type Key = "oldDrafts" | "emptySubs" | "emptyTops" | "orphanPhotos";

/** Tarjeta "Ordenar y limpiar": muestra lo que sobra o falta y borra solo lo marcado. */
export default function CleanupCard() {
  const toast = useToast();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [oldDays, setOldDays] = useState(7);
  const [sel, setSel] = useState<Set<Key>>(new Set());
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function load() {
    const res = await fetch("/api/cleanup", { cache: "no-store" });
    if (!res.ok) return;
    const j = (await res.json()) as { counts: Counts; oldDays: number };
    setCounts(j.counts);
    setOldDays(j.oldDays);
  }
  useEffect(() => {
    load();
  }, []);

  const toggle = (k: Key) =>
    setSel((s) => {
      const n = new Set(s);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  const removable = (
    counts
      ? ([
          { key: "oldDrafts", n: counts.oldDrafts, title: `${counts.oldDrafts} pendientes de más de ${oldDays} días`, hint: "se borran con su foto" },
          { key: "emptySubs", n: counts.emptySubs, title: `${counts.emptySubs} subcategorías sin productos`, hint: "solo las vacías" },
          { key: "emptyTops", n: counts.emptyTops, title: `${counts.emptyTops} categorías sin productos`, hint: "incluye sus subcategorías vacías" },
          { key: "orphanPhotos", n: counts.orphanPhotos, title: `${counts.orphanPhotos} fotos sin producto`, hint: "libera espacio" },
        ] as { key: Key; n: number; title: string; hint: string }[])
      : []
  ).filter((x) => x.n > 0);

  const toFix = counts
    ? [
        { n: counts.noCategory, title: `${counts.noCategory} productos sin categoría`, href: "/review" },
        { n: counts.noPrice, title: `${counts.noPrice} productos sin precio`, href: "/products" },
      ].filter((x) => x.n > 0)
    : [];

  const total = removable.length + toFix.length;
  const selectedCount = removable.filter((r) => sel.has(r.key)).reduce((s, r) => s + r.n, 0);

  async function run() {
    const actions = Array.from(sel);
    if (!actions.length) return;
    const detail = removable.filter((r) => sel.has(r.key)).map((r) => `• ${r.title}`).join("\n");
    if (!confirm(`Se va a eliminar definitivamente:\n\n${detail}\n\n¿Continuar?`)) return;
    setBusy(true);
    const res = await fetch("/api/cleanup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actions }) });
    const j = (await res.json().catch(() => ({}))) as { counts?: Counts; error?: string };
    setBusy(false);
    if (!res.ok) return toast("error", j.error || "No se pudo limpiar");
    if (j.counts) setCounts(j.counts);
    setSel(new Set());
    toast("success", `Listo: ${selectedCount} elemento(s) eliminados`);
  }

  if (!counts) return null;

  if (total === 0) {
    return (
      <div className="animate-in flex items-center gap-3 rounded-3xl border-2 border-emerald-200 bg-emerald-50 p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-emerald-500 text-white"><IconCheck size={20} /></span>
        <p className="text-sm font-semibold text-emerald-900">Todo ordenado: sin pendientes viejos, categorías vacías ni fotos sueltas.</p>
      </div>
    );
  }

  return (
    <section id="limpiar" className="animate-in scroll-mt-20 overflow-hidden rounded-3xl border-2 border-slate-300 bg-white shadow-card">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 px-4 py-4 text-left">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-amber-100 text-amber-700">
          <IconAlert size={22} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold text-ink">Ordenar y limpiar</span>
          <span className="block text-xs text-slate-500">
            {total} cosa{total === 1 ? "" : "s"} por revisar · libera espacio y ordena tus categorías
          </span>
        </span>
        <IconChevronRight className={`shrink-0 text-slate-400 transition ${open ? "rotate-90" : ""}`} />
      </button>

      {open && (
        <div className="space-y-3 border-t-2 border-slate-100 p-4">
          {removable.length > 0 && (
            <>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Se puede eliminar</p>
              <ul className="space-y-2">
                {removable.map((r) => (
                  <li key={r.key}>
                    <label className={`flex cursor-pointer items-center gap-3 rounded-2xl border-2 p-3 transition ${sel.has(r.key) ? "border-rose-400 bg-rose-50" : "border-slate-200 hover:border-slate-300"}`}>
                      <input type="checkbox" className="h-5 w-5 accent-rose-600" checked={sel.has(r.key)} onChange={() => toggle(r.key)} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-ink">{r.title}</span>
                        <span className="block text-xs text-slate-500">{r.hint}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <button onClick={run} disabled={busy || sel.size === 0} className="btn-destructive w-full">
                {busy ? <Spinner /> : <IconTrash size={18} />}
                {sel.size === 0 ? "Marca lo que quieras eliminar" : `Eliminar lo marcado (${selectedCount})`}
              </button>
            </>
          )}

          {toFix.length > 0 && (
            <>
              <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Necesita tu atención (no se borra)</p>
              <ul className="space-y-2">
                {toFix.map((t) => (
                  <li key={t.title}>
                    <Link href={t.href} className="flex items-center gap-3 rounded-2xl border-2 border-amber-200 bg-amber-50 p-3 hover:border-amber-300">
                      <span className="min-w-0 flex-1 text-sm font-semibold text-amber-900">{t.title}</span>
                      <span className="btn-secondary btn-sm shrink-0">Ver</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
