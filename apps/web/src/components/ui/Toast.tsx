"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { cx } from "./cx";

type ToastKind = "info" | "success" | "error" | "karma";
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}
interface ToastApi {
  toast: (message: string, kind?: ToastKind) => void;
  /** "+N karma 🍯" after actions that earn karma. No-op for 0/undefined. */
  karma: (amount?: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const id = useRef(0);

  const dismiss = useCallback((n: number) => setItems((l) => l.filter((t) => t.id !== n)), []);

  const toast = useCallback(
    (message: string, kind: ToastKind = "info") => {
      const n = ++id.current;
      setItems((l) => [...l.slice(-3), { id: n, kind, message }]);
      setTimeout(() => dismiss(n), kind === "error" ? 6000 : 3500);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      toast,
      karma: (amount) => {
        if (amount && amount > 0) toast(`+${amount} karma 🍯`, "karma");
      },
    }),
    [toast],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:pr-6">
        {/* Live region: announced politely by screen readers */}
        <div role="status" aria-live="polite" className="flex flex-col items-center gap-2 md:items-end">
          {items.map((t) => (
            <div
              key={t.id}
              data-testid={t.kind === "karma" ? "karma-toast" : "toast"}
              className={cx(
                "pointer-events-auto flex animate-pop-in items-center gap-3 rounded-pill border-2 px-5 py-2.5 font-heading font-medium shadow-comb",
                t.kind === "error" && "border-danger bg-danger-bg text-danger",
                t.kind === "success" && "border-success bg-success-bg text-success",
                t.kind === "karma" && "border-transparent bg-primary text-primary-fg",
                t.kind === "info" && "border-line bg-raised text-fg",
              )}
            >
              {t.message}
              <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss notification" className="-mr-2 rounded-full px-1.5 opacity-70 hover:opacity-100">
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}
