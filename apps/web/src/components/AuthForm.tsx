"use client";

import { useState, type FormEvent } from "react";
import { auth } from "@/lib/api/endpoints";
import { ApiError } from "@/lib/api/client";
import type { User } from "@/lib/api/types";
import { Button, TextField } from "./ui";

const MOCKING = process.env.NEXT_PUBLIC_API_MOCKING === "enabled";

export function AuthForm({
  mode,
  onModeChange,
  onSuccess,
}: {
  mode: "login" | "register";
  onModeChange?: (m: "login" | "register") => void;
  onSuccess: (user: User) => void | Promise<void>;
}) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { user } =
        mode === "login" ? await auth.login({ email, password }) : await auth.register({ username, email, password });
      await onSuccess(user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-label={mode === "login" ? "Log in" : "Create account"}>
      {mode === "register" && (
        <TextField
          label="Username"
          name="username"
          autoComplete="username"
          required
          minLength={3}
          maxLength={24}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          hint="3–24 letters, numbers or underscores."
        />
      )}
      <TextField
        label={mode === "login" ? "Email or username" : "Email"}
        name="email"
        type={mode === "login" ? "text" : "email"}
        autoComplete={mode === "login" ? "username" : "email"}
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete={mode === "login" ? "current-password" : "new-password"}
        required
        minLength={mode === "register" ? 8 : undefined}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        hint={mode === "register" ? "At least 8 characters." : undefined}
      />
      {error && (
        <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" loading={busy} className="w-full" size="lg">
        {mode === "login" ? "Log in" : "Create account"}
      </Button>
      {mode === "login" && MOCKING && (
        <p className="text-center text-sm text-muted">
          Demo account: <code>demo@honeytree.dev</code> / <code>honeytree123</code>
        </p>
      )}
      {onModeChange && (
        <p className="text-center text-sm">
          {mode === "login" ? "New here? " : "Already have an account? "}
          <button type="button" className="font-medium text-link underline" onClick={() => onModeChange(mode === "login" ? "register" : "login")}>
            {mode === "login" ? "Create an account" : "Log in"}
          </button>
        </p>
      )}
    </form>
  );
}
