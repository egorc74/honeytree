import type { Metadata, Viewport } from "next";
import "@honeytree/ui-tokens/theme.css";
import "./globals.css";
import { BottomTabBar } from "@/components/Nav";
import { SkipLink } from "@/components/SkipLink";
import { Providers } from "@/components/Providers";
import { themeInitScript } from "@/components/ThemeToggle";
import { TopBar } from "@/components/TopBar";
import { SITE_URL } from "@/lib/site";


export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Honeytree: games made by humans, found by gamers", template: "%s · Honeytree" },
  description: "Discover, download, like and review indie games, and share your own with the hive.",
  openGraph: { siteName: "Honeytree", type: "website" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#3B2414" },
    { media: "(prefers-color-scheme: dark)", color: "#3B2414" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <SkipLink />
        <Providers>
          <TopBar />
          <main id="main" tabIndex={-1} className="mx-auto max-w-7xl px-4 pb-28 pt-6 focus:outline-none md:pb-12">
            {children}
          </main>
          <BottomTabBar />
        </Providers>
      </body>
    </html>
  );
}
