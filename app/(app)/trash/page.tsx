"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Category, Product } from "@/types/database";
import { categoryPath } from "@/lib/categories";
import { productTitle } from "@/lib/fields";
import { ListSkeleton } from "@/components/ui/Skeleton";
import Photo from "@/components/ui/Photo";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { IconArrowLeft, IconBox, IconRefresh, IconTrash, Spinner } from "@/components/ui/Icons";

const TRASH_DAYS = 30;

/** Papelera: productos eliminados en los últimos 30 días; se recuperan intactos o se borran definitivamente. */
export default function TrashPage() {
  const supabase = createClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [p, c] = await Promise.all([
      supabase.from("products").select("*").not("deleted_at", "is", null).order("deleted_at", { ascending: false }),
      supabase.from("categories").select("*"),
    ]);
    setItems((p.data ?? []) as Product[]);
    setCategories(c.data ?? []);
    setLoading(false);
  }, [supabase]);
  useEffect(() => {
    load();
  }, [load]);

  async function restore(p: Product) {
    const { error } = await supabase.from("products").update({ deleted_at: null }).eq("id", p.id);
    if (error) return toast("error", error.message);
    toast("success", `«${productTitle(p.data) || "Producto"}» recuperado`);
    setItems((l) => l.filter((x) => x.id !== p.id));
  }
  async function purgeOne(p: Product) {
    const ok = await confirm({ title: "¿Borrar para siempre?", body: `«${productTitle(p.data) || "Producto"}» y su foto se borran definitivamente. Esto no se puede deshacer.`, confirmLabel: "Borrar para siempre", tone: "danger" });
    if (!ok) return;
    if (p.image_url) {
      const i = p.image_url.indexOf("/product-images/");
      if (i >= 0) await supabase.storage.from("product-images").remove([p.image_url.slice(i + "/product-images/".length)]);
    }
    const { error } = await supabase.from("products").delete().eq("id", p.id);
    if (error) return toast("error", error.message);
    setItems((l) => l.filter((x) => x.id !== p.id));
  }
  async function emptyAll() {
    const ok = await confirm({
      title: "¿Vaciar la papelera?",
      body: "Se borran definitivamente, con sus fotos. Esto no se puede deshacer.",
      details: [{ label: "Productos que se borran", value: String(items.length), tone: "danger" }],
      confirmLabel: "Vaciar papelera",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    const res = await fetch("/api/cleanup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actions: ["emptyTrash"] }) });
    setBusy(false);
    if (!res.ok) return toast("error", "No se pudo vaciar la papelera");
    toast("success", "Papelera vacía");
    setItems([]);
  }

  const daysLeft = (p: Product) => Math.max(0, TRASH_DAYS - Math.floor((Date.now() - new Date(p.deleted_at!).getTime()) / 86400000));

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <header className="animate-in">
        <Link href="/dashboard#limpiar" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"><IconArrowLeft size={16} /> Ordenar y limpiar</Link>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink">Papelera</h1>
            <p className="text-sm text-slate-500">Lo eliminado se guarda {TRASH_DAYS} días. Recupéralo intacto o bórralo ya.</p>
          </div>
          {items.length > 0 && <button onClick={emptyAll} disabled={busy} className="btn-destructive btn-sm">{busy ? <Spinner size={14} /> : <IconTrash size={14} />} Vaciar papelera</button>}
        </div>
      </header>

      {loading ? (
        <ListSkeleton rows={3} />
      ) : items.length === 0 ? (
        <div className="animate-in card text-center">
          <p className="text-lg font-bold text-ink">La papelera está vacía</p>
          <p className="mt-1 text-sm text-slate-500">Al eliminar un producto del inventario, aparece aquí durante {TRASH_DAYS} días.</p>
        </div>
      ) : (
        <ul className="stagger space-y-2">
          {items.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-card ring-1 ring-slate-900/10">
              {p.image_url ? <Photo src={p.image_url} wrapperClassName="h-12 w-12 shrink-0 rounded-xl" className="h-12 w-12 object-cover" /> : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-400"><IconBox /></span>}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-ink">{productTitle(p.data) || "Sin nombre"}</span>
                <span className="block truncate text-xs text-slate-500">{categoryPath(categories, p.category_id) || "Sin categoría"} · se borra en {daysLeft(p)} día{daysLeft(p) === 1 ? "" : "s"}</span>
              </span>
              <button onClick={() => restore(p)} className="btn-success btn-sm"><IconRefresh size={14} /> Recuperar</button>
              <button onClick={() => purgeOne(p)} className="btn-ghost btn-sm text-rose-600" title="Borrar definitivamente"><IconTrash size={16} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
