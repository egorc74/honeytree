import type { ApiErrorBody } from "./types";

/** Browser: same-origin (rewritten to the API). Server: absolute internal URL. */
export function apiBase(): string {
  if (typeof window !== "undefined") return process.env.NEXT_PUBLIC_API_BASE ?? "/api/v1";
  const origin = process.env.API_ORIGIN ?? "http://localhost:4000";
  return `${origin}/api/v1`;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Query = Record<string, string | number | boolean | undefined | null | string[]>;

export function buildQuery(query?: Query): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.join(","));
    } else params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
  /** Forwarded cookie header for server-side calls. */
  headers?: Record<string, string>;
}

/** Fired when any call returns 401, so the UI can open the login modal. */
export const UNAUTHORIZED_EVENT = "honeytree:unauthorized";

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", query, body, signal, headers } = opts;
  const res = await fetch(`${apiBase()}${path}${buildQuery(query)}`, {
    method,
    credentials: "include",
    signal,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      Accept: "application/json",
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }

  if (!res.ok) {
    const err = (data as ApiErrorBody | undefined)?.error;
    if (res.status === 401 && typeof window !== "undefined" && path !== "/auth/me" && path !== "/auth/login") {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    }
    throw new ApiError(res.status, err?.code ?? "UNKNOWN", err?.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}
