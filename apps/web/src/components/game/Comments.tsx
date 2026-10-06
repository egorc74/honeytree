"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { LoadMore } from "@/hooks/useInfinite";
import { useToggleCommentLike } from "@/hooks/useLikes";
import { comments as commentsApi } from "@/lib/api/endpoints";
import { keys } from "@/lib/api/keys";
import type { Comment, CommentKind, GameDetail } from "@/lib/api/types";
import { timeAgo } from "@/lib/format";
import { useAuth } from "../AuthProvider";
import { Badge, Button, EmptyState, HexAvatar, LikeButton, RowSkeleton, TextArea, cx, useToast } from "../ui";
import { ReportButton } from "./ReportButton";

export function Comments({ game }: { game: GameDetail }) {
  const list = useInfiniteQuery({
    queryKey: keys.comments(game.id),
    queryFn: ({ pageParam }) => commentsApi.list(game.id, { cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (l) => l.nextCursor,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section aria-labelledby="comments-heading" className="space-y-5">
      <h2 id="comments-heading" className="font-heading text-2xl font-semibold">
        Comments <span className="text-lg font-normal text-muted">({game.commentsCount})</span>
      </h2>
      <Composer game={game} />
      {list.isLoading ? (
        <RowSkeleton />
      ) : items.length === 0 ? (
        <EmptyState title="No comments yet" description="Say hi, or share an idea with the creator." emoji="💬" />
      ) : (
        <ul className="space-y-5" aria-label="Comments">
          {items.map((c) => (
            <li key={c.id}>
              <CommentItem comment={c} game={game} />
              {!!c.replies?.length && (
                <ul className="mt-3 space-y-3 border-l-2 border-line pl-4 sm:ml-10" aria-label={`Replies to ${c.user.displayName}`}>
                  {c.replies.map((r) => (
                    <li key={r.id}>
                      <CommentItem comment={r} game={game} isReply />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoadMore={() => list.fetchNextPage()} label="More comments" />
    </section>
  );
}

function useComposer(game: GameDetail, parentId?: string, onDone?: () => void) {
  const qc = useQueryClient();
  const { requireAuth } = useAuth();
  const { karma, toast } = useToast();
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<CommentKind>("comment");
  const [error, setError] = useState<string | null>(null);

  const post = useMutation({
    mutationFn: () => commentsApi.create(game.id, { body: body.trim(), kind: parentId ? "comment" : kind, parentId }),
    onSuccess: (res) => {
      setBody("");
      setError(null);
      karma(res.karmaAwarded);
      void qc.invalidateQueries({ queryKey: keys.comments(game.id) });
      void qc.invalidateQueries({ queryKey: keys.game(game.slug) });
      void qc.invalidateQueries({ queryKey: ["user-activity"] });
      onDone?.();
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : "Could not post your comment.");
      toast("Could not post your comment.", "error");
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return setError("Write something first.");
    requireAuth(() => post.mutate());
  }

  return { body, setBody, kind, setKind, error, submit, pending: post.isPending };
}

function Composer({ game }: { game: GameDetail }) {
  const c = useComposer(game);
  return (
    <form onSubmit={c.submit} className="space-y-3 rounded-lg border-2 border-line bg-surface p-4" aria-label="Write a comment">
      <div role="radiogroup" aria-label="Comment type" className="inline-flex rounded-pill border-2 border-line bg-raised p-0.5">
        {(
          [
            ["comment", "💬 Comment"],
            ["suggestion", "💡 Suggestion"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={c.kind === k}
            onClick={() => c.setKind(k)}
            className={cx("rounded-pill px-3 py-1 font-heading text-sm font-medium", c.kind === k ? "bg-primary text-primary-fg" : "hover:bg-surface")}
          >
            {label}
          </button>
        ))}
      </div>
      <TextArea
        label={c.kind === "suggestion" ? "Your suggestion for the creator" : "Your comment"}
        value={c.body}
        onChange={(e) => c.setBody(e.target.value)}
        maxLength={2000}
        error={c.error}
        placeholder={c.kind === "suggestion" ? "I would love it if…" : "Share your thoughts…"}
      />
      <Button type="submit" loading={c.pending}>
        {c.kind === "suggestion" ? "Post suggestion" : "Post comment"}
      </Button>
    </form>
  );
}

function CommentItem({ comment, game, isReply = false }: { comment: Comment; game: GameDetail; isReply?: boolean }) {
  const qc = useQueryClient();
  const { me, requireAuth } = useAuth();
  const { toast } = useToast();
  const toggleLike = useToggleCommentLike();
  const [replying, setReplying] = useState(false);
  const reply = useComposer(game, comment.id, () => setReplying(false));

  const isOwner = me?.id === game.owner.id;
  const mine = me?.id === comment.user.id;
  const deleted = !!comment.deletedAt;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.comments(game.id) });
    void qc.invalidateQueries({ queryKey: keys.game(game.slug) });
  };

  const accept = useMutation({
    mutationFn: () => commentsApi.accept(comment.id),
    onSuccess: () => {
      toast("Suggestion accepted ✅", "success");
      refresh();
    },
    onError: (e) => toast(e instanceof Error ? e.message : "Could not accept.", "error"),
  });
  const remove = useMutation({ mutationFn: () => commentsApi.remove(comment.id), onSuccess: refresh });

  return (
    <article
      data-testid={comment.kind === "suggestion" ? "suggestion" : "comment"}
      className={cx(
        "flex gap-3 rounded-lg border p-4",
        comment.acceptedAt ? "border-success bg-success-bg" : "border-line bg-raised",
      )}
    >
      <HexAvatar src={comment.user.avatarUrl} name={comment.user.displayName} size={isReply ? "sm" : "md"} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link href={`/u/${comment.user.username}`} className="font-heading font-semibold hover:underline">
            {comment.user.displayName}
          </Link>
          {comment.user.id === game.owner.id && <Badge tone="honey">Creator</Badge>}
          {comment.kind === "suggestion" && <Badge tone="honey">💡 Suggestion</Badge>}
          {comment.acceptedAt && <Badge tone="success">✅ Accepted</Badge>}
          <span className="text-sm text-muted">{timeAgo(comment.createdAt)}</span>
        </div>

        {deleted ? <p className="italic text-muted">This comment was deleted.</p> : <p className="whitespace-pre-line break-words">{comment.body}</p>}

        {!deleted && (
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <LikeButton size="sm" label="comment" liked={comment.likedByMe} count={comment.likesCount} onToggle={() => toggleLike(comment)} />
            {!isReply && (
              <button type="button" className="text-sm font-medium text-link underline" aria-expanded={replying} onClick={() => requireAuth(() => setReplying((r) => !r))}>
                Reply
              </button>
            )}
            {isOwner && comment.kind === "suggestion" && !comment.acceptedAt && (
              <Button size="sm" variant="secondary" onClick={() => accept.mutate()} loading={accept.isPending}>
                ✅ Accept suggestion
              </Button>
            )}
            {mine && (
              <button type="button" className="text-sm text-danger underline" onClick={() => remove.mutate()}>
                Delete
              </button>
            )}
            {!mine && <ReportButton targetType="comment" targetId={comment.id} />}
          </div>
        )}

        {replying && (
          <form onSubmit={reply.submit} className="mt-2 space-y-2" aria-label={`Reply to ${comment.user.displayName}`}>
            <TextArea label="Your reply" value={reply.body} onChange={(e) => reply.setBody(e.target.value)} maxLength={2000} error={reply.error} autoFocus />
            <div className="flex gap-2">
              <Button type="submit" size="sm" loading={reply.pending}>
                Reply
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setReplying(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </article>
  );
}
