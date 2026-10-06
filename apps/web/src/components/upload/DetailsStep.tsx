"use client";

import { useState, type KeyboardEvent } from "react";
import type { GameInput, Platform } from "@/lib/api/types";
import { PLATFORM_LABEL } from "@/lib/format";
import { Badge, TextArea, TextField } from "../ui";

export const SUGGESTED_TAGS = ["platformer", "puzzle", "rpg", "roguelike", "horror", "cozy", "pixel-art", "multiplayer", "strategy", "adventure"];
const PLATFORMS: Platform[] = ["windows", "mac", "linux", "web", "android"];
const MAX_TAGS = 8;

export interface DetailsValue {
  title: string;
  shortDescription: string;
  description: string;
  tags: string[];
  platforms: Platform[];
  version: string;
}

export const emptyDetails: DetailsValue = { title: "", shortDescription: "", description: "", tags: [], platforms: [], version: "1.0.0" };

export function validateDetails(v: DetailsValue): Record<string, string> {
  const e: Record<string, string> = {};
  if (!v.title.trim()) e.title = "Give your game a title.";
  else if (v.title.length > 80) e.title = "Title can be at most 80 characters.";
  if (!v.shortDescription.trim()) e.shortDescription = "Add a one-line pitch.";
  else if (v.shortDescription.length > 160) e.shortDescription = "Keep the pitch under 160 characters.";
  if (!v.platforms.length) e.platforms = "Pick at least one platform.";
  if (!v.version.trim()) e.version = "Add a version number.";
  return e;
}

export function toInput(v: DetailsValue): GameInput {
  return { ...v, title: v.title.trim(), shortDescription: v.shortDescription.trim(), version: v.version.trim() };
}

export function normalizeTag(raw: string): string {
  return raw.toLowerCase().trim().replace(/^#/, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
}

export function DetailsStep({ value, onChange, errors }: { value: DetailsValue; onChange: (v: DetailsValue) => void; errors: Record<string, string> }) {
  const [tagText, setTagText] = useState("");
  const set = <K extends keyof DetailsValue>(k: K, v: DetailsValue[K]) => onChange({ ...value, [k]: v });

  function addTag(raw: string) {
    const t = normalizeTag(raw);
    if (t.length >= 2 && !value.tags.includes(t) && value.tags.length < MAX_TAGS) set("tags", [...value.tags, t]);
    setTagText("");
  }
  function onTagKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(tagText);
    } else if (e.key === "Backspace" && !tagText && value.tags.length) set("tags", value.tags.slice(0, -1));
  }

  return (
    <div className="space-y-5">
      <TextField label="Title" value={value.title} onChange={(e) => set("title", e.target.value)} maxLength={80} error={errors.title} required />
      <TextField
        label="One-line pitch"
        value={value.shortDescription}
        onChange={(e) => set("shortDescription", e.target.value)}
        maxLength={160}
        error={errors.shortDescription}
        hint={`${value.shortDescription.length}/160. Shown on game cards.`}
        required
      />
      <TextArea
        label="Description (Markdown)"
        value={value.description}
        onChange={(e) => set("description", e.target.value)}
        className="[&_textarea]:min-h-40"
        maxLength={10000}
        hint="Supports **bold**, *italic*, lists, > quotes and [links](https://…)."
      />

      <div>
        <label htmlFor="tag-input" className="mb-1 block font-heading text-sm font-medium">
          Tags <span className="font-normal text-muted">(up to {MAX_TAGS}, press Enter to add)</span>
        </label>
        <div className="flex flex-wrap items-center gap-2 rounded-md border-2 border-line bg-raised p-2 focus-within:border-primary">
          {value.tags.map((t) => (
            <Badge key={t} tone="honey" className="gap-1.5 py-1">
              #{t}
              <button type="button" aria-label={`Remove tag ${t}`} onClick={() => set("tags", value.tags.filter((x) => x !== t))} className="rounded-full px-1 hover:bg-bark-900 hover:text-comb-50">
                ×
              </button>
            </Badge>
          ))}
          <input
            id="tag-input"
            value={tagText}
            onChange={(e) => setTagText(e.target.value)}
            onKeyDown={onTagKey}
            onBlur={() => tagText && addTag(tagText)}
            disabled={value.tags.length >= MAX_TAGS}
            placeholder={value.tags.length ? "" : "puzzle, cozy…"}
            className="min-w-24 flex-1 bg-transparent px-1 py-1 outline-none placeholder:text-muted"
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Suggested tags">
          {SUGGESTED_TAGS.filter((t) => !value.tags.includes(t)).map((t) => (
            <button key={t} type="button" onClick={() => addTag(t)} className="rounded-pill border border-line px-2.5 py-0.5 text-sm text-muted hover:border-primary hover:text-fg">
              + {t}
            </button>
          ))}
        </div>
      </div>

      <fieldset>
        <legend className="mb-1 font-heading text-sm font-medium">Platforms</legend>
        <div className="flex flex-wrap gap-2">
          {PLATFORMS.map((p) => {
            const on = value.platforms.includes(p);
            return (
              <label
                key={p}
                className={`flex cursor-pointer items-center gap-2 rounded-pill border-2 px-4 py-1.5 font-medium has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] ${on ? "border-transparent bg-primary text-primary-fg" : "border-line bg-raised"}`}
              >
                <input type="checkbox" className="sr-only" checked={on} onChange={() => set("platforms", on ? value.platforms.filter((x) => x !== p) : [...value.platforms, p])} />
                {on && <span aria-hidden>✓</span>}
                {PLATFORM_LABEL[p]}
              </label>
            );
          })}
        </div>
        {errors.platforms && (
          <p role="alert" className="mt-1 text-sm text-danger">
            {errors.platforms}
          </p>
        )}
      </fieldset>

      <TextField label="Version" value={value.version} onChange={(e) => set("version", e.target.value)} maxLength={20} error={errors.version} className="max-w-48" />
    </div>
  );
}
