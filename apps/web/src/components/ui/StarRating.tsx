"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { cx } from "./cx";

function Star({ fill, size }: { fill: number; size: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <defs>
        <clipPath id={id}>
          <rect x="0" y="0" width={24 * fill} height="24" />
        </clipPath>
      </defs>
      <path
        d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8L12 2.5z"
        fill="none"
        stroke="var(--ht-badge)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8L12 2.5z"
        fill="var(--ht-primary)"
        stroke="var(--ht-badge)"
        strokeWidth="1.6"
        strokeLinejoin="round"
        clipPath={`url(#${id})`}
      />
    </svg>
  );
}

/** Read-only star display, with fractional fill. */
export function StarRating({
  value,
  size = 16,
  count,
  className,
  showValue = true,
}: {
  value: number | null;
  size?: number;
  count?: number;
  className?: string;
  showValue?: boolean;
}) {
  const v = value ?? 0;
  const label = value === null ? "No ratings yet" : `Rated ${v.toFixed(1)} out of 5${count !== undefined ? ` from ${count} reviews` : ""}`;
  return (
    <span className={cx("inline-flex items-center gap-1", className)} role="img" aria-label={label}>
      <span className="inline-flex" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <Star key={i} size={size} fill={Math.max(0, Math.min(1, v - i))} />
        ))}
      </span>
      {showValue && (
        <span className="text-sm font-medium tabular-nums text-fg" aria-hidden>
          {value === null ? "–" : v.toFixed(1)}
          {count !== undefined && <span className="text-muted"> ({count})</span>}
        </span>
      )}
    </span>
  );
}

/** Interactive 1–5 star input: radio group with arrow-key support. */
export function StarRatingInput({
  value,
  onChange,
  size = 28,
  label = "Rating",
}: {
  value: number;
  onChange: (v: number) => void;
  size?: number;
  label?: string;
}) {
  const [hover, setHover] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const shown = hover || value;

  function onKey(e: KeyboardEvent, i: number) {
    let next = i;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = Math.min(5, i + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = Math.max(1, i - 1);
    else if (e.key === "Home") next = 1;
    else if (e.key === "End") next = 5;
    else return;
    e.preventDefault();
    onChange(next);
    refs.current[next - 1]?.focus();
  }

  return (
    <div role="radiogroup" aria-label={label} className="inline-flex gap-0.5" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          ref={(el) => {
            refs.current[i - 1] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === i}
          aria-label={`${i} star${i > 1 ? "s" : ""}`}
          tabIndex={value === i || (value === 0 && i === 1) ? 0 : -1}
          onClick={() => onChange(i)}
          onKeyDown={(e) => onKey(e, i)}
          onMouseEnter={() => setHover(i)}
          className="rounded-md p-0.5 transition-transform hover:scale-110"
        >
          <Star size={size} fill={i <= shown ? 1 : 0} />
        </button>
      ))}
    </div>
  );
}
