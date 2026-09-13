"use client";

import type { Category } from "@/types/database";
import { buildTree, flattenTree } from "@/lib/categories";

interface Props {
  categories: Category[];
  value: string | null | "";
  onChange: (id: string | null) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  excludeIds?: string[];
  className?: string;
  id?: string;
}

/** Select con indentación por nivel (Ropa / — Camisas / —— Manga larga). */
export default function CategorySelect({
  categories,
  value,
  onChange,
  allowEmpty = true,
  emptyLabel = "— Sin categoría —",
  excludeIds = [],
  className = "input",
  id,
}: Props) {
  const flat = flattenTree(buildTree(categories)).filter((c) => !excludeIds.includes(c.id));
  return (
    <select id={id} className={className} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      {allowEmpty && <option value="">{emptyLabel}</option>}
      {flat.map((c) => (
        <option key={c.id} value={c.id}>
          {"—".repeat(c.depth)} {c.name}
        </option>
      ))}
    </select>
  );
}
