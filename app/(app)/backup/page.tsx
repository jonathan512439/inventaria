"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { backupFileName, buildBackupWorkbook, type Fetcher } from "@/lib/backup";
import { useFlow } from "@/components/FlowProvider";
import CoachTip from "@/components/CoachTip";
import OwnerOnly from "@/components/OwnerOnly";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { IconArrowLeft, IconCheck, IconDownload, IconTrash, Spinner } from "@/components/ui/Icons";

type BackupFile = { name: string; size: number; when: string; kind: "auto" | "manual" };
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PAGE = 1000;

/** Respaldos: copias completas del negocio en un Excel (automáticas cada semana + a pedido), guardadas 8 semanas. */
export default function BackupPage() {
  const supabase = createClient();
  const toast = useToast();
  const confirm = useConfirm();
  const flow = useFlow();
  const [files, setFiles] = useState<BackupFile[] | null>(null);
  const [busy, setBusy] = useState<"save" | "download" | null>(null);
  const bid = flow.business?.id;

  const load = useCallback(async () => {
    if (!bid) return;
    const { data } = await supabase.storage.from("backups").list(bid, { limit: 100, sortBy: { column: "name", order: "desc" } });
    setFiles(
      (data ?? [])
        .filter((f) => f.name.endsWith(".xlsx"))
        .map((f) => ({ name: f.name, size: (f.metadata as { size?: number } | null)?.size ?? 0, when: f.name.slice(0, 10), kind: f.name.includes("-manual") ? "manual" : "auto" }))
    );
  }, [supabase, bid]);
  useEffect(() => {
    load();
  }, [load]);

  /** Todas las filas de una tabla (RLS ya filtra por negocio), de 1000 en 1000. */
  const fetcher: Fetcher = async (table) => {
    const out: Record<string, unknown>[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from(table as "products").select("*").range(from, from + PAGE - 1);
      if (error) throw new Error(`${table}: ${error.message}`);
      out.push(...((data ?? []) as Record<string, unknown>[]));
      if (!data || data.length < PAGE) break;
    }
    return out;
  };

  async function build() {
    const XLSX = await import("xlsx");
    const { wb } = await buildBackupWorkbook(XLSX, fetcher, flow.business?.name ?? "Mi negocio");
    return { XLSX, wb };
  }
  async function saveNow() {
    if (!bid) return;
    setBusy("save");
    try {
      const { XLSX, wb } = await build();
      const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
      const { error } = await supabase.storage.from("backups").upload(`${bid}/${backupFileName("manual")}`, new Blob([buf], { type: XLSX_MIME }), { contentType: XLSX_MIME, upsert: true });
      if (error) throw error;
      navigator.vibrate?.(20);
      toast("success", "Respaldo guardado. Queda disponible aquí durante las próximas semanas.");
      await load();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "No se pudo guardar el respaldo");
    } finally {
      setBusy(null);
    }
  }
  async function downloadNow() {
    setBusy("download");
    try {
      const { XLSX, wb } = await build();
      XLSX.writeFile(wb, `${(flow.business?.name ?? "negocio").replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase()}-completo-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "No se pudo generar el archivo");
    } finally {
      setBusy(null);
    }
  }
  async function open(f: BackupFile) {
    if (!bid) return;
    const { data, error } = await supabase.storage.from("backups").createSignedUrl(`${bid}/${f.name}`, 120, { download: `${(flow.business?.name ?? "negocio").replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase()}-respaldo-${f.name}` });
    if (error || !data) return toast("error", error?.message ?? "No se pudo descargar");
    window.open(data.signedUrl, "_blank");
  }
  async function remove(f: BackupFile) {
    if (!bid) return;
    const ok = await confirm({ title: `¿Borrar el respaldo del ${fmtDay(f.when)}?`, body: "No afecta a tu inventario; solo se quita esta copia.", confirmLabel: "Borrar", tone: "danger" });
    if (!ok) return;
    const { error } = await supabase.storage.from("backups").remove([`${bid}/${f.name}`]);
    if (error) return toast("error", error.message);
    load();
  }

  return (
    <OwnerOnly>
      <div className="mx-auto max-w-2xl space-y-4">
        <header className="animate-in">
          <Link href="/settings" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"><IconArrowLeft size={16} /> Ajustes</Link>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Respaldos</h1>
          <p className="text-sm text-slate-500">Una copia completa de tu negocio en un Excel: inventario, ventas, clientes, deudas, compras, conteos y caja.</p>
        </header>
        <CoachTip screen="backup" title="Tu tranquilidad, cada semana">
          Cada sábado por la noche se guarda una copia automática (se conservan las últimas 8). También puedes guardar una ahora o descargarla a tu celular. Para volver a cargar el inventario desde una copia, usa <b>Importar desde Excel</b>.
        </CoachTip>

        <section className="animate-in card grid gap-2 p-4 sm:grid-cols-2">
          <button onClick={saveNow} disabled={!!busy} className="btn-primary btn-lg">{busy === "save" ? <Spinner /> : <IconCheck size={18} />} Guardar respaldo ahora</button>
          <button onClick={downloadNow} disabled={!!busy} className="btn-secondary btn-lg">{busy === "download" ? <Spinner /> : <IconDownload size={18} />} Descargar copia completa</button>
          <p className="text-[11px] text-slate-500 sm:col-span-2">El envío automático por correo llega en la fase de lanzamiento.</p>
        </section>

        <section className="animate-in card p-4">
          <p className="mb-2 text-sm font-bold text-ink">Copias guardadas</p>
          {files === null ? (
            <ListSkeleton rows={3} />
          ) : files.length === 0 ? (
            <p className="text-sm text-slate-500">Todavía no hay copias. La primera automática se guarda el próximo sábado; si quieres una ya, toca «Guardar respaldo ahora».</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {files.map((f) => (
                <li key={f.name} className="flex items-center gap-2 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-ink">{fmtDay(f.when)}</span>
                    <span className="block text-xs text-slate-500">{f.kind === "auto" ? "Automático" : "Guardado por ti"}{f.size ? ` · ${Math.max(1, Math.round(f.size / 1024))} KB` : ""}</span>
                  </span>
                  <button onClick={() => open(f)} className="btn-secondary btn-sm"><IconDownload size={14} /> Descargar</button>
                  <button onClick={() => remove(f)} className="btn-ghost btn-sm text-rose-600" aria-label="Borrar"><IconTrash size={14} /></button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </OwnerOnly>
  );
}

function fmtDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
