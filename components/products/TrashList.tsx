"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient, actorHeaders } from "@/lib/supabase/client";
import type { Category, Product } from "@/types/database";
import { categoryPath } from "@/lib/categories";
import { productTitle } from "@/lib/fields";
import { storagePath } from "@/lib/photos";
import { friendlyError } from "@/lib/errors";
import { useFlow } from "@/components/FlowProvider";
import { ListSkeleton } from "@/components/ui/Skeleton";
import Photo from "@/components/ui/Photo";
import { EmptyState } from "@/components/ui/Screen";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { IconBox, IconRefresh, IconTrash, Spinner } from "@/components/ui/Icons";

const TRASH_DAYS = 30;

/** Papelera (antes /trash): lo eliminado en los últimos 30 días; se recupera intacto o se borra para siempre. */
export default function TrashList({ categories, onRestored }: { categories: Category[]; onRestored: () => void }) {
  const supabase = createClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { isOwner } = useFlow();
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("products").select("*").not("deleted_at", "is", null).order("deleted_at", { ascending: false });
    setItems((data ?? []) as Product[]);
    setLoading(false);
  }, [supabase]);
  useEffect(() => {
    load();
  }, [load]);

  async function restore(p: Product) {
    const { error } = await supabase.from("products").update({ deleted_at: null }).eq("id", p.id);
    if (error) return toast("error", friendlyError(error));
    toast("success", `«${productTitle(p.data) || "Producto"}» recuperado`);
    setItems((l) => l.filter((x) => x.id !== p.id));
    onRestored();
  }
  async function purgeOne(p: Product) {
    const ok = await confirm({ title: "¿Borrar para siempre?", body: `«${productTitle(p.data) || "Producto"}» y su foto se borran definitivamente. Esto no se puede deshacer.`, confirmLabel: "Borrar para siempre", tone: "danger" });
    if (!ok) return;
    const { error } = await supabase.from("products").delete().eq("id", p.id);
    if (error) return toast("error", friendlyError(error));
    const path = storagePath(p.image_url);
    if (path) await supabase.storage.from("product-images").remove([path]);
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
    const res = await fetch("/api/cleanup", { method: "POST", headers: { "Content-Type": "application/json", ...actorHeaders() }, body: JSON.stringify({ actions: ["emptyTrash"] }) });
    setBusy(false);
    if (!res.ok) return toast("error", "No se pudo vaciar la papelera");
    toast("success", "Papelera vacía");
    setItems([]);
  }

  const daysLeft = (p: Product) => Math.max(0, TRASH_DAYS - Math.floor((Date.now() - new Date(p.deleted_at!).getTime()) / 86400000));

  if (loading) return <ListSkeleton rows={3} />;
  if (!items.length) return <EmptyState icon={<IconTrash size={24} />} title="La papelera está vacía" body={`Al enviar un producto a la papelera, queda aquí ${TRASH_DAYS} días por si lo quieres recuperar.`} />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-sm text-muted">Se guardan {TRASH_DAYS} días. Recupéralos intactos o bórralos ya.</p>
        {isOwner && <button onClick={emptyAll} disabled={busy} className="btn-destructive btn-sm">{busy ? <Spinner size={14} /> : <IconTrash size={14} />} Vaciar papelera</button>}
      </div>
      <ul className="stagger space-y-2">
        {items.map((p) => (
          <li key={p.id} className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-card ring-1 ring-slate-900/10">
            {p.image_url ? <Photo src={p.image_url} wrapperClassName="h-12 w-12 shrink-0 rounded-xl" className="h-12 w-12 object-cover" /> : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-400"><IconBox /></span>}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-ink">{productTitle(p.data) || "Sin nombre"}</span>
              <span className="block truncate text-xs text-muted">{categoryPath(categories, p.category_id) || "Sin categoría"} · se borra en {daysLeft(p)} día{daysLeft(p) === 1 ? "" : "s"}</span>
            </span>
            <button onClick={() => restore(p)} className="btn-success btn-sm min-h-[44px]"><IconRefresh size={14} /> Recuperar</button>
            {isOwner && <button onClick={() => purgeOne(p)} className="btn-ghost btn-sm h-11 w-11 p-0 text-danger-700" aria-label="Borrar definitivamente"><IconTrash size={16} /></button>}
          </li>
        ))}
      </ul>
    </div>
  );
}
