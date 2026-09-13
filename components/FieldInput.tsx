"use client";

import type { FieldTemplate, ProductData } from "@/types/database";

interface Props {
  field: FieldTemplate;
  value: ProductData[string];
  onChange: (v: string) => void;
  className?: string;
  compact?: boolean;
}

/** Input adecuado al tipo de campo (texto / número / lista). */
export default function FieldInput({ field, value, onChange, className = "input", compact }: Props) {
  const v = value === null || value === undefined ? "" : String(value);
  const cls = compact ? `${className} px-2 py-1 text-xs` : className;

  if (field.field_type === "select") {
    return (
      <select className={cls} value={v} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {(field.options ?? []).map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
        {v && !(field.options ?? []).includes(v) && <option value={v}>{v} (fuera de lista)</option>}
      </select>
    );
  }
  if (field.field_type === "number") {
    return <input type="number" inputMode="decimal" step="any" className={cls} value={v} onChange={(e) => onChange(e.target.value)} />;
  }
  return <input type="text" className={cls} value={v} onChange={(e) => onChange(e.target.value)} />;
}
