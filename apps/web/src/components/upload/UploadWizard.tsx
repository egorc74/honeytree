"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/lib/api/client";
import { games } from "@/lib/api/endpoints";
import { keys } from "@/lib/api/keys";
import type { GameDetail } from "@/lib/api/types";
import { useAuth } from "../AuthProvider";
import { Button, EmptyState, ErrorState, Skeleton, cx, useToast } from "../ui";
import { BuildStep } from "./BuildStep";
import { DetailsStep, emptyDetails, toInput, validateDetails, type DetailsValue } from "./DetailsStep";
import { MediaStep } from "./MediaStep";
import { PreviewStep, publishRequirements } from "./PreviewStep";
import { useUploads } from "./useUploads";

const STEPS = ["Details", "Build", "Media", "Preview"] as const;

export function UploadWizard({ slug: initialSlug }: { slug?: string }) {
  const { me, loading, openLogin } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [slug, setSlug] = useState(initialSlug);
  const [step, setStep] = useState(0);
  const [details, setDetails] = useState<DetailsValue>(emptyDetails);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);

  const query = useQuery({
    queryKey: keys.game(slug ?? "new"),
    queryFn: () => games.get(slug!),
    enabled: !!slug && !!me,
    // Poll while anything is still being scanned/processed so statuses update on their own.
    refetchInterval: (q) => {
      const g = q.state.data;
      if (!g) return false;
      const all = [...g.builds, ...g.screenshots, ...(g.video ? [g.video] : []), ...(g.cover ? [g.cover] : [])];
      return all.some((m) => m.status === "uploading" || m.status === "scanning" || m.status === "processing") ? 1500 : false;
    },
    staleTime: 0,
  });
  const game = query.data;

  // Fill the form once when an existing game loads.
  useEffect(() => {
    if (game && hydratedFor !== game.id) {
      setDetails({ title: game.title, shortDescription: game.shortDescription, description: game.description, tags: game.tags, platforms: game.platforms, version: game.version });
      setHydratedFor(game.id);
    }
  }, [game, hydratedFor]);

  const refresh = useCallback(() => {
    if (slug) void qc.invalidateQueries({ queryKey: keys.game(slug) });
  }, [qc, slug]);

  const uploads = useUploads(game?.id, refresh);

  const saveDetails = useMutation({
    mutationFn: async () => (game ? games.update(game.id, toInput(details)) : games.create(toInput(details))),
    onSuccess: (g) => {
      qc.setQueryData(keys.game(g.slug), g);
      if (!slug) {
        setSlug(g.slug);
        window.history.replaceState(null, "", `/upload/${g.slug}`); // keeps this component mounted
      }
      setStep(1);
    },
    onError: (e) => toast(e instanceof Error ? e.message : "Could not save the details.", "error"),
  });

  const publish = useMutation({
    mutationFn: () => games.publish(game!.id),
    onSuccess: (g) => {
      void qc.invalidateQueries();
      toast("Your game is live! 🐝", "success");
      router.push(`/games/${g.slug}`);
    },
    onError: (e) => toast(e instanceof Error ? e.message : "Could not publish.", "error"),
  });

  if (loading) return <Skeleton className="h-96 w-full" />;
  if (!me)
    return (
      <EmptyState
        title="Log in to upload a game"
        description="You become a creator the moment you publish your first game."
        emoji="🍯"
        action={<Button onClick={() => openLogin("login")}>Log in</Button>}
      />
    );
  if (slug && query.error instanceof ApiError && query.error.status === 404) return <EmptyState title="Game not found" emoji="🔍" />;
  if (slug && query.error) return <ErrorState message="Could not load this game." onRetry={() => query.refetch()} />;
  if (slug && !game) return <Skeleton className="h-96 w-full" />;
  if (game && game.owner.id !== me.id) return <EmptyState title="That’s not your game" description="Only its creator can edit it." emoji="🔒" />;

  function next() {
    if (step === 0) {
      const e = validateDetails(details);
      setErrors(e);
      if (Object.keys(e).length) return;
      saveDetails.mutate();
    } else setStep((s) => Math.min(STEPS.length - 1, s + 1));
  }

  const canPublish = !!game && publishRequirements(game).every((r) => r.done);
  const isLive = game?.status === "published";
  const busyUploads = uploads.pending.some((p) => p.phase !== "rejected");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="font-heading text-3xl font-semibold">{game ? `Edit “${game.title || "Untitled"}”` : "Upload a game"}</h1>

      <nav aria-label="Upload steps">
        <ol className="flex flex-wrap gap-2">
          {STEPS.map((label, i) => {
            const reachable = i === 0 || !!game;
            return (
              <li key={label}>
                <button
                  type="button"
                  disabled={!reachable}
                  aria-current={i === step ? "step" : undefined}
                  onClick={() => (i === 0 || game) && setStep(i)}
                  className={cx(
                    "flex items-center gap-2 rounded-pill border-2 px-4 py-1.5 font-heading font-medium disabled:opacity-50",
                    i === step ? "border-transparent bg-primary text-primary-fg" : "border-line bg-raised",
                  )}
                >
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-bark-900 text-xs text-comb-50" aria-hidden>
                    {i + 1}
                  </span>
                  {label}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <section aria-label={`Step ${step + 1}: ${STEPS[step]}`} className="rounded-xl border-2 border-line bg-surface p-5 sm:p-7">
        {step === 0 && <DetailsStep value={details} onChange={setDetails} errors={errors} />}
        {step === 1 && game && (
          <BuildStep game={game} pending={uploads.pending} onFiles={(f) => uploads.start("build", f)} onDismiss={uploads.dismiss} onChanged={refresh} />
        )}
        {step === 2 && game && (
          <MediaStep
            game={game}
            pending={uploads.pending}
            onDismiss={uploads.dismiss}
            onChanged={refresh}
            onFiles={(kind, files) => uploads.start(kind, files)}
          />
        )}
        {step === 3 && game && <PreviewStep game={game as GameDetail} />}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          ← Back
        </Button>
        <div className="flex items-center gap-3">
          {busyUploads && <span className="text-sm text-muted">Uploads in progress…</span>}
          {step < STEPS.length - 1 ? (
            <Button onClick={next} loading={saveDetails.isPending} data-testid="wizard-next">
              {step === 0 ? "Save & continue →" : "Next →"}
            </Button>
          ) : isLive ? (
            <Button onClick={() => router.push(`/games/${game!.slug}`)}>View game</Button>
          ) : (
            <Button onClick={() => publish.mutate()} loading={publish.isPending} disabled={!canPublish} data-testid="publish-button">
              🐝 Publish game
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
