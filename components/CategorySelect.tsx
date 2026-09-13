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

/**
 * Selector de categoría / subcategoría.
 * Cada categoría es un grupo; dentro, la opción "Toda la categoría" y sus subcategorías.
 */
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
  const roots = buildTree(categories).filter((c) => !excludeIds.includes(c.id));
  return (
    <select id={id} className={className} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      {allowEmpty && <option value="">{emptyLabel}</option>}
      {roots.map((root) => {
        const subs = flattenTree(root.children).filter((c) => !excludeIds.includes(c.id));
        const label = `${root.icon ? root.icon + " " : ""}${root.name}`;
        return (
          <optgroup key={root.id} label={label}>
            <option value={root.id}>{root.name} (toda la categoría)</option>
            {subs.map((c) => (
              <option key={c.id} value={c.id}>
                {"  ".repeat(c.depth)}↳ {c.name}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}
