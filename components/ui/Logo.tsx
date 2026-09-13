/** Isotipo de InventarIA: cámara con chispa, sobre degradado. */
export function LogoMark({ size = 36, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#logo-g)" />
      <rect x="26" y="17" width="12" height="7" rx="2" fill="#fff" />
      <rect x="14" y="22" width="36" height="24" rx="6" fill="none" stroke="#fff" strokeWidth="4" />
      <circle cx="32" cy="34" r="7" fill="none" stroke="#fff" strokeWidth="4" />
      <path d="M48 12l1.6 3.4L53 17l-3.4 1.6L48 22l-1.6-3.4L43 17l3.4-1.6z" fill="#fde047" />
    </svg>
  );
}

export function LogoWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark size={34} />
      <span className="text-lg font-bold tracking-tight text-ink">
        Inventar<span className="ai-glow">IA</span>
      </span>
    </span>
  );
}
