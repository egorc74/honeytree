"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { users } from "@/lib/api/endpoints";
import { keys } from "@/lib/api/keys";
import type { User, UserLinks } from "@/lib/api/types";
import { uploadErrorMessage, uploadMedia, validateFile } from "@/lib/upload";
import { Button, HexAvatar, Modal, TextArea, TextField, useToast } from "../ui";

const LINK_FIELDS: { key: keyof UserLinks; label: string; placeholder: string }[] = [
  { key: "website", label: "Website", placeholder: "https://…" },
  { key: "github", label: "GitHub", placeholder: "https://github.com/…" },
  { key: "itch", label: "itch.io", placeholder: "https://….itch.io" },
  { key: "twitter", label: "X / Twitter", placeholder: "https://x.com/…" },
  { key: "discord", label: "Discord", placeholder: "Invite link or username" },
];

export function EditProfileModal({ user, open, onClose }: { user: User; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [bio, setBio] = useState(user.bio);
  const [links, setLinks] = useState<UserLinks>(user.links ?? {});
  const [avatarMediaId, setAvatarMediaId] = useState<string | undefined>();
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user.avatarUrl);
  const [avatarBusy, setAvatarBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => users.update({ displayName: displayName.trim(), bio, links, avatarMediaId }),
    onSuccess: (updated) => {
      toast("Profile saved.", "success");
      qc.setQueryData(keys.me, updated);
      void qc.invalidateQueries({ queryKey: keys.profile(user.username) });
      void qc.invalidateQueries();
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not save your profile."),
  });

  async function pickAvatar(file: File | undefined) {
    if (!file) return;
    const problem = validateFile("avatar", file);
    if (problem) return setError(problem);
    setError(null);
    setAvatarBusy("Uploading…");
    try {
      const res = await uploadMedia({ gameId: null, kind: "avatar", file, onProgress: (p) => setAvatarBusy(p.phase === "uploading" ? `Uploading… ${Math.round(p.fraction * 100)}%` : `Processing (${p.phase})…`) });
      if (res.status === "rejected") throw new Error(res.reason ?? "That image was rejected.");
      setAvatarMediaId(res.mediaId);
      setAvatarPreview(URL.createObjectURL(file));
    } catch (e) {
      setError(uploadErrorMessage(e));
    } finally {
      setAvatarBusy(null);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!displayName.trim()) return setError("Display name can’t be empty.");
    save.mutate();
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit profile" className="max-h-[92vh] overflow-auto">
      <form onSubmit={submit} className="space-y-4">
        <div className="flex items-center gap-4">
          <HexAvatar src={avatarPreview} name={displayName || user.username} size="lg" />
          <div>
            <label className="inline-flex cursor-pointer items-center rounded-pill border-2 border-line bg-raised px-4 py-2 font-heading text-sm font-medium hover:border-primary focus-within:outline focus-within:outline-2">
              Change avatar
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => void pickAvatar(e.target.files?.[0])} aria-label="Upload a new avatar image" />
            </label>
            {avatarBusy && (
              <p className="mt-1 text-sm text-muted" role="status">
                {avatarBusy}
              </p>
            )}
          </div>
        </div>
        <TextField label="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} required />
        <TextArea label="Bio" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={500} counter={`${bio.length}/500`} />
        <fieldset className="space-y-3">
          <legend className="mb-1 font-heading text-sm font-medium">Links</legend>
          {LINK_FIELDS.map((f) => (
            <TextField key={f.key} label={f.label} placeholder={f.placeholder} value={links[f.key] ?? ""} onChange={(e) => setLinks({ ...links, [f.key]: e.target.value })} />
          ))}
        </fieldset>
        {error && (
          <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending} disabled={!!avatarBusy}>
            Save changes
          </Button>
        </div>
      </form>
    </Modal>
  );
}
