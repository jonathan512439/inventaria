"use client";

/** «¿Vence?»: la fecha la lee la IA del empaque; se cambia o se deja sin fecha. */
export default function ExpirySection({ value, readFromPackage, onChange }: { value: string; readFromPackage: boolean; onChange: (v: string) => void }) {
  return (
    <section className={`rounded-2xl border-2 p-3 ${value ? "border-warn-200 bg-warn-50/50" : "border-slate-200"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink">¿Vence?</span>
        {readFromPackage && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-800">✨ leído del empaque</span>}
        <span className="flex-1" />
        <input type="date" className="input h-11 w-auto text-sm" value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" onClick={() => onChange("")} className={`chip min-h-[44px] ${value === "" ? "chip-active" : ""}`}>Sin fecha</button>
      </div>
      <p className="mt-1 text-xs text-muted">{value ? `Se avisará antes del ${new Date(value + "T00:00:00").toLocaleDateString("es")}.` : "No perecedero: no se avisará de vencimiento."}</p>
    </section>
  );
}
