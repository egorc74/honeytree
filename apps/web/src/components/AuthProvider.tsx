"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { auth } from "@/lib/api/endpoints";
import { UNAUTHORIZED_EVENT } from "@/lib/api/client";
import { keys } from "@/lib/api/keys";
import type { Me } from "@/lib/api/types";
import { AuthForm } from "./AuthForm";
import { Modal } from "./ui";

interface AuthContextValue {
  me: Me | null;
  loading: boolean;
  /** Runs `action` now if logged in; otherwise opens the login modal and runs it after success. */
  requireAuth: (action?: () => void) => boolean;
  openLogin: (mode?: "login" | "register", then?: () => void) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const router = useRouter();
  const { data: me = null, isLoading } = useQuery({ queryKey: keys.me, queryFn: auth.me, staleTime: 5 * 60_000, retry: false });
  const [modal, setModal] = useState<null | "login" | "register">(null);
  const pending = useRef<(() => void) | undefined>(undefined);

  const openLogin = useCallback((mode: "login" | "register" = "login", then?: () => void) => {
    pending.current = then;
    setModal(mode);
  }, []);

  const requireAuth = useCallback(
    (action?: () => void) => {
      if (me) {
        action?.();
        return true;
      }
      openLogin("login", action);
      return false;
    },
    [me, openLogin],
  );

  const logout = useCallback(async () => {
    await auth.logout();
    qc.setQueryData(keys.me, null);
    await qc.invalidateQueries();
    router.push("/");
  }, [qc, router]);

  // Any 401 from the API (expired session) → clear the user and ask to log in again.
  useEffect(() => {
    const onUnauthorized = () => {
      qc.setQueryData(keys.me, null);
      setModal((m) => m ?? "login");
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [qc]);

  const value = useMemo(() => ({ me, loading: isLoading, requireAuth, openLogin, logout }), [me, isLoading, requireAuth, openLogin, logout]);

  return (
    <AuthContext.Provider value={value}>
      {children}
      <Modal
        open={modal !== null}
        onClose={() => {
          setModal(null);
          pending.current = undefined;
        }}
        title={modal === "register" ? "Join the hive" : "Welcome back"}
        description={modal === "register" ? "Create an account to like, review, comment and share your own games." : "Log in to like, review, comment and upload."}
      >
        {modal && (
          <AuthForm
            mode={modal}
            onModeChange={setModal}
            onSuccess={async (user) => {
              qc.setQueryData(keys.me, user);
              await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "me" });
              setModal(null);
              const next = pending.current;
              pending.current = undefined;
              next?.();
            }}
          />
        )}
      </Modal>
    </AuthContext.Provider>
  );
}
