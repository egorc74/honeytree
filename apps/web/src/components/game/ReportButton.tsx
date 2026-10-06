"use client";

import { useState, type FormEvent } from "react";
import { reports } from "@/lib/api/endpoints";
import type { ReportTarget } from "@/lib/api/types";
import { useAuth } from "../AuthProvider";
import { Button, Modal, TextArea, useToast } from "../ui";

const REASONS = ["Malware or harmful file", "Abuse or harassment", "Spam or scam", "Stolen content", "Something else"];

export function ReportButton({ targetType, targetId, label = "Report", className }: { targetType: ReportTarget; targetId: string; label?: string; className?: string }) {
  const { requireAuth } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(REASONS[0]);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await reports.create({ targetType, targetId, reason: details.trim() ? `${reason}: ${details.trim()}` : reason });
      toast("Thanks. Our moderators will take a look. 🐝", "success");
      setOpen(false);
      setDetails("");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not send your report.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => requireAuth(() => setOpen(true))} className={className ?? "text-sm text-muted underline hover:text-fg"}>
        {label}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Report this ${targetType}`} description="Tell us what is wrong. Reports are reviewed by moderators.">
        <form onSubmit={submit} className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="mb-1 font-heading text-sm font-medium">Reason</legend>
            {REASONS.map((r) => (
              <label key={r} className="flex cursor-pointer items-center gap-2">
                <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="accent-[var(--ht-primary)]" />
                {r}
              </label>
            ))}
          </fieldset>
          <TextArea label="More details (optional)" value={details} onChange={(e) => setDetails(e.target.value)} maxLength={500} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" loading={busy}>
              Send report
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
