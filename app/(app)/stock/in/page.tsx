"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Product, ProductVariant, Purchase, Supplier } from "@/types/database";
import { currencyLabel, money, stockOf } from "@/lib/inventory";
import { productTitle } from "@/lib/fields";
import { bizKey } from "@/lib/offline";
import ProductFinder from "@/components/ProductFinder";
import { useFlow } from "@/components/FlowProvider";
import { EmptyState, ScreenHeader, Tabs } from "@/components/ui/Screen";
import { QtyStepper } from "@/components/ui/NumberPad";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { adjustStock, newOpId, registerPurchase } from "@/lib/data/ops";
import { friendlyError } from "@/lib/errors";
import { IconCheck, IconChevronRight, IconPlus, IconTrash, IconTruck, IconX, Spinner } from "@/components/ui/Icons";

interface Line {
  key: string;
  /** Id de la operación de esta línea (vendedor: una entrada por línea, idempotente) */
  opId: string;
  product: Product;
  variant: ProductVariant | null;
  qty: number;
  cost: string;
  expires: string;
}

type Tab = "new" | "history" | "suppliers";

/**
 * Entrada de mercadería (C7.5 · RECONSTRUCCION_VISUAL.md §3.2, F19 + F06 «sumar stock»): buscar o escanear lo que
 * llegó (cada lectura suma 1) y guardar. Proveedor, costo y vencimiento son opcionales y van plegados.
 *   · Dueño: una sola operación `register_purchase` (stock, costo, vencimiento, historial).
 *   · Vendedor: las compras son del dueño (024), así que se guarda como entrada de stock por línea (`adjust_stock`,
 *     cada una con su id: reintentar no suma dos veces) y el vencimiento en el producto.
 * La lista en curso se guarda en el teléfono hasta registrarla (salir sin querer no la pierde).
 */
