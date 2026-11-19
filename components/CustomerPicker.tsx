"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Customer } from "@/types/database";
import { money } from "@/lib/inventory";
import { useToast } from "./ui/Toast";
import { IconPlus, IconSearch, IconUsers, IconX, Spinner } from "./ui/Icons";
import { friendlyError } from "@/lib/errors";

interface Props {
  value: Customer | null;
  onChange: (c: Customer | null) => void;
  /** Texto del enlace cuando el cliente es opcional */
  placeholder?: string;
  /** Fiado o pago parcial: hay que elegir quién debe (la tarjeta se muestra abierta, sin toques de más) */
  required?: boolean;
  /** Cuánto queda debiendo (para el título de la tarjeta) */
  owes?: number;
}

/**
 * Elegir o crear un cliente (R7). Dos formas:
 * - **Obligatorio** (queda debiendo): tarjeta ámbar «¿Quién queda debiendo?» ya abierta, con buscador y un botón
 *   grande «+ Cliente nuevo» siempre a la vista (solo el nombre es obligatorio).
 * - **Opcional**: un enlace plegado «Agregar cliente (opcional)».
 */
export default function CustomerPicker({ value, onChange, placeholder = "Agregar cliente (opcional)", required, owes }: Props) {
  const supabase = createClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [list, setList] = useState<Customer[]>([]);
  const [creating, setCreating] = useState<{ name: string; phone: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const showSearch = !value && (open || !!required);

  useEffect(() => {
    if (!showSearch) return;
    const term = q.trim().replace(/[%_,]/g, "");
    const t = setTimeout(async () => {
      let query = supabase.from("customers").select("*").is("deleted_at", null).order("name").limit(8);
      if (term) query = query.or(`name.ilike.%${term}%,phone.ilike.%${term}%`);
      const { data } = await query;
      setList((data ?? []) as Customer[]);
    }, 150);
    return () => clearTimeout(t);
  }, [q, showSearch, supabase]);

  function pick(c: Customer | null) {
    onChange(c);
    setOpen(false);
    setQ("");
    setCreating(null);
  }

  async function create() {
    if (!creating?.name.trim()) return;
    setBusy(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error } = await supabase.from("customers").insert({ user_id: user!.id, name: creating.name.trim(), phone: creating.phone.trim() || null }).select().single();
    setBusy(false);
    if (error) return toast("error", friendlyError(error));
    pick(data as Customer);
  }

  const title = required ? `¿Quién queda debiendo${owes ? ` ${money(owes)}` : ""}?` : "Cliente";

  // Elegido
  if (value) {
    return (
      <div className={`space-y-1 rounded-2xl border-2 p-3 ${required ? "border-warn-300 bg-warn-50" : "border-brand-200 bg-brand-50"}`}>
        <p className="text-xs font-bold uppercase tracking-wide text-muted">{required ? "Queda debiendo" : "Cliente"}</p>
        <div className="flex items-center gap-2">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-600 text-base font-bold text-white">{value.name.slice(0, 1).toUpperCase()}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-semibold text-ink">{value.name}</span>
            {value.phone && <span className="block text-xs text-muted">{value.phone}</span>}
          </span>
          <button type="button" onClick={() => pick(null)} className="btn-ghost min-h-[44px] text-sm" aria-label="Cambiar cliente">Cambiar</button>
        </div>
      </div>
    );
  }

  // Opcional y plegado
  if (!showSearch) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex min-h-[44px] w-full items-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 px-3 text-left text-sm font-semibold text-slate-600 hover:bg-slate-50">
        <IconUsers size={18} /> {placeholder}
      </button>
    );
  }

  return (
    <div className={`space-y-2 rounded-2xl border-2 p-3 ${required ? "border-warn-400 bg-warn-50" : "border-brand-300 bg-white"}`}>
      <div className="flex items-center justify-between gap-2">
        <p className={`text-base font-bold ${required ? "text-warn-900" : "text-ink"}`}>{creating ? "Cliente nuevo" : title}</p>
        {!required && !creating && (
          <button type="button" onClick={() => setOpen(false)} className="grid h-11 w-11 place-items-center rounded-full text-muted hover:bg-slate-100" aria-label="Cerrar"><IconX size={18} /></button>
        )}
      </div>

      {creating ? (
        <div className="space-y-2">
          <label className="block">
            <span className="label">Nombre</span>
            <input className="input min-h-[48px]" placeholder="Ej.: Juana Pérez" value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} autoFocus onKeyDown={(e) => e.key === "Enter" && create()} />
          </label>
          <label className="block">
            <span className="label">Teléfono o WhatsApp (opcional)</span>
            <input className="input min-h-[48px]" placeholder="Para recordarle lo que debe" inputMode="tel" value={creating.phone} onChange={(e) => setCreating({ ...creating, phone: e.target.value })} onKeyDown={(e) => e.key === "Enter" && create()} />
          </label>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <button type="button" onClick={create} disabled={busy || !creating.name.trim()} className="btn-primary min-h-[48px]">{busy ? <Spinner /> : <IconPlus size={18} />} Guardar cliente</button>
            <button type="button" onClick={() => setCreating(null)} className="btn-ghost min-h-[48px]">Volver</button>
          </div>
        </div>
      ) : (
        <>
          <button type="button" onClick={() => setCreating({ name: q.trim(), phone: "" })} className="btn-primary min-h-[48px] w-full">
            <IconPlus size={18} /> {q.trim() ? `Cliente nuevo: «${q.trim()}»` : "Cliente nuevo"}
          </button>
          <div className="relative">
            <IconSearch size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input min-h-[48px] pl-10" placeholder="O busca uno que ya tienes…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar cliente" />
          </div>
          {list.length > 0 && (
            <ul className="max-h-56 space-y-1 overflow-y-auto overscroll-contain">
              {list.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => pick(c)} className="flex min-h-[48px] w-full items-center gap-2 rounded-xl bg-white px-3 py-2 text-left ring-1 ring-slate-200 hover:bg-brand-50">
                    <span className="min-w-0 flex-1 truncate text-base font-semibold text-ink">{c.name}</span>
                    {c.phone && <span className="text-xs text-muted">{c.phone}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {q.trim() && list.length === 0 && <p className="text-xs text-muted">No hay clientes con «{q.trim()}». Créalo con el botón de arriba.</p>}
        </>
      )}
    </div>
  );
}
