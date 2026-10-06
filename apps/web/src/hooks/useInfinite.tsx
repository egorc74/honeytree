"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui";

/** Calls `onVisible` when the sentinel scrolls into view; also renders an accessible "Load more" button. */
export function LoadMore({
  hasMore,
  loading,
  onLoadMore,
  label = "Load more",
}: {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onLoadMore);
  cb.current = onLoadMore;

  useEffect(() => {
    const el = ref.current;
    if (!el || !hasMore || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !loading) cb.current();
      },
      { rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading]);

  if (!hasMore) return null;
  return (
    <div ref={ref} className="flex justify-center py-6">
      <Button variant="secondary" onClick={onLoadMore} loading={loading}>
        {label}
      </Button>
    </div>
  );
}
