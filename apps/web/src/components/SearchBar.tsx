/* eslint-disable @next/next/no-img-element */
"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { search } from "@/lib/api/endpoints";
import { keys } from "@/lib/api/keys";
import { HexAvatar, cx } from "./ui";

interface Option {
  id: string;
  kind: "game" | "user" | "all";
  label: string;
  sub?: string;
  img?: string | null;
  href: string;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function SearchBarInner({ className }: { className?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [text, setText] = useState(params.get("q") ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const debounced = useDebounced(text.trim(), 200);

  // Keep the box in sync with the URL on the results page.
  const urlQ = params.get("q");
  useEffect(() => {
    if (urlQ !== null) setText(urlQ);
  }, [urlQ]);

  const { data, isFetching } = useQuery({
    queryKey: keys.suggest(debounced),
    queryFn: ({ signal }) => search.suggest(debounced, signal),
    enabled: debounced.length >= 2,
    staleTime: 60_000,
  });

  const options = useMemo<Option[]>(() => {
    if (debounced.length < 2) return [];
    const list: Option[] = [];
    data?.games.forEach((g) => list.push({ id: `g-${g.id}`, kind: "game", label: g.title, sub: g.tags.slice(0, 2).map((t) => `#${t}`).join(" "), img: g.cover?.thumb, href: `/games/${g.slug}` }));
    data?.users.forEach((u) => list.push({ id: `u-${u.id}`, kind: "user", label: u.displayName, sub: `@${u.username}`, img: u.avatarUrl, href: `/u/${u.username}` }));
    list.push({ id: "all", kind: "all", label: `See all results for “${debounced}”`, href: `/search?q=${encodeURIComponent(debounced)}` });
    return list;
  }, [data, debounced]);

  useEffect(() => setActive(-1), [options]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (options.length ? (i + 1) % options.length : -1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (options.length ? (i <= 0 ? options.length - 1 : i - 1) : -1));
    } else if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = options[active];
      if (opt) go(opt.href);
      else if (text.trim()) go(`/search?q=${encodeURIComponent(text.trim())}`);
    }
  }

  const listId = `${baseId}-list`;
  const showList = open && debounced.length >= 2;
  const games = options.filter((o) => o.kind === "game");
  const users = options.filter((o) => o.kind === "user");
  const all = options.find((o) => o.kind === "all");

  const renderOption = (o: Option) => (
    <li
      key={o.id}
      id={`${baseId}-${o.id}`}
      role="option"
      aria-selected={options[active]?.id === o.id}
      onMouseEnter={() => setActive(options.indexOf(o))}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => go(o.href)}
      className={cx("flex cursor-pointer items-center gap-3 px-3 py-2", options[active]?.id === o.id ? "bg-primary text-primary-fg" : "text-fg")}
    >
      {o.kind === "game" && (o.img ? <img src={o.img} alt="" width={56} height={32} className="h-8 w-14 rounded object-cover" /> : <span className="h-8 w-14 rounded bg-surface" />)}
      {o.kind === "user" && <HexAvatar src={o.img} name={o.label} size="xs" ring={false} />}
      {o.kind === "all" && <span aria-hidden>🔍</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{o.label}</span>
        {o.sub && <span className="block truncate text-xs opacity-80">{o.sub}</span>}
      </span>
    </li>
  );

  return (
    <div ref={wrapRef} className={cx("relative w-full", className)}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (options[active]) go(options[active].href);
          else if (text.trim()) go(`/search?q=${encodeURIComponent(text.trim())}`);
        }}
      >
        <label htmlFor={`${baseId}-input`} className="sr-only">
          Search games and creators
        </label>
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-bark-700" aria-hidden>
          🔍
        </span>
        <input
          id={`${baseId}-input`}
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 && options[active] ? `${baseId}-${options[active].id}` : undefined}
          autoComplete="off"
          placeholder="Search games and creators…"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="h-10 w-full rounded-pill border-2 border-transparent bg-comb-50 pl-10 pr-4 text-bark-900 placeholder:text-bark-700 focus:border-honey-500"
        />
      </form>

      <ul
        id={listId}
        role="listbox"
        aria-label="Search suggestions"
        hidden={!showList}
        className="absolute left-0 right-0 top-12 z-40 max-h-[70vh] overflow-auto rounded-lg border-2 border-line bg-bg py-1 shadow-comb"
      >
        {isFetching && !data && <li className="px-3 py-2 text-sm text-muted" role="presentation">Searching…</li>}
        {games.length > 0 && <li role="presentation" className="px-3 pb-1 pt-2 font-heading text-xs uppercase tracking-wide text-muted">Games</li>}
        {games.map(renderOption)}
        {users.length > 0 && <li role="presentation" className="px-3 pb-1 pt-2 font-heading text-xs uppercase tracking-wide text-muted">Creators</li>}
        {users.map(renderOption)}
        {!isFetching && games.length + users.length === 0 && <li role="presentation" className="px-3 py-2 text-sm text-muted">No quick matches. Press Enter to search.</li>}
        {all && renderOption(all)}
      </ul>
      <div className="sr-only" aria-live="polite">
        {showList && !isFetching ? `${games.length + users.length} suggestions` : ""}
      </div>
    </div>
  );
}

export function SearchBar(props: { className?: string }) {
  return (
    <Suspense fallback={<div className={cx("h-10 w-full rounded-pill bg-comb-50", props.className)} />}>
      <SearchBarInner {...props} />
    </Suspense>
  );
}
