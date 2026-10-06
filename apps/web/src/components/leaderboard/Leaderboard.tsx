/* eslint-disable @next/next/no-img-element */
"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { leaderboard } from "@/lib/api/endpoints";
import { keys } from "@/lib/api/keys";
import type { LeaderboardEntry, LeaderboardPeriod, LeaderboardType } from "@/lib/api/types";
import { compactNumber } from "@/lib/format";
import { EmptyState, ErrorState, HexAvatar, RowSkeleton, Segmented, TabPanel, Tabs, HEX_CLIP } from "../ui";

const TYPES = [
  { value: "games" as const, label: "Top Games", unit: "likes" },
  { value: "creators" as const, label: "Top Creators", unit: "likes received" },
  { value: "karma" as const, label: "Top Karma", unit: "karma" },
];
const PERIODS = [
  { value: "week" as const, label: "This week" },
  { value: "month" as const, label: "This month" },
  { value: "all" as const, label: "All time" },
];

const MEDAL: Record<number, { bg: string; label: string }> = {
  1: { bg: "#F5B700", label: "Gold" },
  2: { bg: "#D5D0C8", label: "Silver" },
  3: { bg: "#D9915B", label: "Bronze" },
};

export function RankMedal({ rank }: { rank: number }) {
  const medal = MEDAL[rank];
  return (
    <span
      className="grid h-11 w-11 shrink-0 place-items-center font-heading text-lg font-semibold text-bark-900"
      style={{ clipPath: HEX_CLIP, background: medal?.bg ?? "var(--ht-surface)", color: medal ? "#3B2414" : "var(--ht-fg)" }}
      aria-label={medal ? `${medal.label} medal, rank ${rank}` : `Rank ${rank}`}
    >
      {rank}
    </span>
  );
}

export function Leaderboard() {
  const [type, setType] = useState<LeaderboardType>("games");
  const [period, setPeriod] = useState<LeaderboardPeriod>("week");
  const unit = TYPES.find((t) => t.value === type)!.unit;

  const { data, isLoading, isError, refetch } = useQuery({ queryKey: keys.leaderboard(type, period), queryFn: () => leaderboard.get(type, period) });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-heading text-3xl font-semibold">🏆 Leaderboard</h1>
        <Segmented label="Time period" value={period} onChange={setPeriod} items={PERIODS} />
      </div>
      <Tabs idPrefix="lb" label="Leaderboards" value={type} onChange={setType} items={TYPES.map(({ value, label }) => ({ value, label }))} />
      {TYPES.map((t) => (
        <TabPanel key={t.value} idPrefix="lb" value={t.value} active={type === t.value}>
          {isLoading ? (
            <RowSkeleton rows={6} />
          ) : isError ? (
            <ErrorState onRetry={() => refetch()} />
          ) : !data?.items.length ? (
            <EmptyState title="Nobody here yet" description="Like, review and comment to get on the board." emoji="🏆" />
          ) : (
            <ol className="space-y-2" aria-label={`${t.label}, ${PERIODS.find((p) => p.value === period)!.label}`} data-testid="leaderboard-list">
              {data.items.map((e) => (
                <Row key={`${e.rank}-${e.game?.id ?? e.user?.id}`} entry={e} unit={unit} />
              ))}
            </ol>
          )}
        </TabPanel>
      ))}
    </div>
  );
}

function Row({ entry, unit }: { entry: LeaderboardEntry; unit: string }) {
  const top = entry.rank <= 3;
  return (
    <li className={`flex items-center gap-4 rounded-lg border-2 p-3 ${top ? "border-primary bg-surface" : "border-line bg-raised"}`} data-testid="leaderboard-row">
      <RankMedal rank={entry.rank} />
      {entry.game ? (
        <>
          <img src={entry.game.cover?.thumb} alt="" width={96} height={54} className="hidden h-[54px] w-24 rounded-md object-cover sm:block" />
          <div className="min-w-0 flex-1">
            <Link href={`/games/${entry.game.slug}`} className="block truncate font-heading text-lg font-semibold hover:underline">
              {entry.game.title}
            </Link>
            <Link href={`/u/${entry.game.owner.username}`} className="text-sm text-muted hover:underline">
              by {entry.game.owner.displayName}
            </Link>
          </div>
        </>
      ) : (
        entry.user && (
          <>
            <HexAvatar src={entry.user.avatarUrl} name={entry.user.displayName} size="md" />
            <div className="min-w-0 flex-1">
              <Link href={`/u/${entry.user.username}`} className="block truncate font-heading text-lg font-semibold hover:underline">
                {entry.user.displayName}
              </Link>
              <p className="text-sm text-muted">@{entry.user.username}</p>
            </div>
          </>
        )
      )}
      <p className="text-right">
        <span className="block font-heading text-2xl font-semibold tabular-nums">{compactNumber(entry.score)}</span>
        <span className="text-xs text-muted">{unit}</span>
      </p>
    </li>
  );
}
