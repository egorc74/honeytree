import type { Metadata } from "next";
import { ProfilePage } from "@/components/profile/ProfilePage";
import { getProfileServer } from "@/lib/api/server";

type Props = { params: Promise<{ username: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  const p = await getProfileServer(username);
  if (!p) return { title: `@${username}` };
  const description = p.bio || `${p.displayName} has published ${p.stats.gamesCount} game${p.stats.gamesCount === 1 ? "" : "s"} on Honeytree.`;
  return {
    title: `${p.displayName} (@${p.username})`,
    description,
    openGraph: { title: `${p.displayName} on Honeytree`, description, images: p.avatarUrl ? [p.avatarUrl] : undefined },
  };
}

export default async function Page({ params }: Props) {
  const { username } = await params;
  const profile = await getProfileServer(username);
  return <ProfilePage username={username} initial={profile} />;
}
