"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useAuth } from "./AuthProvider";
import { HexAvatar } from "./ui";

export function AvatarMenu() {
  const { me, loading, openLogin, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    items.current[0]?.focus();
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (loading) return <div className="h-10 w-10 animate-pulse rounded-full bg-bark-700" aria-hidden />;

  if (!me) {
    return (
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => openLogin("login")} className="rounded-pill px-3 py-2 font-heading font-medium text-topbar-fg hover:bg-bark-700">
          Log in
        </button>
        <button
          type="button"
          onClick={() => openLogin("register")}
          className="hidden rounded-pill border-2 border-honey-300 px-3 py-1.5 font-heading font-medium text-honey-300 hover:bg-bark-700 sm:inline-block"
        >
          Sign up
        </button>
      </div>
    );
  }

  function onKey(e: KeyboardEvent) {
    const list = items.current.filter(Boolean) as HTMLElement[];
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      setOpen(false);
      (wrap.current?.querySelector("button[aria-haspopup]") as HTMLElement | null)?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      list[(i + 1) % list.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      list[(i - 1 + list.length) % list.length]?.focus();
    }
  }

  const itemClass = "block w-full px-4 py-2 text-left hover:bg-primary hover:text-primary-fg focus-visible:bg-primary focus-visible:text-primary-fg";

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${me.displayName}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => open && onKey(e)}
        className="rounded-full p-0.5"
        data-testid="avatar-menu"
      >
        <HexAvatar src={me.avatarUrl} name={me.displayName} size="sm" />
      </button>
      {open && (
        <div role="menu" aria-label="Account" tabIndex={-1} onKeyDown={onKey} className="absolute right-0 top-12 z-40 w-52 overflow-hidden rounded-lg border-2 border-line bg-bg py-1 text-fg shadow-comb">
          <div className="border-b border-line px-4 py-2">
            <p className="truncate font-heading font-semibold">{me.displayName}</p>
            <p className="truncate text-sm text-muted">@{me.username}</p>
          </div>
          <Link ref={(el) => void (items.current[0] = el)} role="menuitem" href={`/u/${me.username}`} className={itemClass} onClick={() => setOpen(false)}>
            My profile
          </Link>
          <Link ref={(el) => void (items.current[1] = el)} role="menuitem" href="/upload" className={itemClass} onClick={() => setOpen(false)}>
            Upload a game
          </Link>
          <button
            ref={(el) => void (items.current[2] = el)}
            role="menuitem"
            type="button"
            className={itemClass}
            onClick={() => {
              setOpen(false);
              void logout();
            }}
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
