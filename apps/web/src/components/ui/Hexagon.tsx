import type { CSSProperties, ReactNode } from "react";
import { cx } from "./cx";

/** Pointy-top hexagon clip. */
export const HEX_CLIP = "polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)";

export function Hexagon({ children, className, style }: { children?: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={cx("grid place-items-center", className)} style={{ clipPath: HEX_CLIP, ...style }}>
      {children}
    </div>
  );
}

/** Section divider made of three small hexagons and a hairline. */
export function HexDivider({ className }: { className?: string }) {
  return (
    <div className={cx("flex items-center gap-3 text-line", className)} role="separator" aria-hidden>
      <span className="h-px flex-1 bg-line" />
      {[0, 1, 2].map((i) => (
        <span key={i} className={cx("block h-3 w-3", i === 1 ? "bg-primary" : "bg-line")} style={{ clipPath: HEX_CLIP }} />
      ))}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
