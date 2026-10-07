/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Media } from "@/lib/api/types";
import { cx } from "../ui";

export function Gallery({ screenshots, title }: { screenshots: Media[]; title: string }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const triggers = useRef<(HTMLButtonElement | null)[]>([]);

  if (!screenshots.length) return null;

  return (
    <section aria-label="Screenshots">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {screenshots.map((s, i) => (
          <li key={s.id}>
            <button
              ref={(el) => {
                triggers.current[i] = el;
              }}
              type="button"
              onClick={() => setOpenIndex(i)}
              aria-label={`Open screenshot ${i + 1} of ${screenshots.length}`}
              className="group block aspect-video w-full overflow-hidden rounded-md border-2 border-line"
            >
              <img
                src={s.variants.card ?? s.variants.thumb ?? s.variants.full}
                alt={`${title} screenshot ${i + 1}`}
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105 motion-reduce:transition-none"
              />
            </button>
          </li>
        ))}
      </ul>
      {openIndex !== null && (
        <Lightbox
          items={screenshots}
          index={openIndex}
          title={title}
          onIndex={setOpenIndex}
          onClose={() => {
            const i = openIndex;
            setOpenIndex(null);
            requestAnimationFrame(() => triggers.current[i]?.focus());
          }}
        />
      )}
    </section>
  );
}

function Lightbox({
  items,
  index,
  title,
  onIndex,
  onClose,
}: {
  items: Media[];
  index: number;
  title: string;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const go = useCallback((d: number) => onIndex((index + d + items.length) % items.length), [index, items.length, onIndex]);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const item = items[index];
  const btn = "grid h-12 w-12 place-items-center rounded-full bg-bark-900 text-2xl text-comb-50 hover:bg-bark-700";

  return (
    <dialog
      ref={ref}
      aria-label={`${title} screenshots`}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") go(1);
        if (e.key === "ArrowLeft") go(-1);
      }}
      className="m-auto w-[min(96vw,1100px)] max-w-none rounded-xl bg-bark-950 p-3 text-comb-50 backdrop:bg-[rgba(20,10,5,0.85)]"
    >
      <div className="relative">
        <img src={item.variants.full ?? item.variants.card} alt={`${title} screenshot ${index + 1} of ${items.length}`} className="max-h-[80vh] w-full rounded-lg object-contain" />
        <button type="button" onClick={onClose} aria-label="Close lightbox" className={cx(btn, "absolute right-2 top-2 text-xl")}>
          ×
        </button>
        {items.length > 1 && (
          <>
            <button type="button" onClick={() => go(-1)} aria-label="Previous screenshot" className={cx(btn, "absolute left-2 top-1/2 -translate-y-1/2")}>
              ‹
            </button>
            <button type="button" onClick={() => go(1)} aria-label="Next screenshot" className={cx(btn, "absolute right-2 top-1/2 -translate-y-1/2")}>
              ›
            </button>
          </>
        )}
      </div>
      <p className="mt-2 text-center text-sm" aria-live="polite">
        {index + 1} / {items.length}
      </p>
    </dialog>
  );
}
