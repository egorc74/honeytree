import type { ReactNode } from "react";
import { cx } from "./cx";
import { HEX_CLIP } from "./Hexagon";

export function EmptyState({
  title,
  description,
  action,
  emoji = "🐝",
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  emoji?: string;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-line px-6 py-12 text-center", className)}>
      <span className="grid h-20 w-20 place-items-center bg-surface text-4xl" style={{ clipPath: HEX_CLIP }} aria-hidden>
        {emoji}
      </span>
      <h3 className="font-heading text-xl font-semibold">{title}</h3>
      {description && <p className="max-w-md text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message = "Something went wrong.", onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-lg bg-danger-bg px-6 py-10 text-center text-danger">
      <p className="font-heading text-lg font-semibold">Oh no, the hive is quiet.</p>
      <p>{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="rounded-pill border-2 border-current px-4 py-1.5 font-heading font-medium hover:underline">
          Try again
        </button>
      )}
    </div>
  );
}
