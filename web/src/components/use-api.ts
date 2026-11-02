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
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
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

/** Loads `url` (skipped when null) and exposes loading/error state plus reload(). */
export function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(!!url);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!url) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiGet<T>(url)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
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
