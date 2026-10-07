"use client";

import type { GameDetail } from "@/lib/api/types";
import { GameCard } from "../GameCard";
import { Markdown } from "../Markdown";

export interface Requirement {
  label: string;
  done: boolean;
}

export function publishRequirements(g: GameDetail): Requirement[] {
  return [
    { label: "A title", done: !!g.title.trim() },
    { label: "A cover image (processed)", done: g.cover?.status === "ready" },
    { label: "At least one screenshot (processed)", done: g.screenshots.some((s) => s.status === "ready") },
    { label: "At least one build that passed the malware scan", done: g.builds.some((b) => b.status === "ready") },
  ];
}

export function PreviewStep({ game }: { game: GameDetail }) {
  const reqs = publishRequirements(game);
  return (
    <div className="space-y-6">
      <section aria-labelledby="req-h" className="space-y-2">
        <h3 id="req-h" className="font-heading text-xl font-semibold">
          Ready to publish?
        </h3>
        <ul className="space-y-1" data-testid="requirements">
          {reqs.map((r) => (
            <li key={r.label} className={r.done ? "text-success" : "text-danger"}>
              <span aria-hidden>{r.done ? "✓" : "✕"}</span> <span className="sr-only">{r.done ? "Done: " : "Missing: "}</span>
              {r.label}
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="prev-h" className="grid gap-6 md:grid-cols-[22rem_1fr]">
        <div>
          <h3 id="prev-h" className="mb-2 font-heading text-xl font-semibold">
            How it looks in the feed
          </h3>
          <div className="pointer-events-none" aria-hidden>
            <GameCard game={{ ...game, badge: "fresh" }} />
          </div>
        </div>
        <div>
          <h3 className="mb-2 font-heading text-xl font-semibold">Description</h3>
          <Markdown source={game.description || game.shortDescription} />
        </div>
      </section>
    </div>
  );
}
