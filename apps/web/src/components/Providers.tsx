"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api/client";
import { AuthProvider } from "./AuthProvider";
import { ToastProvider } from "./ui";

const MOCKING = process.env.NEXT_PUBLIC_API_MOCKING === "enabled";

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
      },
    },
  });
}

/** Starts the in-browser MSW worker (when NEXT_PUBLIC_API_MOCKING=enabled) before rendering the app. */
function MockGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!MOCKING);
  useEffect(() => {
    if (!MOCKING) return;
    let cancelled = false;
    import("@/mocks/browser").then(async ({ worker }) => {
      await worker.start({ onUnhandledRequest: "bypass", quiet: true, serviceWorker: { url: "/mockServiceWorker.js" } });
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center text-muted" role="status">
        Warming up the hive…
      </div>
    );
  }
  return <>{children}</>;
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(makeClient);
  return (
    <QueryClientProvider client={client}>
      <MockGate>
        <ToastProvider>
          <AuthProvider>{children}</AuthProvider>
        </ToastProvider>
      </MockGate>
    </QueryClientProvider>
  );
}
