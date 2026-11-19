"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { squareImage } from "@/lib/image";
import { friendlyError } from "@/lib/errors";
import { useFlow } from "@/components/FlowProvider";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import BusinessLogo from "@/components/ui/BusinessLogo";
import { IconCamera, Spinner } from "@/components/ui/Icons";

const BUCKET = "business-logos";

/**
 * Logo del negocio en Ajustes › Negocio (R9). Se recorta cuadrado y se achica a 256 px (WebP) en el celular;
 * se guarda como <negocio>/logo-<hora>.webp (nombre nuevo cada vez: los celulares no muestran el viejo guardado)
 * y se borra el anterior. Solo el dueño lo cambia (030).
 */
export default function LogoCard() {
  const supabase = createClient();
  const flow = useFlow();
  const toast = useToast();
  const ask = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const biz = flow.business;
  if (!biz) return null;

  const oldPath = (url: string | null | undefined) => (url ? url.split(`/${BUCKET}/`)[1]?.split("?")[0] ?? null : null);

  async function upload(file: File) {
    if (!biz) return;
    setBusy(true);
    try {
      const blob = await squareImage(file, 256);
      const ext = blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg";
      const path = `${biz.id}/logo-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, upsert: true });
      if (error) throw error;
      const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      const { error: e2 } = await supabase.from("businesses").update({ logo_url: url }).eq("id", biz.id);
      if (e2) throw e2;
      const prev = oldPath(biz.logo_url);
      if (prev) await supabase.storage.from(BUCKET).remove([prev]);
      toast("success", "Logo guardado");
      flow.refresh();
    } catch (e) {
      toast("error", friendlyError(e, "No se pudo guardar el logo"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    if (!biz?.logo_url) return;
    const ok = await ask({ title: "¿Quitar el logo?", body: "En su lugar se verá la inicial del negocio.", confirmLabel: "Quitar logo", tone: "danger" });
    if (!ok) return;
    setBusy(true);
    const { error } = await supabase.from("businesses").update({ logo_url: null }).eq("id", biz.id);
    const prev = oldPath(biz.logo_url);
    if (!error && prev) await supabase.storage.from(BUCKET).remove([prev]);
    setBusy(false);
    if (error) return toast("error", friendlyError(error));
    flow.refresh();
  }

  return (
    <div className="flex items-center gap-3">
      <BusinessLogo name={biz.name} url={biz.logo_url} size={64} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-sm font-semibold text-ink">Logo</p>
        {flow.isOwner ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => input.current?.click()} disabled={busy} className="btn-secondary min-h-[44px]">
              {busy ? <Spinner /> : <IconCamera size={18} />} {biz.logo_url ? "Cambiar" : "Subir logo"}
            </button>
            {biz.logo_url && <button type="button" onClick={remove} disabled={busy} className="btn-ghost min-h-[44px] text-danger-700">Quitar</button>}
            <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </div>
        ) : (
          <p className="text-xs text-muted">Lo cambia el dueño.</p>
        )}
        <p className="text-xs text-muted">Sale arriba en la app, en Inicio y en el ticket impreso.</p>
      </div>
    </div>
  );
}
