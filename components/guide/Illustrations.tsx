/**
 * Ilustraciones SVG (mini-pantallas) para la guía paso a paso.
 * Ligeras, sin imágenes externas, mismo lenguaje visual que la app.
 */

const Phone = ({ children }: { children: React.ReactNode }) => (
  <svg viewBox="0 0 160 200" className="h-full w-full" aria-hidden>
    <defs>
      <linearGradient id="g-brand" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stopColor="#6366f1" />
        <stop offset="1" stopColor="#8b5cf6" />
      </linearGradient>
      <linearGradient id="g-green" x1="0" x2="1">
        <stop offset="0" stopColor="#10b981" />
        <stop offset="1" stopColor="#059669" />
      </linearGradient>
    </defs>
    <rect x="8" y="4" width="144" height="192" rx="18" fill="#0f172a" />
    <rect x="14" y="10" width="132" height="180" rx="13" fill="#f7f7fb" />
    <rect x="60" y="14" width="40" height="5" rx="2.5" fill="#0f172a" />
    {children}
  </svg>
);

/** Paso 1: elegir categorías (tarjetas, una marcada) */
export const IllustrationChoose = () => (
  <Phone>
    <text x="24" y="38" fontSize="9" fontWeight="700" fill="#0f172a">¿Qué vendes?</text>
    {[
      [24, 46, "📚", true],
      [84, 46, "👕", false],
      [24, 90, "🥤", true],
      [84, 90, "🔧", false],
    ].map(([x, y, e, on], i) => (
      <g key={i}>
        <rect x={x as number} y={y as number} width="52" height="38" rx="8" fill={on ? "#eef2ff" : "#fff"} stroke={on ? "#6366f1" : "#e2e8f0"} strokeWidth={on ? 1.5 : 1} />
        <text x={(x as number) + 6} y={(y as number) + 18} fontSize="12">{e as string}</text>
        <rect x={(x as number) + 6} y={(y as number) + 25} width="30" height="4" rx="2" fill="#cbd5e1" />
        {on && (
          <g>
            <circle cx={(x as number) + 45} cy={(y as number) + 8} r="5" fill="#6366f1" />
            <path d={`M${(x as number) + 42.5} ${(y as number) + 8} l1.8 1.8 3.2-3.6`} stroke="#fff" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          </g>
        )}
      </g>
    ))}
    <rect x="24" y="140" width="112" height="22" rx="11" fill="url(#g-brand)" />
    <text x="80" y="154" fontSize="8" fontWeight="700" fill="#fff" textAnchor="middle">Preparar mi inventario</text>
  </Phone>
);

/** Paso 2: cámara + miniaturas procesándose */
export const IllustrationCapture = () => (
  <Phone>
    <text x="24" y="38" fontSize="9" fontWeight="700" fill="#0f172a">Agregar productos</text>
    <rect x="24" y="46" width="52" height="40" rx="10" fill="url(#g-brand)" />
    <path d="M40 60h3l2-3h6l2 3h3v10H40z" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
    <circle cx="50" cy="65.5" r="2.6" fill="none" stroke="#fff" strokeWidth="1.6" />
    <text x="50" y="82" fontSize="6.5" fill="#fff" textAnchor="middle" fontWeight="700">Cámara</text>
    <rect x="84" y="46" width="52" height="40" rx="10" fill="#fff" stroke="#e2e8f0" />
    <rect x="102" y="56" width="16" height="12" rx="2" fill="none" stroke="#6366f1" strokeWidth="1.5" />
    <text x="110" y="82" fontSize="6.5" fill="#475569" textAnchor="middle" fontWeight="700">Galería</text>
    <text x="24" y="104" fontSize="7" fill="#64748b">3 en proceso · 5 listas</text>
    {[0, 1, 2, 3].map((i) => (
      <g key={i}>
        <rect x={24 + i * 28} y="110" width="24" height="24" rx="6" fill={["#c7d2fe", "#a5b4fc", "#fde68a", "#bbf7d0"][i]} />
        {i === 3 ? (
          <g>
            <circle cx={24 + i * 28 + 18} cy="116" r="4" fill="#10b981" />
            <path d={`M${24 + i * 28 + 16} 116 l1.5 1.5 2.5-3`} stroke="#fff" strokeWidth="1.2" fill="none" strokeLinecap="round" />
          </g>
        ) : i === 2 ? (
          <circle cx={24 + i * 28 + 12} cy="122" r="4" fill="none" stroke="#6366f1" strokeWidth="1.6" strokeDasharray="4 3" />
        ) : null}
      </g>
    ))}
    <rect x="14" y="170" width="132" height="20" rx="0" fill="#fff" />
    <circle cx="80" cy="172" r="11" fill="url(#g-brand)" />
    <path d="M74 171h2l1.5-2h5l1.5 2h2v6H74z" fill="none" stroke="#fff" strokeWidth="1.3" strokeLinejoin="round" />
  </Phone>
);

