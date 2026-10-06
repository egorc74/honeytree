import { badgeKinds, type BadgeKind } from "@honeytree/ui-tokens";
import type { ReactNode } from "react";
import { cx } from "./cx";

const tone: Record<BadgeKind, string> = {
  fresh: "bg-success-bg text-success border-transparent",
  sweetest: "bg-primary text-primary-fg border-transparent",
  buzzing: "bg-badge text-badge-fg border-transparent",
};

/** Feed badge: 🆕 Fresh Nectar · 🍯 Sweetest · 🐝 Buzzing */
export function FeedBadge({ kind, className }: { kind: BadgeKind; className?: string }) {
  const { emoji, label } = badgeKinds[kind];
  return (
    <span
      data-testid={`badge-${kind}`}
      className={cx("inline-flex items-center gap-1 rounded-pill border px-2.5 py-0.5 font-heading text-xs font-medium shadow-sm", tone[kind], className)}
    >
      <span aria-hidden>{emoji}</span>
      {label}
    </span>
  );
}

/** Generic small pill (tags, platforms, status). */
export function Badge({
  children,
  tone: t = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "danger" | "honey";
  className?: string;
}) {
  const tones = {
    neutral: "bg-raised text-muted border-line",
    success: "bg-success-bg text-success border-transparent",
    danger: "bg-danger-bg text-danger border-transparent",
    honey: "bg-primary text-primary-fg border-transparent",
  } as const;
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-xs font-medium", tones[t], className)}>
      {children}
    </span>
  );
}
