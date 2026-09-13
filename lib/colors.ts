/** Color pastel estable por categoría (a partir del nombre), para chips, iconos y tarjetas. */
const PALETTE = [
  { bg: "bg-indigo-100", text: "text-indigo-700", ring: "ring-indigo-200", dot: "#6366f1" },
  { bg: "bg-emerald-100", text: "text-emerald-700", ring: "ring-emerald-200", dot: "#10b981" },
  { bg: "bg-amber-100", text: "text-amber-700", ring: "ring-amber-200", dot: "#f59e0b" },
  { bg: "bg-rose-100", text: "text-rose-700", ring: "ring-rose-200", dot: "#f43f5e" },
  { bg: "bg-sky-100", text: "text-sky-700", ring: "ring-sky-200", dot: "#0ea5e9" },
  { bg: "bg-violet-100", text: "text-violet-700", ring: "ring-violet-200", dot: "#8b5cf6" },
  { bg: "bg-teal-100", text: "text-teal-700", ring: "ring-teal-200", dot: "#14b8a6" },
  { bg: "bg-orange-100", text: "text-orange-700", ring: "ring-orange-200", dot: "#f97316" },
  { bg: "bg-fuchsia-100", text: "text-fuchsia-700", ring: "ring-fuchsia-200", dot: "#d946ef" },
  { bg: "bg-lime-100", text: "text-lime-700", ring: "ring-lime-200", dot: "#84cc16" },
];

export function categoryColor(name: string | null | undefined) {
  if (!name) return { bg: "bg-slate-100", text: "text-slate-600", ring: "ring-slate-200", dot: "#94a3b8" };
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
