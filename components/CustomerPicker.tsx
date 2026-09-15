"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Customer } from "@/types/database";
import { useToast } from "./ui/Toast";
import { IconPlus, IconSearch, IconX, Spinner } from "./ui/Icons";

interface Props {
  value: Customer | null;
  onChange: (c: Customer | null) => void;
  /** Texto cuando no hay cliente elegido */
  placeholder?: string;
  required?: boolean;
}

/** Elegir (o crear en 5 segundos) un cliente. Opcional salvo que la pantalla lo pida. */
export default function CustomerPicker({ value, onChange, placeholder = "Sin cliente (venta común)", required }: Props) {
  const supabase = createClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [list, setList] = useState<Customer[]>([]);
  const [creating, setCreating] = useState<{ name: string; phone: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const term = q.trim().replace(/[%_,]/g, "");
    const t = setTimeout(async () => {
      let query = supabase.from("customers").select("*").is("deleted_at", null).order("name").limit(8);
      if (term) query = query.or(`name.ilike.%${term}%,phone.ilike.%${term}%`);
      const { data } = await query;
      setList((data ?? []) as Customer[]);
    }, 150);
    return () => clearTimeout(t);
  }, [q, open, supabase]);

  async function create() {
    if (!creating?.name.trim()) return;
    setBusy(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error } = await supabase.from("customers").insert({ user_id: user!.id, name: creating.name.trim(), phone: creating.phone.trim() || null }).select().single();
    setBusy(false);
    if (error) return toast("error", error.message);
    onChange(data as Customer);
    setCreating(null);
    setOpen(false);
    setQ("");
  }

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border-2 border-brand-200 bg-brand-50 px-3 py-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-600 text-sm font-bold text-white">{value.name.slice(0, 1).toUpperCase()}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">{value.name}</span>
          {value.phone && <span className="block text-xs text-slate-500">{value.phone}</span>}
        </span>
        <button type="button" onClick={() => onChange(null)} className="btn-ghost btn-sm" aria-label="Quitar cliente"><IconX size={16} /></button>
      </div>
    );
  }

  return (
    <div>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className={`flex w-full items-center gap-2 rounded-2xl border-2 border-dashed px-3 py-2 text-left text-sm ${required ? "border-amber-400 bg-amber-50 text-amber-900" : "border-slate-300 text-slate-600"}`}>
          <IconSearch size={16} /> {required ? "Elige o crea el cliente" : placeholder}
        </button>
      ) : (
        <div className="rounded-2xl border-2 border-brand-300 bg-white p-2">
          {creating ? (
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <input className="input py-1.5" placeholder="Nombre" value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} autoFocus onKeyDown={(e) => e.key === "Enter" && create()} />
              <input className="input py-1.5" placeholder="Teléfono (WhatsApp)" inputMode="tel" value={creating.phone} onChange={(e) => setCreating({ ...creating, phone: e.target.value })} onKeyDown={(e) => e.key === "Enter" && create()} />
              <div className="flex gap-1">
                <button type="button" onClick={create} disabled={busy || !creating.name.trim()} className="btn-primary btn-sm">{busy ? <Spinner size={14} /> : "Crear"}</button>
                <button type="button" onClick={() => setCreating(null)} className="btn-ghost btn-sm"><IconX size={14} /></button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex gap-1">
                <input className="input py-1.5" placeholder="Buscar cliente…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
                <button type="button" onClick={() => setOpen(false)} className="btn-ghost btn-sm"><IconX size={16} /></button>
              </div>
              <ul className="mt-1 max-h-48 overflow-y-auto">
                {list.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(c);
                        setOpen(false);
                        setQ("");
                      }}
                      className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm hover:bg-brand-50"
                    >
                      <span className="min-w-0 flex-1 truncate font-medium text-ink">{c.name}</span>
                      {c.phone && <span className="text-xs text-slate-400">{c.phone}</span>}
                    </button>
                  </li>
                ))}
                <li>
                  <button type="button" onClick={() => setCreating({ name: q.trim(), phone: "" })} className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm font-semibold text-brand-700 hover:bg-brand-50">
                    <IconPlus size={14} /> {q.trim() ? `Crear «${q.trim()}»` : "Crear cliente nuevo"}
                  </button>
                </li>
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
