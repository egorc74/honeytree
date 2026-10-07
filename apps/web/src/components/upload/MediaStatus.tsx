import type { MediaStatus as Status } from "@/lib/api/types";
import type { UploadPhase } from "@/lib/upload";
import { Badge } from "../ui";

const TEXT: Record<UploadPhase, string> = {
  uploading: "Uploading",
  scanning: "Scanning for malware",
  processing: "Processing",
  ready: "Ready",
  rejected: "Rejected",
};

export function MediaStatusBadge({ status, fraction }: { status: Status | UploadPhase; fraction?: number }) {
  const label = status === "uploading" && fraction !== undefined ? `Uploading ${Math.round(fraction * 100)}%` : (TEXT[status as UploadPhase] ?? status);
  return (
    <Badge tone={status === "ready" ? "success" : status === "rejected" ? "danger" : "honey"} data-status={status}>
      <span aria-hidden>{status === "ready" ? "✓" : status === "rejected" ? "✕" : "⏳"}</span> {label}
    </Badge>
  );
}

export function ProgressBar({ fraction, label }: { fraction: number; label: string }) {
  const pct = Math.round(fraction * 100);
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 w-full overflow-hidden rounded-pill bg-surface">
      <div className="h-full rounded-pill bg-primary transition-[width] duration-200" style={{ width: `${pct}%` }} />
    </div>
  );
}
