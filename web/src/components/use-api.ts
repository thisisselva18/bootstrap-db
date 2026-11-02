"use client";

import { useCallback, useEffect, useState } from "react";

/** Error carrying the API's message and HTTP status. */
export class ApiClientError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function readJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      // Session expired: a full reload drops all client state before signing in again.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    }
    throw new ApiClientError((body as { error?: string }).error ?? `Request failed (${res.status})`, res.status);
  }
  return body as T;
}

export async function apiGet<T>(url: string): Promise<T> {
  return readJson<T>(await fetch(url, { cache: "no-store" }));
}

export async function apiSend<T = unknown>(method: "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return readJson<T>(res);
}

/**
 * Loads `url` (skipped when null) and exposes loading/error state plus
 * reload(). Previous data stays visible while a new request is in flight.
 */
export function useApi<T>(url: string | null) {
  const [tick, setTick] = useState(0);
  const key = url ? `${url}#${tick}` : null;
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null }>({
    key: null,
    data: null,
    error: null,
  });

  useEffect(() => {
    if (!url || !key) return;
    let cancelled = false;
    apiGet<T>(url)
      .then((d) => {
        if (!cancelled) setState({ key, data: d, error: null });
      })
      .catch((e: Error) => {
        if (!cancelled) setState((s) => ({ key, data: s.data, error: e.message }));
      });
    return () => {
      cancelled = true;
    };
  }, [url, key]);

  const loading = !!key && state.key !== key;
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((data: T) => setState((s) => ({ ...s, data })), []);
  return { data: state.data, error: loading ? null : state.error, loading, reload, setData };
}

/** Builds a query string, dropping empty values. */
export function qs(params: Record<string, string | number | undefined | null | false>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "" && v !== false) sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}
