import type { Metadata } from "next";
import { Suspense } from "react";
import { SearchResults } from "@/components/search/SearchResults";

export const metadata: Metadata = { title: "Search", robots: { index: false } };

export default function Page() {
  return (
    <Suspense>
      <SearchResults />
    </Suspense>
  );
}
