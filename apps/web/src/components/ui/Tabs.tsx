"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  /** optional count shown next to the label */
  count?: number;
}

/**
 * Accessible tablist (WAI-ARIA tabs pattern: arrow keys move + select, Home/End).
 * Render panels with <TabPanel>. Pass `idPrefix` to keep ids stable across renders.
 */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  className,
  idPrefix,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
  idPrefix?: string;
}) {
  const auto = useId();
  const prefix = idPrefix ?? auto;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKey(e: KeyboardEvent, i: number) {
    let next = i;
    if (e.key === "ArrowRight") next = (i + 1) % items.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else return;
    e.preventDefault();
    onChange(items[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div role="tablist" aria-label={label} className={cx("flex gap-1 overflow-x-auto border-b-2 border-line", className)}>
      {items.map((item, i) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={`${prefix}-tab-${item.value}`}
            role="tab"
            type="button"
            aria-selected={active}
            aria-controls={`${prefix}-panel-${item.value}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={cx(
              "-mb-0.5 whitespace-nowrap rounded-t-md border-b-4 px-4 py-2 font-heading font-medium transition-colors",
              active ? "border-primary text-fg" : "border-transparent text-muted hover:text-fg",
            )}
          >
            {item.label}
            {item.count !== undefined && <span className="ml-1.5 rounded-pill bg-surface px-1.5 text-xs tabular-nums">{item.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ idPrefix, value, active, children }: { idPrefix: string; value: string; active: boolean; children: ReactNode }) {
  if (!active) return null;
  return (
    <div role="tabpanel" id={`${idPrefix}-panel-${value}`} aria-labelledby={`${idPrefix}-tab-${value}`} tabIndex={0} className="pt-5 focus-visible:outline-none">
      {children}
    </div>
  );
}

/** Segmented control for short option sets such as the leaderboard period switch. */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-pill border-2 border-line bg-raised p-0.5">
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          role="radio"
          aria-checked={it.value === value}
          onClick={() => onChange(it.value)}
          className={cx(
            "rounded-pill px-4 py-1.5 font-heading text-sm font-medium transition-colors",
            it.value === value ? "bg-primary text-primary-fg" : "text-fg hover:bg-surface",
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
