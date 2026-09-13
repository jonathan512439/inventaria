"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { IconAlert, IconCheckCircle } from "./Icons";

type Kind = "success" | "error" | "info";
interface Toast {
  id: number;
  kind: Kind;
  text: string;
  action?: { label: string; onClick: () => void };
}

const Ctx = createContext<(kind: Kind, text: string, action?: Toast["action"]) => void>(() => {});

/** Avisos breves, no bloqueantes, con acción opcional (p. ej. "Deshacer"). */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const push = useCallback((kind: Kind, text: string, action?: Toast["action"]) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-2), { id, kind, text, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 6000 : 3200);
  }, []);

  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`animate-in pointer-events-auto relative flex max-w-md items-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium shadow-float ring-1 ${
              t.kind === "success"
                ? "bg-emerald-600 text-white ring-emerald-700/30"
                : t.kind === "error"
                  ? "bg-rose-600 text-white ring-rose-700/30"
                  : "bg-ink text-white ring-slate-900/30"
            }`}
          >
            {t.kind === "success" ? <IconCheckCircle size={18} /> : t.kind === "error" ? <IconAlert size={18} /> : null}
            <span>{t.text}</span>
            {t.action && (
              <span className="absolute inset-x-3 bottom-0 h-0.5 overflow-hidden rounded-full bg-white/25">
                <span className="block h-full w-full origin-left bg-white/80" style={{ animation: "toast-countdown 6s linear forwards" }} />
              </span>
            )}
            {t.action && (
              <button
                onClick={() => {
                  t.action?.onClick();
                  setToasts((x) => x.filter((y) => y.id !== t.id));
                }}
                className="ml-1 rounded-lg bg-white/20 px-2 py-0.5 text-xs font-semibold hover:bg-white/30"
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
