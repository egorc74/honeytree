"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/components/ui";
import { patchComment, patchGame, restoreQueries, snapshotQueries } from "@/lib/cache";
import { comments, games } from "@/lib/api/endpoints";
import type { Comment, Game } from "@/lib/api/types";

/**
 * Optimistic like toggle for games. Patches every cached copy of the game
 * (feed, search, profile, leaderboard, game page) and rolls back on error.
 * Returns a function: call it with the game as currently displayed.
 */
export function useToggleGameLike() {
  const qc = useQueryClient();
  const { requireAuth } = useAuth();
  const { karma, toast } = useToast();

  const mutation = useMutation({
    mutationFn: ({ game }: { game: Pick<Game, "id" | "likedByMe"> }) => (game.likedByMe ? games.unlike(game.id) : games.like(game.id)),
    onMutate: async ({ game }) => {
      const snap = snapshotQueries(qc);
      patchGame(qc, game.id, (g) => ({ likedByMe: !game.likedByMe, likesCount: Math.max(0, g.likesCount + (game.likedByMe ? -1 : 1)) }));
      return { snap };
    },
    onError: (err, _vars, ctx) => {
      if (ctx) restoreQueries(qc, ctx.snap);
      toast(err instanceof Error ? err.message : "Could not update your like.", "error");
    },
    onSuccess: (res, { game }) => {
      patchGame(qc, game.id, () => ({ likedByMe: res.liked, likesCount: res.likesCount }));
      karma(res.karmaAwarded);
    },
  });

  return (game: Pick<Game, "id" | "likedByMe">) => requireAuth(() => mutation.mutate({ game }));
}

export function useToggleCommentLike() {
  const qc = useQueryClient();
  const { requireAuth } = useAuth();
  const { karma, toast } = useToast();

  const mutation = useMutation({
    mutationFn: ({ comment }: { comment: Pick<Comment, "id" | "likedByMe"> }) =>
      comment.likedByMe ? comments.unlike(comment.id) : comments.like(comment.id),
    onMutate: async ({ comment }) => {
      const snap = snapshotQueries(qc);
      patchComment(qc, comment.id, (c) => ({ likedByMe: !comment.likedByMe, likesCount: Math.max(0, c.likesCount + (comment.likedByMe ? -1 : 1)) }));
      return { snap };
    },
    onError: (err, _vars, ctx) => {
      if (ctx) restoreQueries(qc, ctx.snap);
      toast(err instanceof Error ? err.message : "Could not update your like.", "error");
    },
    onSuccess: (res, { comment }) => {
      patchComment(qc, comment.id, () => ({ likedByMe: res.liked, likesCount: res.likesCount }));
      karma(res.karmaAwarded);
    },
  });

  return (comment: Pick<Comment, "id" | "likedByMe">) => requireAuth(() => mutation.mutate({ comment }));
}
