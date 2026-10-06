import type { Metadata } from "next";
import { GamePage } from "@/components/game/GamePage";
import { getGameServer } from "@/lib/api/server";
import { SITE_URL } from "@/lib/site";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const game = await getGameServer(slug);
  if (!game || game.status !== "published") return { title: "Game", robots: { index: false } };
  const image = game.cover?.full ?? game.cover?.card;
  const description = game.shortDescription || game.description.slice(0, 160);
  return {
    title: game.title,
    description,
    alternates: { canonical: `/games/${game.slug}` },
    openGraph: {
      type: "website",
      title: `${game.title} by ${game.owner.displayName}`,
      description,
      url: `${SITE_URL}/games/${game.slug}`,
      images: image ? [{ url: image, width: 1600, height: 900, alt: `${game.title} cover art` }] : undefined,
    },
    twitter: { card: "summary_large_image", title: game.title, description, images: image ? [image] : undefined },
  };
}

export default async function Page({ params }: Props) {
  const { slug } = await params;
  const game = await getGameServer(slug);

  // schema.org structured data for search engines
  const jsonLd =
    game && game.status === "published"
      ? {
          "@context": "https://schema.org",
          "@type": "VideoGame",
          name: game.title,
          description: game.shortDescription,
          url: `${SITE_URL}/games/${game.slug}`,
          image: game.cover?.full,
          genre: game.tags,
          gamePlatform: game.platforms,
          author: { "@type": "Person", name: game.owner.displayName },
          ...(game.reviewsCount > 0 && game.ratingAvg
            ? { aggregateRating: { "@type": "AggregateRating", ratingValue: game.ratingAvg, reviewCount: game.reviewsCount, bestRating: 5, worstRating: 1 } }
            : {}),
        }
      : null;

  return (
    <>
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />}
      <GamePage slug={slug} initial={game} />
    </>
  );
}
