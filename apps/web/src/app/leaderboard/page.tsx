import type { Metadata } from "next";
import { Leaderboard } from "@/components/leaderboard/Leaderboard";

export const metadata: Metadata = {
  title: "Leaderboard",
  description: "The top games, creators and community members on Honeytree this week, this month and of all time.",
};

export default function Page() {
  return <Leaderboard />;
}