/** Paso 3: tarjeta de revisión con botón verde */
export const IllustrationReview = () => (
  <Phone>
    <text x="24" y="38" fontSize="9" fontWeight="700" fill="#0f172a">Revisar pendientes</text>
    <text x="136" y="38" fontSize="7" fill="#64748b" textAnchor="end">3 de 12</text>
    <rect x="24" y="44" width="112" height="40" rx="8" fill="#c7d2fe" />
    <rect x="44" y="52" width="72" height="24" rx="4" fill="#818cf8" />
    <text x="30" y="98" fontSize="6.5" fill="#6366f1" fontWeight="700">✦ LO RECONOCIÓ LA IA</text>
    <rect x="24" y="102" width="112" height="11" rx="5" fill="#fff" stroke="#e2e8f0" />
    <rect x="28" y="106" width="60" height="3" rx="1.5" fill="#94a3b8" />
    <text x="30" y="124" fontSize="6.5" fill="#64748b" fontWeight="700">COMPLETA TÚ</text>
    <rect x="24" y="128" width="54" height="14" rx="5" fill="#fff" stroke="#6366f1" strokeWidth="1.2" />
    <text x="30" y="138" fontSize="7" fontWeight="700" fill="#0f172a">25.00</text>
    <rect x="82" y="128" width="54" height="14" rx="5" fill="#fff" stroke="#e2e8f0" />
    <text x="88" y="138" fontSize="7" fontWeight="700" fill="#0f172a">1</text>
    <rect x="24" y="150" width="112" height="20" rx="10" fill="url(#g-green)" />
    <text x="80" y="163" fontSize="7.5" fontWeight="700" fill="#fff" textAnchor="middle">✓ Confirmar y siguiente</text>
  </Phone>
);

/** Paso 4: inventario + Excel */
export const IllustrationInventory = () => (
  <Phone>
    <text x="24" y="38" fontSize="9" fontWeight="700" fill="#0f172a">Mi inventario</text>
    <rect x="24" y="44" width="112" height="12" rx="6" fill="#fff" stroke="#e2e8f0" />
    <circle cx="32" cy="50" r="2.5" fill="none" stroke="#94a3b8" strokeWidth="1" />
    {["Todo", "Cuadernos", "Lápices"].map((t, i) => (
      <g key={t}>
        <rect x={24 + i * 38} y="62" width="34" height="11" rx="5.5" fill={i === 0 ? "#6366f1" : "#fff"} stroke={i === 0 ? "#6366f1" : "#e2e8f0"} />
        <text x={41 + i * 38} y="70" fontSize="5.5" fill={i === 0 ? "#fff" : "#475569"} textAnchor="middle" fontWeight="700">{t}</text>
      </g>
    ))}
    {[0, 1, 2].map((i) => (
      <g key={i}>
        <rect x="24" y={80 + i * 26} width="112" height="22" rx="7" fill="#fff" stroke="#e2e8f0" />
        <rect x="28" y={84 + i * 26} width="14" height="14" rx="4" fill={["#fde68a", "#bbf7d0", "#c7d2fe"][i]} />
        <rect x="46" y={86 + i * 26} width="50" height="3.5" rx="1.5" fill="#334155" />
        <rect x="46" y={93 + i * 26} width="28" height="3" rx="1.5" fill="#cbd5e1" />
        <text x="130" y={95 + i * 26} fontSize="6" fill="#059669" fontWeight="700" textAnchor="end">Bs {[12, 8, 25][i]}</text>
      </g>
    ))}
    <rect x="86" y="160" width="50" height="16" rx="8" fill="#fff" stroke="#10b981" strokeWidth="1.2" />
    <text x="111" y="171" fontSize="6.5" fill="#059669" fontWeight="700" textAnchor="middle">⬇ Excel</text>
  </Phone>
);