export default function StockInPage() {
  const supabase = createClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { isOwner } = useFlow();
  const draftKey = bizKey("stock-in-draft");
  const [tab, setTab] = useState<Tab>("new");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[] | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [newSupplier, setNewSupplier] = useState<{ name: string; phone: string } | null>(null);
  const [doc, setDoc] = useState("");
  const [opId, setOpId] = useState(newOpId);
  const [lines, setLines] = useState<Line[]>([]);
  const [restored, setRestored] = useState(false);
  const [more, setMore] = useState(false);
  const [extra, setExtra] = useState(false);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Borrador en el teléfono
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw) as { lines?: Line[]; opId?: string; supplierId?: string; doc?: string };
        if (d.lines?.length) {
          setLines(d.lines);
          if (d.opId) setOpId(d.opId);
          setSupplierId(d.supplierId ?? "");
          setDoc(d.doc ?? "");
          if (d.lines.some((l) => l.cost || l.expires)) setExtra(true);
        }
      }
    } catch {
      /* sin almacenamiento: se trabaja igual */
    }
    setRestored(true);
  }, [draftKey]);
  useEffect(() => {
    if (!restored) return;
    try {
      if (lines.length) localStorage.setItem(draftKey, JSON.stringify({ lines, opId, supplierId, doc }));
      else localStorage.removeItem(draftKey);
    } catch {
      /* sin almacenamiento */
    }
  }, [restored, lines, opId, supplierId, doc, draftKey]);

  const loadOwner = useCallback(async () => {
    const [s, p] = await Promise.all([
      supabase.from("suppliers").select("*").order("name"),
      supabase.from("purchases").select("*").order("created_at", { ascending: false }).limit(30),
    ]);
    setSuppliers((s.data ?? []) as Supplier[]);
    setPurchases((p.data ?? []) as Purchase[]);
  }, [supabase]);
  useEffect(() => {
    if (isOwner) loadOwner();
  }, [isOwner, loadOwner]);

  /** Costo con el que se compró la última vez (solo el dueño lo puede leer). */
  async function lastCost(p: Product, v: ProductVariant | null): Promise<string> {
    if (!isOwner) return "";
    const { data } = await supabase.from("product_costs").select("variant_id,cost").eq("product_id", p.id);
    const row = (v && data?.find((c) => c.variant_id === v.id)) || data?.find((c) => !c.variant_id);
    return row ? String(Number(row.cost)) : "";
  }

  // Lista al día para saber si un producto ya está (las lecturas llegan una tras otra)
  const linesRef = useRef(lines);
  linesRef.current = lines;

  async function add(p: Product, v: ProductVariant | null) {
    const key = v ? v.id : p.id;
    setLastKey(key);
    setTimeout(() => setLastKey((k) => (k === key ? null : k)), 1200);
    if (linesRef.current.some((l) => l.key === key)) {
      // Ya estaba: +1 y la última leída queda arriba
      setLines((ls) => {
        const l = ls.find((x) => x.key === key);
        return l ? [{ ...l, qty: l.qty + 1 }, ...ls.filter((x) => x.key !== key)] : ls;
      });
      return;
    }
    const line: Line = { key, opId: newOpId(), product: p, variant: v, qty: 1, cost: "", expires: "" };
    linesRef.current = [line, ...linesRef.current];
    setLines((ls) => (ls.some((l) => l.key === key) ? ls : [line, ...ls]));
    const cost = await lastCost(p, v);
    if (cost) setLines((ls) => ls.map((l) => (l.key === key && !l.cost ? { ...l, cost } : l)));
  }

  const patch = (key: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const units = lines.reduce((s, l) => s + l.qty, 0);
  const total = useMemo(() => lines.reduce((s, l) => s + l.qty * (Number(l.cost.replace(",", ".")) || 0), 0), [lines]);

  async function discard() {
    const ok = await confirm({ title: "¿Vaciar la lista?", body: "Se quitan todos los productos de esta entrada. El stock no cambia.", confirmLabel: "Vaciar", tone: "danger" });
    if (ok) setLines([]);
  }

  async function save() {
    if (!lines.length) return;
    const proveedor = newSupplier?.name.trim() || suppliers.find((s) => s.id === supplierId)?.name;
    const ok = await confirm({
      title: "¿Guardamos la entrada?",
      body: "Se suma al stock lo que llegó.",
      details: [
        ...(isOwner ? [{ label: "Proveedor", value: proveedor || "Sin proveedor" }] : []),
        { label: "Productos", value: String(lines.length) },
        { label: "Unidades que entran", value: `+${units}`, tone: "ok" as const },
        ...(isOwner && total > 0 ? [{ label: "Total de la compra", value: money(total) }] : []),
      ],
      confirmLabel: "Sí, guardar",
      cancelLabel: "Revisar otra vez",
      tone: "success",
    });
    if (!ok) return;
    setSaving(true);
    if (isOwner) await saveAsPurchase();
    else await saveAsEntries();
    setSaving(false);
  }

  const uid = async () => (await supabase.auth.getUser()).data.user?.id ?? "";

  async function saveAsPurchase() {
    let supId = supplierId || null;
    if (newSupplier?.name.trim()) {
      const { data: s, error } = await supabase.from("suppliers").insert({ user_id: await uid(), name: newSupplier.name.trim(), phone: newSupplier.phone.trim() || null }).select().single();
      if (error) return toast("error", friendlyError(error));
      supId = (s as Supplier).id;
      // Si la compra falla y se reintenta, no se vuelve a crear el proveedor
      setSuppliers((list) => [...list, s as Supplier].sort((a, b) => a.name.localeCompare(b.name)));
      setSupplierId(supId);
      setNewSupplier(null);
    }
    try {
      await registerPurchase(supabase, {
        id: opId,
        supplierId: supId,
        doc: doc.trim() || null,
        lines: lines.map((l) => {
          const cost = l.cost.trim() === "" ? null : Number(l.cost.replace(",", "."));
          return { product_id: l.product.id, variant_id: l.variant?.id ?? null, qty: l.qty, unit_cost: cost !== null && Number.isFinite(cost) ? cost : null, expires_at: l.expires || null };
        }),
      });
    } catch (e) {
      return toast("error", friendlyError(e));
    }
    done(lines.length, units);
    loadOwner();
  }

  async function saveAsEntries() {
    const failed: Line[] = [];
    let firstError: unknown = null;
    for (const l of lines) {
      try {
        await adjustStock(supabase, { id: l.opId, productId: l.product.id, variantId: l.variant?.id ?? null, delta: l.qty, tipo: "entrada", motivo: "entrada de inventario" });
        if (l.expires) {
          const q = l.variant ? supabase.from("product_variants").update({ expires_at: l.expires }).eq("id", l.variant.id) : supabase.from("products").update({ expires_at: l.expires }).eq("id", l.product.id);
          // Si falla, la línea queda para reintentar: la entrada ya hecha no se repite (mismo id)
          const { error } = await q;
          if (error) throw error;
        }
      } catch (e) {
        failed.push(l);
        firstError ??= e;
      }
    }
    if (failed.length) {
      // Lo que entró ya no se repite (cada línea tiene su id); quedan solo las que fallaron
      setLines(failed);
      return toast("error", `${failed.length} producto${failed.length === 1 ? "" : "s"} no se guardaron: ${friendlyError(firstError)}`);
    }
    done(lines.length, units);
  }

  function done(n: number, u: number) {
    navigator.vibrate?.(30);
    toast("success", `Entrada guardada: +${u} unidad${u === 1 ? "" : "es"} en ${n} producto${n === 1 ? "" : "s"}`);
    setLines([]);
    setDoc("");
    setOpId(newOpId());
  }

  async function addSupplier(name: string, phone: string) {
    const { error } = await supabase.from("suppliers").insert({ user_id: await uid(), name: name.trim(), phone: phone.trim() || null });
    if (error) return toast("error", friendlyError(error));
    loadOwner();
  }
  async function removeSupplier(s: Supplier) {
    const ok = await confirm({ title: `¿Quitar a ${s.name}?`, body: "Las compras que ya registraste conservan su nombre; solo deja de aparecer en la lista.", confirmLabel: "Quitar proveedor", tone: "danger" });
    if (!ok) return;
    const { error } = await supabase.from("suppliers").delete().eq("id", s.id);
    if (error) return toast("error", friendlyError(error));
    loadOwner();
  }

  return (
    <div className={`${tab === "new" ? "has-action" : ""} mx-auto max-w-2xl space-y-4`}>
      <ScreenHeader
        title="Entrada de inventario"
        subtitle="Busca o escanea lo que llegó: cada lectura suma 1."
        back={{ href: "/products", label: "Productos" }}
        help={
          <>
            <p>Escanea cada unidad que llegó (o búscala por nombre). Si lees el mismo producto otra vez, suma 1. Ajusta la cantidad con − y +.</p>
            {isOwner ? (
              <p>En <b>Más datos</b> puedes anotar el proveedor, la factura, el costo y el vencimiento. El costo se usa para calcular tu ganancia. Nada de eso es obligatorio.</p>
            ) : (
              <p>En <b>Más datos</b> puedes anotar cuándo vence. El costo y el proveedor los anota el dueño.</p>
            )}
            <p>La lista queda guardada en este teléfono hasta que toques <b>Guardar entrada</b>.</p>
          </>
        }
      />

      {isOwner && (
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: "new", label: "Nueva entrada", count: lines.length || undefined },
            { value: "history", label: "Entradas" },
            { value: "suppliers", label: "Proveedores", count: suppliers.length || undefined },
          ]}
        />
      )}

      {tab === "new" && (
        <>
          <ProductFinder onPick={add} placeholder="Buscar o escanear lo que llegó…" />

          {lines.length === 0 ? (
            <EmptyState icon={<IconTruck size={28} />} title="Todavía no agregaste nada" body="Escanea o busca cada producto que llegó. Cada lectura suma 1." />
          ) : (
            <section className="animate-in card p-0">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
                <p className="text-sm font-bold text-ink">{lines.length} producto{lines.length === 1 ? "" : "s"} · +{units} unid.</p>
                <button type="button" onClick={discard} className="btn-ghost btn-sm min-h-[44px] text-danger-700">Vaciar</button>
              </div>
              <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto overscroll-contain">
                {lines.map((l) => {
                  const now = (l.variant ? l.variant.stock : stockOf(l.product)) ?? 0;
                  return (
                    <li key={l.key} className={`space-y-2 px-4 py-3 transition ${lastKey === l.key ? "bg-ok-50" : ""}`}>
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold text-ink">
                            {productTitle(l.product.data) || "Sin nombre"}
                            {l.variant ? <span className="text-violet-800"> · {l.variant.label}</span> : null}
                          </span>
                          <span className="block text-xs text-muted">
                            tenías {now} → quedarán <b className="text-ok-700">{now + l.qty}</b>
                          </span>
                        </span>
                        <QtyStepper value={l.qty} onChange={(n) => patch(l.key, { qty: n })} />
                        <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-danger-50 hover:text-danger-600" aria-label="Quitar de la lista">
                          <IconTrash size={18} />
                        </button>
                      </div>
                      {extra && (
                        <div className={`grid gap-2 ${isOwner ? "grid-cols-2" : "grid-cols-1"}`}>
                          {isOwner && (
                            <label className="text-xs font-semibold text-muted">
                              Costo por unidad ({currencyLabel()})
                              <input type="number" min={0} step="any" inputMode="decimal" className="input mt-0.5 min-h-[44px] text-center tabular-nums" value={l.cost} onChange={(e) => patch(l.key, { cost: e.target.value })} />
                            </label>
                          )}
                          <label className="text-xs font-semibold text-muted">
                            Vence
                            <input type="date" className="input mt-0.5 min-h-[44px]" value={l.expires} onChange={(e) => patch(l.key, { expires: e.target.value })} />
                          </label>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <section>
            <button type="button" onClick={() => setMore((v) => !v)} className="btn-disclosure">
              <span className="min-w-0 flex-1">
                <span className="block">Más datos (opcional)</span>
                <span className="block truncate text-xs font-normal text-muted">{isOwner ? "Proveedor, factura, costo y vencimiento" : "Vencimiento"}</span>
              </span>
              <IconChevronRight className={`shrink-0 text-brand-600 transition ${more ? "rotate-90" : ""}`} />
            </button>
            {more && (
              <div className="mt-2 space-y-3 rounded-2xl border-2 border-slate-200 p-4">
                {isOwner && (
                  <>
                    <div>
                      <label className="label" htmlFor="sup">Proveedor</label>
                      {newSupplier ? (
                        <div className="flex flex-wrap gap-2">
                          <input className="input min-w-0 flex-1" placeholder="Nombre" value={newSupplier.name} onChange={(e) => setNewSupplier({ ...newSupplier, name: e.target.value })} autoFocus />
                          <input className="input w-40" placeholder="Teléfono (WhatsApp)" inputMode="tel" value={newSupplier.phone} onChange={(e) => setNewSupplier({ ...newSupplier, phone: e.target.value })} />
                          <button type="button" onClick={() => setNewSupplier(null)} className="btn-ghost h-11 w-11 p-0" aria-label="Cancelar proveedor nuevo"><IconX size={18} /></button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <select id="sup" className="input min-h-[44px]" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                            <option value="">Sin proveedor</option>
                            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                          <button type="button" onClick={() => setNewSupplier({ name: "", phone: "" })} className="btn-secondary min-h-[44px] shrink-0"><IconPlus size={16} /> Nuevo</button>
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="label" htmlFor="doc">Nº de factura o nota</label>
                      <input id="doc" className="input min-h-[44px]" value={doc} onChange={(e) => setDoc(e.target.value)} />
                    </div>
                  </>
                )}
                <label className="flex min-h-[44px] items-center gap-3 text-sm font-semibold text-ink">
                  <input type="checkbox" className="h-5 w-5" checked={extra} onChange={(e) => setExtra(e.target.checked)} />
                  {isOwner ? "Anotar costo y vencimiento de cada producto" : "Anotar vencimiento de cada producto"}
                </label>
              </div>
            )}
          </section>

          <div className="sticky-action">
            <button type="button" onClick={save} disabled={saving || !lines.length} className="btn-success btn-lg mx-auto flex w-full max-w-2xl">
              {saving ? <Spinner /> : <IconCheck size={20} />} Guardar entrada · +{units} unid.{isOwner && total > 0 ? ` · ${money(total)}` : ""}
            </button>
          </div>
        </>
      )}

      {tab === "history" &&
        (purchases === null ? (
          <ListSkeleton rows={4} />
        ) : purchases.length === 0 ? (
          <EmptyState icon={<IconTruck size={28} />} title="Aún no hay entradas" body="Cuando guardes la primera, aparecerá aquí con su proveedor y total." />
        ) : (
          <ul className="stagger space-y-2">
            {purchases.map((p) => (
              <li key={p.id} className="flex min-h-[56px] items-center gap-3 rounded-2xl bg-white p-3 shadow-card ring-1 ring-slate-900/10">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink">
                    {p.supplier_name || "Sin proveedor"}
                    {p.doc ? <span className="text-xs font-normal text-muted"> · {p.doc}</span> : null}
                  </span>
                  <span className="block text-xs text-muted">
                    {new Date(p.created_at).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · {p.items} producto{p.items === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="font-bold tabular-nums text-ink">{money(Number(p.total))}</span>
              </li>
            ))}
          </ul>
        ))}

      {tab === "suppliers" && <SupplierList suppliers={suppliers} onAdd={addSupplier} onRemove={removeSupplier} />}
    </div>
  );
}

function SupplierList({ suppliers, onAdd, onRemove }: { suppliers: Supplier[]; onAdd: (name: string, phone: string) => void; onRemove: (s: Supplier) => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  return (
    <div className="animate-in space-y-3">
      <div className="card flex flex-wrap gap-2 p-3">
        <input className="input min-h-[44px] min-w-0 flex-1" placeholder="Nombre del proveedor" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input min-h-[44px] w-44" placeholder="Teléfono (WhatsApp)" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <button
          type="button"
          onClick={() => {
            if (!name.trim()) return;
            onAdd(name, phone);
            setName("");
            setPhone("");
          }}
          className="btn-primary min-h-[44px]"
        >
          <IconPlus size={16} /> Agregar
        </button>
      </div>
      {suppliers.length === 0 ? (
        <EmptyState title="Sin proveedores todavía" body="Agrégalos aquí o al anotar una entrada (Más datos → Proveedor)." />
      ) : (
        <ul className="divide-y divide-slate-100 rounded-2xl bg-white shadow-card ring-1 ring-slate-900/10">
          {suppliers.map((s) => (
            <li key={s.id} className="flex min-h-[56px] items-center gap-3 px-4 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-ink">{s.name}</span>
                {s.phone && <a href={`https://wa.me/${s.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="text-xs text-ok-700 underline">{s.phone}</a>}
              </span>
              <button type="button" onClick={() => onRemove(s)} className="grid h-11 w-11 place-items-center rounded-full text-slate-400 hover:bg-danger-50 hover:text-danger-600" aria-label={`Quitar a ${s.name}`}>
                <IconTrash size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
