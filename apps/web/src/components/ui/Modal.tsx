"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { cx } from "./cx";

/**
 * Modal built on the native <dialog>: focus trap, Escape to close, inert background
 * and focus return come from the platform.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  className,
  description,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // backdrop click
      }}
      className={cx(
        "m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border-2 border-line bg-bg p-0 text-fg shadow-comb backdrop:bg-[rgba(42,25,14,0.6)]",
        className,
      )}
    >
      {open && (
        <div className="p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 id={titleId} className="font-heading text-2xl font-semibold">
                {title}
              </h2>
              {description && (
                <p id={descId} className="mt-1 text-muted">
                  {description}
                </p>
              )}
            </div>
            <button type="button" onClick={onClose} aria-label="Close dialog" className="rounded-full p-2 text-xl leading-none text-muted hover:bg-surface hover:text-fg">
              ×
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
