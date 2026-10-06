import { formatBytes } from "@/lib/format";
import type { PendingUpload } from "./useUploads";
import { MediaStatusBadge, ProgressBar } from "./MediaStatus";
import { Button } from "../ui";

/** In-flight and failed uploads. */
export function PendingList({ items, onDismiss }: { items: PendingUpload[]; onDismiss: (id: string) => void }) {
  if (!items.length) return null;
  return (
    <ul className="space-y-2" aria-label="Uploads in progress" data-testid="pending-uploads">
      {items.map((u) => (
        <li key={u.id} className="space-y-2 rounded-lg border border-line bg-raised p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 truncate font-medium">{u.name}</span>
            <MediaStatusBadge status={u.phase} fraction={u.fraction} />
          </div>
          {u.phase === "uploading" && <ProgressBar fraction={u.fraction} label={`Uploading ${u.name}`} />}
          {u.error && (
            <div className="flex items-center justify-between gap-2" role="alert">
              <p className="text-sm text-danger">{u.error}</p>
              <Button size="sm" variant="ghost" onClick={() => onDismiss(u.id)}>
                Dismiss
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export { formatBytes };
