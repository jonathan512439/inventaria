"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Consignment, ConsignmentItem, Customer, PayMethod, Product, ProductVariant } from "@/types/database";
import { SUMMARY_COLS, fmtMoney, fromSummary, stockOf } from "@/lib/inventory";
import { productTitle } from "@/lib/fields";
import { METHOD_LABEL, registerSale, suggestedPrice, type CartLine } from "@/lib/sales";
import CustomerPicker from "@/components/CustomerPicker";
import BarcodeCamera from "@/components/BarcodeCamera";
import CoachTip from "@/components/CoachTip";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { IconArrowLeft, IconCheck, IconChevronRight, IconPlus, IconSearch, IconTrash, IconX, Spinner } from "@/components/ui/Icons";

interface Line {
  key: string;
  product: Product;
  variant: ProductVariant | null;
  qty: string;
  price: string;
}

/**
 * Entregas en consignación: mercadería que sigue siendo tuya en manos de un revendedor.
 * Al entregar, sale del estante; al liquidar, lo vendido se cobra (o se fía) y lo devuelto vuelve al estante.
 */
export default function ConsignPage() {
  const supabase = createClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [mode, setMode] = useState<"list" | "new">("list");
  const [open, setOpen] = useState<Consignment[]>([]);
  const [closed, setClosed] = useState<Consignment[]>([]);
  const [items, setItems] = useState<ConsignmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  // Nueva entrega
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [picking, setPicking] = useState<{ product: Product; variants: ProductVariant[] } | null>(null);
  const [saving, setSaving] = useState(false);
  // Liquidación
  const [settle, setSettle] = useState<{ cons: Consignment; rows: Record<string, { sold: string; returned: string }>; method: PayMethod; pay: "pagado" | "fiado" } | null>(null);

  const load = useCallback(async () => {
    const [o, c] = await Promise.all([
      supabase.from("consignments").select("*").eq("status", "abierta").order("created_at", { ascending: false }),
      supabase.from("consignments").select("*").eq("status", "liquidada").order("closed_at", { ascending: false }).limit(20),
    ]);
    const all = [...(o.data ?? []), ...(c.data ?? [])] as Consignment[];
    setOpen((o.data ?? []) as Consignment[]);
    setClosed((c.data ?? []) as Consignment[]);
    if (all.length) {
      const { data: it } = await supabase.from("consignment_items").select("*").in("consignment_id", all.map((x) => x.id)).order("created_at");
      setItems((it ?? []) as ConsignmentItem[]);
    }
    setLoading(false);
  }, [supabase]);
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const term = q.trim().toLowerCase();
    if (!term) return setResults([]);
    const t = setTimeout(async () => {
      const { data } = await supabase.from("product_summaries").select(SUMMARY_COLS).eq("status", "confirmed").ilike("search", `%${term.replace(/[%_]/g, "")}%`).limit(8);
      setResults((data ?? []).map(fromSummary));
    }, 200);
    return () => clearTimeout(t);
  }, [q, supabase]);

  async function add(p: Product, variant?: ProductVariant | null) {
    if (variant === undefined) {
      const { data: vs } = await supabase.from("product_variants").select("*").eq("product_id", p.id).order("created_at");
      if (vs?.length) return setPicking({ product: p, variants: vs as ProductVariant[] });
      variant = null;
    }
    const key = variant ? variant.id : p.id;
    setLines((ls) => (ls.some((l) => l.key === key) ? ls.map((l) => (l.key === key ? { ...l, qty: String((parseInt(l.qty, 10) || 0) + 1) } : l)) : [...ls, { key, product: p, variant: variant ?? null, qty: "1", price: String(suggestedPrice(p, variant ?? null)) }]));
    setPicking(null);
    setQ("");
    setResults([]);
  }
  async function onCode(code: string) {
    const res = await fetch(`/api/barcode?code=${encodeURIComponent(code)}`);
    const json = (await res.json().catch(() => ({}))) as { found?: string; product?: Product; variant?: ProductVariant | null; variants?: ProductVariant[] };
    if (json.found !== "own" || !json.product) return toast("info", `Código ${code}: no está en tu inventario`);
    if (json.variant) return add(json.product, json.variant);
    if (json.variants?.length) return setPicking({ product: json.product, variants: json.variants });
    add(json.product, null);
  }

  /** Entregar: sale del estante (movimiento «salida · entregado a X») y queda como mercadería afuera. */
  async function deliver() {
    if (!customer) return toast("info", "Elige a quién le entregas");
    const valid = lines.filter((l) => (parseInt(l.qty, 10) || 0) > 0);
    if (!valid.length) return toast("info", "Agrega lo que entregas");
    const units = valid.reduce((s, l) => s + (parseInt(l.qty, 10) || 0), 0);
    const value = valid.reduce((s, l) => s + (parseInt(l.qty, 10) || 0) * (Number(l.price.replace(",", ".")) || 0), 0);
    const ok = await confirm({
      title: `¿Entregamos a ${customer.name}?`,
      body: "La mercadería sale de tu estante pero sigue siendo tuya hasta que la venda o la devuelva. Cuando rindas cuentas, lo vendido se cobra y lo devuelto vuelve al estante.",
      details: [
        { label: "Productos", value: `${valid.length} · ${units} unid.` },
        { label: "Valor a precio de venta", value: `Bs ${fmtMoney(value)}` },
      ],
      confirmLabel: "Sí, entregar",
      tone: "primary",
    });
    if (!ok) return;
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: cons, error } = await supabase.from("consignments").insert({ user_id: user!.id, customer_id: customer.id, customer_name: customer.name }).select().single();
    if (error || !cons) {
      setSaving(false);
      return toast("error", error?.message ?? "No se pudo registrar la entrega");
    }
    for (const l of valid) {
      const qty = parseInt(l.qty, 10) || 0;
      const price = Number(l.price.replace(",", ".")) || 0;
      await supabase.from("consignment_items").insert({ consignment_id: cons.id, user_id: user!.id, product_id: l.product.id, variant_id: l.variant?.id ?? null, product_name: productTitle(l.product.data) || null, variant_label: l.variant?.label ?? null, qty_out: qty, unit_price: price });
      let resultante = 0;
      if (l.variant) {
        const { data: v } = await supabase.from("product_variants").select("stock").eq("id", l.variant.id).maybeSingle();
        resultante = Math.max(0, (v?.stock ?? 0) - qty);
        await supabase.from("product_variants").update({ stock: resultante }).eq("id", l.variant.id);
      } else {
        const { data: p } = await supabase.from("products").select("data").eq("id", l.product.id).maybeSingle();
        if (p) {
          const keys = Object.keys(p.data);
          const key = ["stock", "cantidad", "existencias"].map((k) => keys.find((x) => x.toLowerCase() === k)).find(Boolean) ?? "stock";
          resultante = Math.max(0, (Number(p.data[key] ?? 0) || 0) - qty);
          await supabase.from("products").update({ data: { ...p.data, [key]: resultante } }).eq("id", l.product.id);
        }
      }
      await supabase.from("stock_movements").insert({ user_id: user!.id, product_id: l.product.id, product_name: productTitle(l.product.data) || null, variant_id: l.variant?.id ?? null, variant_label: l.variant?.label ?? null, tipo: "salida", cantidad: qty, motivo: `entregado a ${customer.name}`, stock_resultante: resultante, consignment_id: cons.id });
    }
    setSaving(false);
    navigator.vibrate?.(30);
    toast("success", `Entrega a ${customer.name} registrada: ${units} unidades afuera`);
    setLines([]);
    setCustomer(null);
    setMode("list");
    load();
  }

  /** Liquidar: lo vendido se cobra (o se fía) como una venta; lo devuelto vuelve al estante. */
  async function doSettle() {
    if (!settle) return;
    const its = items.filter((i) => i.consignment_id === settle.cons.id);
    const parsed = its.map((i) => {
      const pending = i.qty_out - i.qty_sold - i.qty_returned;
      const sold = Math.max(0, Math.min(pending, parseInt(settle.rows[i.id]?.sold ?? "0", 10) || 0));
      const returned = Math.max(0, Math.min(pending - sold, parseInt(settle.rows[i.id]?.returned ?? "0", 10) || 0));
      return { i, pending, sold, returned };
    });
    const soldUnits = parsed.reduce((s, p) => s + p.sold, 0);
    const retUnits = parsed.reduce((s, p) => s + p.returned, 0);
    if (!soldUnits && !retUnits) return toast("info", "Escribe cuánto vendió o cuánto devuelve");
    const amount = parsed.reduce((s, p) => s + p.sold * Number(p.i.unit_price), 0);
    const remaining = parsed.reduce((s, p) => s + (p.pending - p.sold - p.returned), 0);
    const ok = await confirm({
      title: `¿Rendimos cuentas con ${settle.cons.customer_name}?`,
      body: remaining ? `Quedan ${remaining} unidades todavía afuera; la entrega sigue abierta.` : "Con esto la entrega queda cerrada.",
      details: [
        ...(soldUnits ? [{ label: "Vendió", value: `${soldUnits} unid. · Bs ${fmtMoney(amount)}`, tone: "ok" as const }] : []),
        ...(soldUnits ? [{ label: settle.pay === "pagado" ? "Te paga ahora" : "Queda debiendo", value: `Bs ${fmtMoney(amount)} · ${settle.pay === "pagado" ? METHOD_LABEL[settle.method] : "fiado"}`, tone: settle.pay === "pagado" ? ("ok" as const) : ("warn" as const) }] : []),
        ...(retUnits ? [{ label: "Devuelve al estante", value: `${retUnits} unid.` }] : []),
      ],
      confirmLabel: "Sí, registrar",
      tone: "success",
    });
    if (!ok) return;
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    try {
      // Vendido → venta a nombre del cliente (el stock ya había salido: la venta no vuelve a descontarlo)
      if (soldUnits) {
        const cart: CartLine[] = [];
        for (const p of parsed.filter((x) => x.sold > 0)) {
          const { data: prod } = await supabase.from("products").select("*").eq("id", p.i.product_id!).maybeSingle();
          if (!prod) continue;
          let variant: ProductVariant | null = null;
          if (p.i.variant_id) {
            const { data: v } = await supabase.from("product_variants").select("*").eq("id", p.i.variant_id).maybeSingle();
            variant = (v as ProductVariant | null) ?? null;
          }
          cart.push({ key: p.i.id, product: prod as Product, variant, qty: p.sold, unitPrice: Number(p.i.unit_price) });
        }
        // Compensación: registerSale descuenta stock; aquí ya salió al entregar → se repone antes
        for (const l of cart) {
          if (l.variant) {
            const { data: v } = await supabase.from("product_variants").select("stock").eq("id", l.variant.id).maybeSingle();
            await supabase.from("product_variants").update({ stock: (v?.stock ?? 0) + l.qty }).eq("id", l.variant.id);
          } else {
            const { data: pr } = await supabase.from("products").select("data").eq("id", l.product.id).maybeSingle();
            if (pr) {
              const keys = Object.keys(pr.data);
              const key = ["stock", "cantidad", "existencias"].map((k) => keys.find((x) => x.toLowerCase() === k)).find(Boolean) ?? "stock";
              await supabase.from("products").update({ data: { ...pr.data, [key]: (Number(pr.data[key] ?? 0) || 0) + l.qty } }).eq("id", l.product.id);
            }
          }
        }
        await registerSale(supabase, cart, { method: settle.method, status: settle.pay, paid: 0, discount: 0, customerId: settle.cons.customer_id, customerName: settle.cons.customer_name, note: "consignación" });
      }
      // Devuelto → vuelve al estante
      for (const p of parsed.filter((x) => x.returned > 0)) {
        let resultante = 0;
        if (p.i.variant_id) {
          const { data: v } = await supabase.from("product_variants").select("stock").eq("id", p.i.variant_id).maybeSingle();
          resultante = (v?.stock ?? 0) + p.returned;
          await supabase.from("product_variants").update({ stock: resultante }).eq("id", p.i.variant_id);
        } else if (p.i.product_id) {
          const { data: pr } = await supabase.from("products").select("data").eq("id", p.i.product_id).maybeSingle();
          if (pr) {
            const keys = Object.keys(pr.data);
            const key = ["stock", "cantidad", "existencias"].map((k) => keys.find((x) => x.toLowerCase() === k)).find(Boolean) ?? "stock";
            resultante = (Number(pr.data[key] ?? 0) || 0) + p.returned;
            await supabase.from("products").update({ data: { ...pr.data, [key]: resultante } }).eq("id", p.i.product_id);
          }
        }
        await supabase.from("stock_movements").insert({ user_id: user!.id, product_id: p.i.product_id, product_name: p.i.product_name, variant_id: p.i.variant_id, variant_label: p.i.variant_label, tipo: "entrada", cantidad: p.returned, motivo: `devuelto por ${settle.cons.customer_name}`, stock_resultante: resultante, consignment_id: settle.cons.id });
      }
      for (const p of parsed) {
        if (p.sold || p.returned) await supabase.from("consignment_items").update({ qty_sold: p.i.qty_sold + p.sold, qty_returned: p.i.qty_returned + p.returned }).eq("id", p.i.id);
      }
      if (!remaining) await supabase.from("consignments").update({ status: "liquidada", closed_at: new Date().toISOString() }).eq("id", settle.cons.id);
      navigator.vibrate?.(30);
      toast("success", remaining ? "Cuentas registradas; la entrega sigue abierta" : "Entrega liquidada");
      setSettle(null);
      load();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "No se pudo liquidar");
    } finally {
      setSaving(false);
    }
  }

  const pendingOf = (c: Consignment) => items.filter((i) => i.consignment_id === c.id).reduce((s, i) => s + (i.qty_out - i.qty_sold - i.qty_returned), 0);

  if (mode === "new") {
    return (
      <div className="has-action mx-auto max-w-2xl space-y-4">
        <header className="animate-in">
          <button onClick={() => setMode("list")} className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"><IconArrowLeft size={16} /> Entregas</button>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Nueva entrega</h1>
          <p className="text-sm text-slate-500">Le das mercadería a alguien para que la venda. Sigue siendo tuya hasta que rinda cuentas.</p>
        </header>
        <section className="animate-in card space-y-3 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">¿A quién?</p>
          <CustomerPicker value={customer} onChange={setCustomer} required />
        </section>
        <section className="animate-in card space-y-3 p-4">
          <p className="text-sm font-bold text-ink">Qué le entregas</p>
          <div className="relative">
            <IconSearch size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-11" placeholder="Buscar producto…" value={q} onChange={(e) => setQ(e.target.value)} />
            {results.length > 0 && (
              <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-2xl bg-white p-1 shadow-2xl ring-1 ring-slate-900/10">
                {results.map((p) => (
                  <li key={p.id}><button onClick={() => add(p)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-brand-50"><span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{productTitle(p.data) || "Sin nombre"}</span><span className="text-xs text-slate-500">{stockOf(p) ?? 0} en stock</span></button></li>
                ))}
              </ul>
            )}
          </div>
          <BarcodeCamera onCode={onCode} label="Escanear producto" />
          {picking && (
            <div className="rounded-2xl bg-violet-50 p-3">
              <p className="text-xs font-semibold text-violet-900">{productTitle(picking.product.data)} · ¿qué variante?</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {picking.variants.map((v) => <button key={v.id} onClick={() => add(picking.product, v)} className="rounded-full border-2 border-violet-300 bg-white px-3 py-1 text-sm font-semibold text-violet-800">{v.label} <span className="opacity-60">{v.stock}</span></button>)}
                <button onClick={() => setPicking(null)} className="btn-ghost btn-sm"><IconX size={14} /></button>
              </div>
            </div>
          )}
          {lines.length > 0 && (
            <ul className="divide-y divide-slate-100">
              {lines.map((l) => (
                <li key={l.key} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{productTitle(l.product.data)}{l.variant ? <span className="text-violet-800"> · {l.variant.label}</span> : null}</span>
                  <label className="text-[11px] text-slate-500">unid. <input type="number" min={1} inputMode="numeric" className="input w-16 py-1 text-center font-bold tabular-nums" value={l.qty} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: e.target.value } : x)))} /></label>
                  <label className="text-[11px] text-slate-500">a Bs <input type="number" min={0} step="any" inputMode="decimal" className="input w-20 py-1 text-center tabular-nums" value={l.price} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, price: e.target.value } : x)))} /></label>
                  <button onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="rounded-full p-1 text-slate-300 hover:text-rose-600"><IconTrash size={14} /></button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className="sticky-action">
          <button onClick={deliver} disabled={saving || !lines.length || !customer} className="btn-primary btn-lg w-full">{saving ? <Spinner /> : <IconCheck size={20} />} Entregar {lines.reduce((s, l) => s + (parseInt(l.qty, 10) || 0), 0)} unid.</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <header className="animate-in">
        <Link href="/customers" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"><IconArrowLeft size={16} /> Clientes</Link>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink">Mercadería entregada</h1>
            <p className="text-sm text-slate-500">Lo que dejaste con revendedores para que lo vendan. Aquí rindes cuentas: qué vendieron y qué devuelven.</p>
          </div>
          <button onClick={() => setMode("new")} className="btn-primary btn-sm"><IconPlus size={16} /> Nueva entrega</button>
        </div>
      </header>
      <CoachTip screen="consign" title="¿Cómo funciona?">
        Al entregar, los productos salen de tu estante pero siguen contando como tuyos. Cuando la persona te rinde cuentas, escribes cuánto vendió (se cobra o queda fiado) y cuánto devuelve (vuelve al estante).
      </CoachTip>

      {loading ? (
        <ListSkeleton rows={3} />
      ) : (
        <>
          {open.length === 0 ? (
            <div className="animate-in card text-center">
              <p className="text-lg font-bold text-ink">No tienes mercadería afuera</p>
              <p className="mt-1 text-sm text-slate-500">Cuando le des productos a alguien para vender, regístralo con <b>Nueva entrega</b>.</p>
            </div>
          ) : (
            <ul className="stagger space-y-2">
              {open.map((c) => (
                <li key={c.id} className="rounded-2xl bg-white shadow-card ring-1 ring-slate-900/10">
                  <button onClick={() => setExpanded(expanded === c.id ? null : c.id)} className="flex w-full items-center gap-3 p-3 text-left">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-800">{(c.customer_name ?? "?").slice(0, 1).toUpperCase()}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-ink">{c.customer_name}</span>
                      <span className="block text-xs text-slate-500">desde {new Date(c.created_at).toLocaleDateString("es", { day: "2-digit", month: "short" })} · {pendingOf(c)} unid. afuera</span>
                    </span>
                    <IconChevronRight className={`text-slate-300 transition ${expanded === c.id ? "rotate-90" : ""}`} />
                  </button>
                  {expanded === c.id && (
                    <div className="border-t border-slate-100 p-3">
                      <ul className="divide-y divide-slate-100 text-sm">
                        {items.filter((i) => i.consignment_id === c.id).map((i) => (
                          <li key={i.id} className="flex items-center gap-2 py-1.5">
                            <span className="min-w-0 flex-1 truncate">{i.product_name}{i.variant_label ? <span className="text-violet-800"> · {i.variant_label}</span> : null}</span>
                            <span className="text-xs text-slate-500">entregó {i.qty_out} · vendió {i.qty_sold} · devolvió {i.qty_returned}</span>
                            <span className="font-bold tabular-nums">{i.qty_out - i.qty_sold - i.qty_returned}</span>
                          </li>
                        ))}
                      </ul>
                      <button onClick={() => setSettle({ cons: c, rows: {}, method: "efectivo", pay: "pagado" })} className="btn-success mt-3 w-full"><IconCheck size={18} /> Rendir cuentas</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {settle && (
            <div className="fixed inset-0 z-[60] flex items-end justify-center md:items-center" onClick={() => setSettle(null)}>
              <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
              <div className="animate-in relative flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-3xl bg-white shadow-2xl md:rounded-3xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                  <p className="font-bold text-ink">Rendir cuentas · {settle.cons.customer_name}</p>
                  <button onClick={() => setSettle(null)} className="btn-ghost btn-sm"><IconX size={18} /></button>
                </div>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                  <ul className="space-y-2">
                    {items.filter((i) => i.consignment_id === settle.cons.id && i.qty_out - i.qty_sold - i.qty_returned > 0).map((i) => {
                      const pending = i.qty_out - i.qty_sold - i.qty_returned;
                      const r = settle.rows[i.id] ?? { sold: "", returned: "" };
                      return (
                        <li key={i.id} className="rounded-2xl bg-slate-50 p-3">
                          <p className="text-sm font-semibold text-ink">{i.product_name}{i.variant_label ? <span className="text-violet-800"> · {i.variant_label}</span> : null} <span className="text-xs font-normal text-slate-500">· {pending} afuera · Bs {fmtMoney(Number(i.unit_price))} c/u</span></p>
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <label className="text-[11px] font-semibold uppercase text-slate-500">Vendió<input type="number" min={0} max={pending} inputMode="numeric" className="input mt-0.5 py-1.5 text-center font-bold tabular-nums" value={r.sold} onChange={(e) => setSettle({ ...settle, rows: { ...settle.rows, [i.id]: { ...r, sold: e.target.value } } })} /></label>
                            <label className="text-[11px] font-semibold uppercase text-slate-500">Devuelve<input type="number" min={0} max={pending} inputMode="numeric" className="input mt-0.5 py-1.5 text-center font-bold tabular-nums" value={r.returned} onChange={(e) => setSettle({ ...settle, rows: { ...settle.rows, [i.id]: { ...r, returned: e.target.value } } })} /></label>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Lo vendido, ¿te lo paga ahora?</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={() => setSettle({ ...settle, pay: "pagado" })} className={`rounded-xl border-2 px-2 py-2 text-sm font-semibold ${settle.pay === "pagado" ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-200"}`}>Sí, paga</button>
                      <button onClick={() => setSettle({ ...settle, pay: "fiado" })} className={`rounded-xl border-2 px-2 py-2 text-sm font-semibold ${settle.pay === "fiado" ? "border-amber-500 bg-amber-500 text-white" : "border-slate-200"}`}>Queda debiendo</button>
                    </div>
                    {settle.pay === "pagado" && (
                      <div className="mt-2 flex gap-1">
                        {(["efectivo", "qr", "transferencia"] as PayMethod[]).map((m) => <button key={m} onClick={() => setSettle({ ...settle, method: m })} className={`chip ${settle.method === m ? "chip-active" : ""}`}>{METHOD_LABEL[m]}</button>)}
                      </div>
                    )}
                  </div>
                </div>
                <div className="border-t border-slate-100 p-3">
                  <button onClick={doSettle} disabled={saving} className="btn-success btn-lg w-full">{saving ? <Spinner /> : <IconCheck size={20} />} Registrar cuentas</button>
                </div>
              </div>
            </div>
          )}

          {closed.length > 0 && (
            <section className="animate-in card p-3">
              <h2 className="mb-2 text-sm font-bold text-ink">Entregas ya liquidadas</h2>
              <ul className="divide-y divide-slate-100 text-sm">
                {closed.map((c) => {
                  const its = items.filter((i) => i.consignment_id === c.id);
                  return (
                    <li key={c.id} className="flex items-center gap-3 py-2">
                      <span className="min-w-0 flex-1 truncate">{c.customer_name} <span className="text-xs text-slate-500">· {c.closed_at ? new Date(c.closed_at).toLocaleDateString("es", { day: "2-digit", month: "short" }) : ""}</span></span>
                      <span className="text-xs text-slate-500">vendió {its.reduce((s, i) => s + i.qty_sold, 0)} · devolvió {its.reduce((s, i) => s + i.qty_returned, 0)}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
