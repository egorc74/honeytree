"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { keys } from "@/lib/api/keys";
import { AuthForm } from "./AuthForm";

function Inner({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const qc = useQueryClient();
  const next = useSearchParams().get("next");
  // Only allow same-site relative redirects.
  const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  return (
    <div className="mx-auto max-w-md space-y-6 rounded-xl border-2 border-line bg-surface p-6 sm:p-8">
      <div className="space-y-1 text-center">
        <h1 className="font-heading text-3xl font-semibold">{mode === "login" ? "Welcome back" : "Join the hive"}</h1>
        <p className="text-muted">{mode === "login" ? "Log in to like, review, comment and upload." : "One account to play and to create."}</p>
      </div>
      <AuthForm
        mode={mode}
        onModeChange={(m) => router.replace(`/${m}${next ? `?next=${encodeURIComponent(next)}` : ""}`)}
        onSuccess={async (user) => {
          qc.setQueryData(keys.me, user);
          await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "me" });
          router.push(dest);
        }}
      />
    </div>
  );
}

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  return (
    <Suspense>
      <Inner mode={mode} />
    </Suspense>
  );
}
