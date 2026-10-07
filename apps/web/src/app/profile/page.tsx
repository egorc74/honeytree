"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Button, EmptyState, Skeleton } from "@/components/ui";

/** The "Profile" tab: sends you to your own profile, or asks you to log in. */
export default function MyProfileRedirect() {
  const { me, loading, openLogin } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (me) router.replace(`/u/${me.username}`);
  }, [me, router]);

  if (loading || me) return <Skeleton className="h-64 w-full" />;
  return (
    <EmptyState
      title="Log in to see your profile"
      description="Your games, reviews, karma and stats live here."
      emoji="🍯"
      action={
        <div className="flex gap-2">
          <Button onClick={() => openLogin("login")}>Log in</Button>
          <Button variant="secondary" onClick={() => openLogin("register")}>
            Create account
          </Button>
        </div>
      }
    />
  );
}
