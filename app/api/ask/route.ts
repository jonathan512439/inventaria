import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { GeminiError, QuotaError, generateContent } from "@/lib/gemini";
import { logUsage } from "@/lib/aiUsage";
import { resolveAiKey } from "@/lib/aiKey";
import { categoryPath } from "@/lib/categories";

export const runtime = "edge";

const MAX_PRODUCTS = 400;
const DAYS = 90;

/**
 * POST /api/ask { question } → { answer }
 * «Pregúntale a tu inventario»: el servidor arma un resumen de SOLO LECTURA con los datos del usuario
 * (productos, ventas de 90 días, deudas) y la IA responde en lenguaje natural. Nunca escribe nada.
 */
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { question } = (await request.json().catch(() => ({}))) as { question?: string };
  const q = String(question ?? "").trim().slice(0, 400);
  if (q.length < 3) return NextResponse.json({ error: "Escribe una pregunta" }, { status: 400 });

  const since = new Date(Date.now() - DAYS * 86400000).toISOString();
  const [{ data: cats }, { data: prods }, { data: sales }, { data: items }, { data: customers }, { data: prof }] = await Promise.all([
    supabase.from("categories").select("*"),
    supabase.from("product_summaries").select("id,category_id,nombre,marca,precio,precio_compra,stock,min_stock,expires_at").eq("status", "confirmed").limit(MAX_PRODUCTS),
    supabase.from("sales").select("id,number,customer_name,status,method,total,paid,cost_total,items,created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(1500),
    supabase.from("sale_items").select("sale_id,product_id,product_name,variant_label,qty,unit_price,unit_cost,line_total,created_at").gte("created_at", since).limit(4000),
    supabase.from("customers").select("id,name,phone").is("deleted_at", null).limit(300),
    supabase.from("profiles").select("business_name").maybeSingle(),
  ]);
  const categories = cats ?? [];

  // Ventas agregadas por producto (compacto) y por día
  const byProduct = new Map<string, { nombre: string; unidades: number; vendido: number; ganancia: number; ultima: string }>();
  for (const i of items ?? []) {
    const k = i.product_id ?? i.product_name ?? "?";
    const cur = byProduct.get(k) ?? { nombre: i.product_name ?? "Producto", unidades: 0, vendido: 0, ganancia: 0, ultima: i.created_at };
    cur.unidades += i.qty;
    cur.vendido += Number(i.line_total);
    cur.ganancia += Number(i.line_total) - i.qty * Number(i.unit_cost ?? 0);
    if (i.created_at > cur.ultima) cur.ultima = i.created_at;
    byProduct.set(k, cur);
  }
  const byDay = new Map<string, { vendido: number; ventas: number; ganancia: number }>();
  for (const s of sales ?? []) {
    const d = s.created_at.slice(0, 10);
    const cur = byDay.get(d) ?? { vendido: 0, ventas: 0, ganancia: 0 };
    cur.vendido += Number(s.total);
    cur.ventas++;
    cur.ganancia += Number(s.total) - Number(s.cost_total);
    byDay.set(d, cur);
  }
  const debts = new Map<string, number>();
  for (const s of sales ?? []) if (s.status !== "pagado" && s.customer_name) debts.set(s.customer_name, (debts.get(s.customer_name) ?? 0) + Number(s.total) - Number(s.paid));

  const snapshot = {
    negocio: prof?.business_name ?? null,
    hoy: new Date().toISOString().slice(0, 10),
    moneda: "Bs",
    productos: (prods ?? []).map((p) => ({
      id: p.id,
      nombre: p.nombre,
      marca: p.marca,
      categoria: categoryPath(categories, p.category_id) || "Sin categoría",
      precio: p.precio,
      costo: p.precio_compra,
      stock: p.stock,
      minimo: p.min_stock,
      vence: p.expires_at,
      ventas_90d: byProduct.get(p.id) ? { unidades: byProduct.get(p.id)!.unidades, vendido: r2(byProduct.get(p.id)!.vendido), ganancia: r2(byProduct.get(p.id)!.ganancia), ultima: byProduct.get(p.id)!.ultima.slice(0, 10) } : null,
    })),
    ventas_por_dia_90d: Array.from(byDay.entries()).map(([dia, v]) => ({ dia, ...v, vendido: r2(v.vendido), ganancia: r2(v.ganancia) })),
    ultimas_ventas: (sales ?? []).slice(0, 40).map((s) => ({ n: s.number, fecha: s.created_at.slice(0, 16), cliente: s.customer_name, estado: s.status, pago: s.method, total: Number(s.total), debe: r2(Number(s.total) - Number(s.paid)), productos: s.items })),
    deudas_clientes: Array.from(debts.entries()).map(([cliente, debe]) => ({ cliente, debe: r2(debe) })),
    clientes: (customers ?? []).length,
  };
  let json = JSON.stringify(snapshot);
  if (json.length > 120_000) {
    // Recorte de seguridad: menos productos si el negocio es muy grande
    snapshot.productos = snapshot.productos.slice(0, 200);
    json = JSON.stringify(snapshot);
  }

  const admin = createAdminClient();
  const key = await resolveAiKey(admin, user.id);
  const prompt = [
    "Eres el asistente de una pequeña tienda. Responde SOLO con los datos del negocio que te doy (JSON). No inventes cifras; si algo no está en los datos, dilo.",
    "Responde en español sencillo, sin tecnicismos, en 2-6 frases o una lista corta. Usa Bs para el dinero y redondea a 2 decimales. Si la pregunta pide un ranking, da máximo 5 elementos.",
    "Si detectas algo útil relacionado (por ejemplo un producto por reponer o una deuda vieja), menciónalo en una frase al final.",
    `Pregunta: ${q}`,
    `Datos del negocio: ${json}`,
  ].join("\n\n");

  try {
    const { text, model } = await generateContent([{ text: prompt }], { temperature: 0.2 }, key);
    await logUsage(admin, user.id, "ask", key.own);
    return NextResponse.json({ answer: text.trim(), model, products: snapshot.productos.length, days: DAYS });
  } catch (e) {
    await logUsage(admin, user.id, "ask", key.own);
    if (e instanceof QuotaError) return NextResponse.json({ error: e.message, daily: true }, { status: 429 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo responder" }, { status: e instanceof GeminiError ? e.status : 500 });
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100;
