"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { cx } from "./ui";

export const NAV = [
  { href: "/", label: "Feed", icon: "🐝", match: (p: string) => p === "/" },
  { href: "/leaderboard", label: "Leaderboard", icon: "🏆", match: (p: string) => p.startsWith("/leaderboard") },
  { href: "/profile", label: "Profile", icon: "🍯", match: (p: string, me?: string) => p === "/profile" || (!!me && p === `/u/${me}`) },
] as const;

/** Desktop tabs in the top bar. */
export function TopTabs() {
  const pathname = usePathname();
  const { me } = useAuth();
  return (
    <nav aria-label="Main" className="hidden md:block">
      <ul className="flex items-center gap-1">
        {NAV.map((item) => {
          const active = item.match(pathname, me?.username);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "relative block rounded-pill px-4 py-2 font-heading font-medium transition-colors",
                  active ? "bg-honey-500 text-bark-900" : "text-topbar-fg hover:bg-bark-700",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Mobile bottom tab bar. */
export function BottomTabBar() {
  const pathname = usePathname();
  const { me } = useAuth();
  const left = NAV.slice(0, 2);
  const right = NAV.slice(2);
  const Item = ({ item }: { item: (typeof NAV)[number] }) => {
    const active = item.match(pathname, me?.username);
    return (
      <li className="flex-1">
        <Link
          href={item.href}
          aria-current={active ? "page" : undefined}
          className={cx("flex flex-col items-center gap-0.5 py-2 text-xs font-medium", active ? "text-honey-300" : "text-topbar-fg")}
        >
          <span className={cx("grid h-7 w-12 place-items-center rounded-pill text-lg", active && "bg-bark-700")} aria-hidden>
            {item.icon}
          </span>
          {item.label}
        </Link>
      </li>
    );
  };
  return (
    <nav aria-label="Main (mobile)" className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-bark-700 bg-topbar pb-[env(safe-area-inset-bottom)] md:hidden">
      <ul className="flex items-end">
        {left.map((i) => (
          <Item key={i.href} item={i} />
        ))}
        <li className="flex-1">
          <Link href="/upload" className="flex flex-col items-center gap-0.5 py-2 text-xs font-medium text-topbar-fg">
            <span className="grid h-7 w-12 place-items-center rounded-pill bg-honey-500 text-lg font-bold text-bark-900" aria-hidden>
              +
            </span>
            Upload
          </Link>
        </li>
        {right.map((i) => (
          <Item key={i.href} item={i} />
        ))}
      </ul>
    </nav>
  );
}
