"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { users } from "@/lib/api/endpoints";
import { keys } from "@/lib/api/keys";
import type { Me, UserLink } from "@/lib/api/types";
import { uploadErrorMessage, uploadMedia, validateFile } from "@/lib/upload";
import { Button, HexAvatar, Modal, TextArea, TextField, useToast } from "../ui";

const MAX_LINKS = 5;

export function EditProfileModal({ user, bio: bioInitial, links: initialLinks, open, onClose }: { user: Me; bio: string; links: UserLink[]; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [bio, setBio] = useState(bioInitial);
  const [links, setLinks] = useState<UserLink[]>(initialLinks);
  const [avatarMediaId, setAvatarMediaId] = useState<string | undefined>();
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user.avatarUrl);
  const [avatarBusy, setAvatarBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => users.update({ displayName: displayName.trim(), bio, links: links.filter((l) => l.label.trim() && l.url.trim()), avatarMediaId }),
    onSuccess: (updated) => {
      toast("Profile saved.", "success");
      qc.setQueryData(keys.me, (me: Me | null | undefined) => (me ? { ...me, displayName: updated.displayName, avatarUrl: updated.avatarUrl } : me));
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
          <legend className="mb-1 font-heading text-sm font-medium">Links (up to {MAX_LINKS})</legend>
          {links.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_2fr_auto] items-end gap-2">
              <TextField label="Label" value={l.label} maxLength={30} placeholder="Website" onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              <TextField label="URL" type="url" value={l.url} placeholder="https://…" onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
              <Button variant="ghost" size="sm" onClick={() => setLinks(links.filter((_, j) => j !== i))} aria-label={`Remove link ${i + 1}`}>
                ✕
              </Button>
            </div>
          ))}
          {links.length < MAX_LINKS && (
            <Button variant="secondary" size="sm" onClick={() => setLinks([...links, { label: "", url: "" }])}>
              + Add link
            </Button>
          )}
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
