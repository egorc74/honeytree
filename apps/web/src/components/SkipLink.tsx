"use client";

/** Skip link that also moves focus into <main> (some browsers only scroll for in-page anchors). */
export function SkipLink() {
  return (
    <a
      href="#main"
      onClick={(e) => {
        e.preventDefault();
        const main = document.getElementById("main");
        main?.focus();
        main?.scrollIntoView();
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-pill focus:bg-primary focus:px-4 focus:py-2 focus:font-heading focus:text-primary-fg"
    >
      Skip to content
    </a>
  );
}
