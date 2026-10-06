"use client";

import { useRef } from "react";
import type { Game } from "@/lib/api/types";
import { GameCard } from "../GameCard";
import { cx } from "../ui";

/** Horizontal scroll-snap carousel. Native scrolling + prev/next buttons; slides stay keyboard reachable. */
export function BuzzingCarousel({ games }: { games: Game[] }) {
  const ref = useRef<HTMLUListElement>(null);

  function scrollBy(dir: 1 | -1) {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: reduce ? "auto" : "smooth" });
  }

  const btn =
    "absolute top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full border-2 border-line bg-raised text-xl shadow-comb hover:bg-primary hover:text-primary-fg md:grid";

  return (
    <div role="region" aria-roledescription="carousel" aria-label="Buzzing now" className="relative">
      <button type="button" aria-label="Previous games" onClick={() => scrollBy(-1)} className={cx(btn, "-left-4")}>
        ‹
      </button>
      <ul
        ref={ref}
        className="-mx-1 flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-smooth px-1 pb-3 [scrollbar-width:thin]"
        data-testid="buzzing-carousel"
      >
        {games.map((g, i) => (
          <li key={g.id} className="w-[78%] shrink-0 snap-start sm:w-[44%] lg:w-[31%]" role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${games.length}`}>
            <GameCard game={{ ...g, badge: "buzzing" }} priority={i < 3} />
          </li>
        ))}
      </ul>
      <button type="button" aria-label="Next games" onClick={() => scrollBy(1)} className={cx(btn, "-right-4")}>
        ›
      </button>
    </div>
  );
}
