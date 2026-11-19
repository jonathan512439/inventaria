"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { backupFileName, buildBackupWorkbook, type Fetcher } from "@/lib/backup";
import { useFlow } from "@/components/FlowProvider";
import { friendlyError } from "@/lib/errors";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { IconCheck, IconDownload, IconTrash, Spinner } from "@/components/ui/Icons";
import { businessDayKey } from "@/lib/dates";

type BackupFile = { name: string; size: number; when: string; kind: "auto" | "manual" };
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PAGE = 1000;

/**
 * Respaldos (antes /backup, ahora Ajustes › Mis datos): copias completas del negocio en un Excel, automáticas cada
 * sábado (se guardan 8) y a pedido. Solo el dueño (bucket privado, 024).
 */
export default function BackupCard() {
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
      if (error) throw error; // lo traduce friendlyError al mostrarlo
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
      toast("error", friendlyError(e, "No se pudo guardar el respaldo"));
    } finally {
      setBusy(null);
    }
  }
  async function downloadNow() {
    setBusy("download");
    try {
      const { XLSX, wb } = await build();
      XLSX.writeFile(wb, `${(flow.business?.name ?? "negocio").replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase()}-completo-${businessDayKey()}.xlsx`);
    } catch (e) {
      toast("error", friendlyError(e, "No se pudo generar el archivo"));
    } finally {
      setBusy(null);
    }
  }
  async function open(f: BackupFile) {
    if (!bid) return;
    const { data, error } = await supabase.storage.from("backups").createSignedUrl(`${bid}/${f.name}`, 120, { download: `${(flow.business?.name ?? "negocio").replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase()}-respaldo-${f.name}` });
    if (error || !data) return toast("error", friendlyError(error, "No se pudo descargar"));
    window.open(data.signedUrl, "_blank");
  }
  async function remove(f: BackupFile) {
    if (!bid) return;
    const ok = await confirm({ title: `¿Borrar el respaldo del ${fmtDay(f.when)}?`, body: "No afecta a tu inventario; solo se quita esta copia.", confirmLabel: "Borrar", tone: "danger" });
    if (!ok) return;
    const { error } = await supabase.storage.from("backups").remove([`${bid}/${f.name}`]);
    if (error) return toast("error", friendlyError(error));
    load();
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Una copia completa en Excel: inventario, ventas, clientes, deudas, entradas, conteos y caja. Cada sábado se guarda una sola (se conservan las últimas 8).</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={saveNow} disabled={!!busy} className="btn-primary min-h-[48px]">{busy === "save" ? <Spinner /> : <IconCheck size={18} />} Guardar respaldo ahora</button>
        <button type="button" onClick={downloadNow} disabled={!!busy} className="btn-secondary min-h-[48px]">{busy === "download" ? <Spinner /> : <IconDownload size={18} />} Descargar copia completa</button>
      </div>
      {files === null ? (
        <ListSkeleton rows={2} />
      ) : files.length === 0 ? (
        <p className="text-sm text-muted">Todavía no hay copias guardadas. La primera automática se guarda el próximo sábado.</p>
      ) : (
        <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto overscroll-contain rounded-2xl ring-1 ring-slate-900/10">
          {files.map((f) => (
            <li key={f.name} className="flex min-h-[56px] items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-ink">{fmtDay(f.when)}</span>
                <span className="block text-xs text-muted">{f.kind === "auto" ? "Automático" : "Guardado por ti"}{f.size ? ` · ${Math.max(1, Math.round(f.size / 1024))} KB` : ""}</span>
              </span>
              <button type="button" onClick={() => open(f)} className="btn-secondary btn-sm min-h-[44px]"><IconDownload size={14} /> Bajar</button>
              <button type="button" onClick={() => remove(f)} className="grid h-11 w-11 place-items-center rounded-full text-slate-400 hover:bg-danger-50 hover:text-danger-600" aria-label="Borrar respaldo"><IconTrash size={16} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function fmtDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
