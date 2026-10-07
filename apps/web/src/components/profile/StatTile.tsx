import type { ReactNode } from "react";
import { HEX_CLIP } from "../ui";

export function StatTile({ label, value, sub, icon, testId }: { label: string; value: ReactNode; sub?: string; icon: string; testId?: string }) {
  return (
    <div className="flex items-center gap-4 rounded-lg border-2 border-line bg-surface p-4" data-testid={testId}>
      <span className="grid h-14 w-14 shrink-0 place-items-center bg-primary text-2xl" style={{ clipPath: HEX_CLIP }} aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="font-heading text-3xl font-semibold leading-none tabular-nums">{value}</p>
        <p className="mt-1 text-sm text-muted">{label}</p>
        {sub && <p className="text-xs text-muted">{sub}</p>}
      </div>
    </div>
  );
}
