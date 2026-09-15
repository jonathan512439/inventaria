"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Product, ProductVariant, Purchase, Supplier } from "@/types/database";
import { SUMMARY_COLS, fmtMoney, fromSummary, stockOf } from "@/lib/inventory";
import BarcodeCamera from "@/components/BarcodeCamera";
import CoachTip from "@/components/CoachTip";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { IconArrowLeft, IconCheck, IconPlus, IconSearch, IconTrash, IconX, Spinner } from "@/components/ui/Icons";

interface Line {
  key: string;
  product: Product;
  variant: ProductVariant | null;
  qty: string;
  cost: string; // costo unitario
  expires: string;
}

/** Compras: entrada de mercadería con proveedor y costo. Actualiza stock, precio de compra y vencimiento. */
export default function PurchasesPage() {
  const supabase = createClient();
  const toast = useToast();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"list" | "new" | "suppliers">("list");

  // Nueva compra
  const [supplierId, setSupplierId] = useState<string>("");
  const [newSupplier, setNewSupplier] = useState<{ name: string; phone: string } | null>(null);
  const [doc, setDoc] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [picking, setPicking] = useState<{ product: Product; variants: ProductVariant[] } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [s, p] = await Promise.all([
      supabase.from("suppliers").select("*").order("name"),
      supabase.from("purchases").select("*").order("created_at", { ascending: false }).limit(30),
    ]);
    setSuppliers((s.data ?? []) as Supplier[]);
    setPurchases((p.data ?? []) as Purchase[]);
    setLoading(false);
  }, [supabase]);
  useEffect(() => {
    load();
  }, [load]);

  // Búsqueda de productos para agregar líneas
  useEffect(() => {
    const term = q.trim().toLowerCase();
    if (!term) return setResults([]);
    const t = setTimeout(async () => {
      const { data } = await supabase.from("product_summaries").select(SUMMARY_COLS).eq("status", "confirmed").ilike("search", `%${term.replace(/[%_]/g, "")}%`).limit(8);
      setResults((data ?? []).map(fromSummary));
    }, 200);
    return () => clearTimeout(t);
  }, [q, supabase]);

  async function pick(p: Product, variant?: ProductVariant | null) {
    if (variant === undefined) {
      const { data: vs } = await supabase.from("product_variants").select("*").eq("product_id", p.id).order("created_at");
      if (vs?.length) return setPicking({ product: p, variants: vs as ProductVariant[] });
      variant = null;
    }
    const key = variant ? variant.id : p.id;
    if (lines.some((l) => l.key === key)) {
      setLines((ls) => ls.map((l) => (l.key === key ? { ...l, qty: String((parseInt(l.qty, 10) || 0) + 1) } : l)));
    } else {
      const cost = variant?.costo ?? p.data.precio_compra;
      setLines((ls) => [...ls, { key, product: p, variant: variant ?? null, qty: "1", cost: cost === null || cost === undefined ? "" : String(cost), expires: "" }]);
    }
    setPicking(null);
    setQ("");
    setResults([]);
  }

  async function onCode(code: string) {
    const res = await fetch(`/api/barcode?code=${encodeURIComponent(code)}`);
    const json = (await res.json().catch(() => ({}))) as { found?: string; product?: Product; variant?: ProductVariant | null; variants?: ProductVariant[] };
    if (json.found !== "own" || !json.product) return toast("info", `Código ${code}: no está en tu inventario`);
    if (json.variant) return pick(json.product, json.variant);
    if (json.variants?.length) return setPicking({ product: json.product, variants: json.variants });
    pick(json.product, null);
  }

  const total = useMemo(() => lines.reduce((s, l) => s + (parseInt(l.qty, 10) || 0) * (Number(l.cost.replace(",", ".")) || 0), 0), [lines]);

  async function save() {
    if (!lines.length) return;
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    let supId = supplierId || null;
    let supName = suppliers.find((s) => s.id === supplierId)?.name ?? null;
    if (newSupplier?.name.trim()) {
      const { data: s, error } = await supabase.from("suppliers").insert({ user_id: user!.id, name: newSupplier.name.trim(), phone: newSupplier.phone.trim() || null }).select().single();
      if (error) {
        setSaving(false);
        return toast("error", error.message);
      }
      supId = s.id;
      supName = s.name;
    }
    const items = lines.filter((l) => (parseInt(l.qty, 10) || 0) > 0);
    const { data: purchase, error } = await supabase
      .from("purchases")
      .insert({ user_id: user!.id, supplier_id: supId, supplier_name: supName, doc: doc.trim() || null, total: Math.round(total * 100) / 100, items: items.length })
      .select()
      .single();
    if (error || !purchase) {
      setSaving(false);
      return toast("error", error?.message ?? "No se pudo guardar la compra");
    }
    for (const l of items) {
      const qty = parseInt(l.qty, 10) || 0;
      const cost = l.cost.trim() === "" ? null : Number(l.cost.replace(",", "."));
      const expires = l.expires || null;
      await supabase.from("purchase_items").insert({ purchase_id: purchase.id, user_id: user!.id, product_id: l.product.id, variant_id: l.variant?.id ?? null, product_name: String(l.product.data.nombre || ""), variant_label: l.variant?.label ?? null, qty, unit_cost: Number.isFinite(cost as number) ? cost : null, expires_at: expires });
      let resultante = 0;
      if (l.variant) {
        const { data: v } = await supabase.from("product_variants").select("stock,costo").eq("id", l.variant.id).single();
        resultante = (v?.stock ?? 0) + qty;
        await supabase.from("product_variants").update({ stock: resultante, ...(cost !== null && Number.isFinite(cost) ? { costo: cost } : {}), ...(expires ? { expires_at: expires } : {}) }).eq("id", l.variant.id);
      }
      // Producto: stock (si no tiene variantes), precio de compra y vencimiento
      const { data: p } = await supabase.from("products").select("data,expires_at").eq("id", l.product.id).single();
      if (p) {
        const keys = Object.keys(p.data);
        const key = ["stock", "cantidad", "existencias"].map((k) => keys.find((x) => x.toLowerCase() === k)).find(Boolean) ?? "stock";
        const data = { ...p.data };
        if (!l.variant) {
          resultante = (Number(p.data[key] ?? 0) || 0) + qty;
          data[key] = resultante;
        }
        if (cost !== null && Number.isFinite(cost)) {
          const old = p.data.precio_compra === null || p.data.precio_compra === undefined || p.data.precio_compra === "" ? null : Number(p.data.precio_compra);
          if (old !== cost) {
            data.precio_compra = cost;
            await supabase.from("price_history").insert({ user_id: user!.id, product_id: l.product.id, variant_id: l.variant?.id ?? null, field: "precio_compra", old_value: old, new_value: cost, source: "compra" });
          }
        }
        await supabase.from("products").update({ data, ...(expires && !l.variant ? { expires_at: expires } : {}) }).eq("id", l.product.id);
      }
      await supabase.from("stock_movements").insert({
        user_id: user!.id,
        product_id: l.product.id,
        product_name: String(l.product.data.nombre || ""),
        variant_id: l.variant?.id ?? null,
        variant_label: l.variant?.label ?? null,
        tipo: "entrada",
        cantidad: qty,
        precio_unitario: Number.isFinite(cost as number) ? cost : null,
        motivo: supName ? `compra · ${supName}` : "compra",
        stock_resultante: resultante,
        purchase_id: purchase.id,
      });
    }
    setSaving(false);
    navigator.vibrate?.(30);
    toast("success", `Compra registrada: ${items.length} producto${items.length === 1 ? "" : "s"} · Bs ${fmtMoney(total)}`);
    setLines([]);
    setDoc("");
    setNewSupplier(null);
    setMode("list");
    load();
  }

  async function addSupplier(name: string, phone: string) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from("suppliers").insert({ user_id: user!.id, name: name.trim(), phone: phone.trim() || null });
    if (error) return toast("error", error.message);
    load();
  }
  async function removeSupplier(s: Supplier) {
    if (!confirm(`¿Quitar al proveedor «${s.name}»? Las compras anteriores conservan su nombre.`)) return;
    await supabase.from("suppliers").delete().eq("id", s.id);
    load();
  }

  if (mode === "new") {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <header className="animate-in">
          <button onClick={() => (lines.length && !confirm("¿Salir sin guardar la compra?") ? null : setMode("list"))} className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"><IconArrowLeft size={16} /> Compras</button>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Nueva compra</h1>
          <p className="text-sm text-slate-500">Llegó mercadería: suma el stock, guarda el costo y el vencimiento.</p>
        </header>

        <section className="animate-in card space-y-3 p-4">
          <div>
            <label className="label" htmlFor="sup">Proveedor</label>
            {newSupplier ? (
              <div className="flex flex-wrap gap-2">
                <input className="input flex-1" placeholder="Nombre" value={newSupplier.name} onChange={(e) => setNewSupplier({ ...newSupplier, name: e.target.value })} autoFocus />
                <input className="input w-40" placeholder="Teléfono (WhatsApp)" inputMode="tel" value={newSupplier.phone} onChange={(e) => setNewSupplier({ ...newSupplier, phone: e.target.value })} />
                <button onClick={() => setNewSupplier(null)} className="btn-ghost btn-sm"><IconX size={16} /></button>
              </div>
            ) : (
              <div className="flex gap-2">
                <select id="sup" className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">Sin proveedor</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <button onClick={() => setNewSupplier({ name: "", phone: "" })} className="btn-secondary shrink-0"><IconPlus size={16} /> Nuevo</button>
              </div>
            )}
          </div>
          <div>
            <label className="label" htmlFor="doc">Nº de factura o nota (opcional)</label>
            <input id="doc" className="input" value={doc} onChange={(e) => setDoc(e.target.value)} />
          </div>
        </section>

        <section className="animate-in card space-y-3 p-4">
          <p className="text-sm font-bold text-ink">Productos que llegaron</p>
          <div className="relative">
            <IconSearch size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-11" placeholder="Buscar producto por nombre, marca o código…" value={q} onChange={(e) => setQ(e.target.value)} />
            {results.length > 0 && (
              <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-2xl bg-white p-1 shadow-2xl ring-1 ring-slate-900/10">
                {results.map((p) => (
                  <li key={p.id}>
                    <button onClick={() => pick(p)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-brand-50">
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{String(p.data.nombre || "Sin nombre")}</span>
                      <span className="text-xs text-slate-500">stock {stockOf(p) ?? 0}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <BarcodeCamera onCode={onCode} label="Escanear para agregar (+1 por lectura)" />

          {picking && (
            <div className="rounded-2xl bg-violet-50 p-3">
              <p className="text-xs font-semibold text-violet-900">{String(picking.product.data.nombre || "")} · ¿qué variante llegó?</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {picking.variants.map((v) => (
                  <button key={v.id} onClick={() => pick(picking.product, v)} className="rounded-full border-2 border-violet-300 bg-white px-3 py-1 text-sm font-semibold text-violet-800">{v.label} <span className="opacity-60">{v.stock}</span></button>
                ))}
                <button onClick={() => setPicking(null)} className="btn-ghost btn-sm"><IconX size={14} /></button>
              </div>
            </div>
          )}

          {lines.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-500">Busca o escanea los productos que llegaron.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {lines.map((l) => (
                <li key={l.key} className="space-y-2 py-3">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-ink">{String(l.product.data.nombre || "Sin nombre")}{l.variant ? <span className="text-violet-800"> · {l.variant.label}</span> : null}</span>
                      <span className="block text-xs text-slate-500">stock actual {l.variant ? l.variant.stock : stockOf(l.product) ?? 0}</span>
                    </span>
                    <button onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="rounded-full p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600"><IconTrash size={16} /></button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <label className="text-[11px] font-semibold uppercase text-slate-500">
                      Cantidad
                      <input type="number" min={1} inputMode="numeric" className="input mt-0.5 py-1.5 text-center font-bold tabular-nums" value={l.qty} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: e.target.value } : x)))} />
                    </label>
                    <label className="text-[11px] font-semibold uppercase text-slate-500">
                      Costo unit. (Bs)
                      <input type="number" min={0} step="any" inputMode="decimal" className="input mt-0.5 py-1.5 text-center tabular-nums" value={l.cost} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, cost: e.target.value } : x)))} />
                    </label>
                    <label className="text-[11px] font-semibold uppercase text-slate-500">
                      Vence
                      <input type="date" className="input mt-0.5 py-1.5 text-xs" value={l.expires} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, expires: e.target.value } : x)))} />
                    </label>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="sticky-action">
          <button onClick={save} disabled={saving || !lines.length} className="btn-success btn-lg w-full">
            {saving ? <Spinner /> : <IconCheck size={20} />} Registrar compra · {lines.reduce((s, l) => s + (parseInt(l.qty, 10) || 0), 0)} unid. · Bs {fmtMoney(total)}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <header className="animate-in">
        <Link href="/products" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"><IconArrowLeft size={16} /> Mi inventario</Link>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink">Compras y proveedores</h1>
            <p className="text-sm text-slate-500">Cada compra suma stock y guarda el costo real. Con eso la ganancia deja de ser estimada.</p>
          </div>
          <button onClick={() => setMode("new")} className="btn-primary"><IconPlus size={18} /> Nueva compra</button>
        </div>
      </header>
      <CoachTip screen="purchases" title="¿Llegó mercadería?">
        Toca <b>Nueva compra</b>, elige el proveedor, busca o escanea cada producto y escribe cantidad y costo. El stock sube solo y el costo queda guardado para calcular la ganancia.
      </CoachTip>

      <div className="animate-in grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
        <button onClick={() => setMode("list")} className={`rounded-xl px-2 py-2 text-sm font-semibold ${mode === "list" ? "bg-white text-ink shadow" : "text-slate-500"}`}>Compras</button>
        <button onClick={() => setMode("suppliers")} className={`rounded-xl px-2 py-2 text-sm font-semibold ${mode === "suppliers" ? "bg-white text-ink shadow" : "text-slate-500"}`}>Proveedores ({suppliers.length})</button>
      </div>

      {loading ? (
        <ListSkeleton rows={4} />
      ) : mode === "suppliers" ? (
        <SupplierList suppliers={suppliers} onAdd={addSupplier} onRemove={removeSupplier} />
      ) : purchases.length === 0 ? (
        <div className="animate-in card text-center">
          <p className="text-lg font-bold text-ink">Aún no hay compras</p>
          <p className="mt-1 text-sm text-slate-500">Registra la próxima entrada de mercadería con <b>Nueva compra</b>.</p>
        </div>
      ) : (
        <ul className="stagger space-y-2">
          {purchases.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-card ring-1 ring-slate-900/10">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-ink">{p.supplier_name || "Sin proveedor"}{p.doc ? <span className="text-xs font-normal text-slate-500"> · {p.doc}</span> : null}</span>
                <span className="block text-xs text-slate-500">{new Date(p.created_at).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · {p.items} producto{p.items === 1 ? "" : "s"}</span>
              </span>
              <span className="font-bold tabular-nums text-ink">Bs {fmtMoney(Number(p.total))}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SupplierList({ suppliers, onAdd, onRemove }: { suppliers: Supplier[]; onAdd: (name: string, phone: string) => void; onRemove: (s: Supplier) => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  return (
    <div className="animate-in space-y-3">
      <div className="card flex flex-wrap gap-2 p-3">
        <input className="input flex-1" placeholder="Nombre del proveedor" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input w-44" placeholder="Teléfono (WhatsApp)" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <button
          onClick={() => {
            if (!name.trim()) return;
            onAdd(name, phone);
            setName("");
            setPhone("");
          }}
          className="btn-primary"
        >
          <IconPlus size={16} /> Agregar
        </button>
      </div>
      {suppliers.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500">Sin proveedores todavía.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-2xl bg-white shadow-card ring-1 ring-slate-900/10">
          {suppliers.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-ink">{s.name}</span>
                {s.phone && <a href={`https://wa.me/${s.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="text-xs text-emerald-700 underline">{s.phone}</a>}
              </span>
              <button onClick={() => onRemove(s)} className="rounded-full p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600"><IconTrash size={16} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
