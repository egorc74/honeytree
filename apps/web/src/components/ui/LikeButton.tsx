"use client";

import { useEffect, useRef, useState } from "react";
import { compactNumber } from "@/lib/format";
import { BeeIcon } from "./BeeIcon";
import { cx } from "./cx";

/**
 * Like button with the bee "buzz" micro-animation (runs when the state flips to liked;
 * disabled for users who prefer reduced motion via the CSS in globals.css).
 */
export function LikeButton({
  liked,
  count,
  onToggle,
  label,
  size = "md",
  pending,
  disabled,
  title,
  className,
}: {
  liked: boolean;
  count: number;
  onToggle: () => void;
  /** e.g. "game" or "comment" for the accessible name */
  label: string;
  size?: "sm" | "md" | "lg";
  pending?: boolean;
  /** e.g. your own content: the API answers 403 SELF_ACTION */
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  const [buzz, setBuzz] = useState(false);
  const prev = useRef(liked);

  useEffect(() => {
    if (!prev.current && liked) {
      setBuzz(true);
      const t = setTimeout(() => setBuzz(false), 650);
      prev.current = liked;
      return () => clearTimeout(t);
    }
    prev.current = liked;
  }, [liked]);

  const dims = { sm: "h-8 px-2.5 text-sm gap-1.5", md: "h-10 px-3.5 text-base gap-2", lg: "h-12 px-5 text-lg gap-2" }[size];
  const icon = { sm: 18, md: 22, lg: 26 }[size];

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={liked}
      aria-label={`${liked ? "Unlike" : "Like"} this ${label}, ${count} ${count === 1 ? "like" : "likes"}`}
      data-testid="like-button"
      data-liked={liked}
      disabled={pending || disabled}
      title={title}
      className={cx(
        "inline-flex items-center rounded-pill border-2 font-heading font-medium transition-colors",
        dims,
        liked ? "border-transparent bg-primary text-primary-fg" : "border-line bg-raised text-fg hover:border-primary",
        disabled && "cursor-not-allowed opacity-60 hover:border-line",
        className,
      )}
    >
      <span className={cx("inline-flex", buzz && "animate-buzz")}>
        <BeeIcon size={icon} filled={liked} />
      </span>
      <span className="tabular-nums" aria-hidden>
        {compactNumber(count)}
      </span>
    </button>
  );
}
