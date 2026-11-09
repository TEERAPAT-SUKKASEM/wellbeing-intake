// Browser-side fetch helper. Holds no credential: the session lives in HttpOnly cookies
// and every permission check happens server-side (FR-21).

export type ApiResult<T> = {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
  fields?: string[];
};

export type ApiInit = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

export async function api<T = unknown>(
  path: string,
  init?: ApiInit,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`/api/v1${path}`, {
      method: init?.method ?? "GET",
      headers: {
        ...(init?.body !== undefined
          ? { "content-type": "application/json" }
          : {}),
        ...init?.headers,
      },
      signal: init?.signal,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      credentials: "same-origin",
    });
    const json = (await res.json().catch(() => null)) as
      (T & { error?: string; fields?: string[] }) | null;
    return {
      ok: res.ok,
      status: res.status,
      data: res.ok ? json : (json as T | null),
      error: res.ok ? null : (json?.error ?? "request_failed"),
      fields: json?.fields,
    };
  } catch {
    return { ok: false, status: 0, data: null, error: "network_error" };
  }
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
