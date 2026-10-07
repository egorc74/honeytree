import Link from "next/link";
import { AvatarMenu } from "./AvatarMenu";
import { TopTabs } from "./Nav";
import { SearchBar } from "./SearchBar";
import { ThemeToggle } from "./ThemeToggle";
import { Logo } from "./ui";

export function TopBar() {
  return (
    <header className="sticky top-0 z-30 bg-topbar text-topbar-fg shadow-md">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        <Logo />
        <div className="order-3 w-full md:order-none md:max-w-md md:flex-1">
          <SearchBar />
        </div>
        <TopTabs />
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/upload"
            className="hidden h-10 items-center rounded-pill bg-honey-500 px-5 font-heading font-medium text-bark-900 hover:bg-honey-300 md:inline-flex"
          >
            Upload game
          </Link>
          <ThemeToggle />
          <AvatarMenu />
        </div>
      </div>
    </header>
  );
}
