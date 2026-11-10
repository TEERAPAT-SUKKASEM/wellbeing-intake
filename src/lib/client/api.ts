// What this helper does: the one fetch wrapper the browser screens use to call our /api/v1 backend.
// Talks to: whichever /api/v1/* endpoint the caller passes in (same website only).
// Note: it never throws. Every outcome, even "no network", comes back as an ApiResult object.
// Browser-side fetch helper. Holds no credential: the session lives in HttpOnly cookies
// and every permission check happens server-side (FR-21).

/** What every call returns: ok and the HTTP status, plus data, or an error code when it failed. */
export type ApiResult<T> = {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
  // Names of the form fields the server rejected (sent with a 400 validation_failed error).
  fields?: string[];
};

/** Options for api(): HTTP method, JSON body, extra headers (for example X-Access-Key), abort signal. */
export type ApiInit = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

/** Calls `/api/v1` + path and returns an ApiResult. Callers check `ok` instead of catching errors. */
export async function api<T = unknown>(
  path: string,
  init?: ApiInit,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`/api/v1${path}`, {
      method: init?.method ?? "GET",
      // Send a JSON content type only when there is a body. The caller's headers (X-Access-Key,
      // Idempotency-Key) are added after it. Secrets go in headers, never in the URL.
      headers: {
        ...(init?.body !== undefined
          ? { "content-type": "application/json" }
          : {}),
        ...init?.headers,
      },
      signal: init?.signal,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      // no-store: never reuse an old cached answer, because statuses and slots change.
      // same-origin: send the session cookie only to our own website.
      cache: "no-store",
      credentials: "same-origin",
    });
    // Some answers have no JSON body. A parse failure becomes null instead of an exception.
    const json = (await res.json().catch(() => null)) as
      (T & { error?: string; fields?: string[] }) | null;
    // On failure `error` holds the server's code (for example "slot_unavailable").
    // contracts.ts errorMessage() turns that code into a sentence for the user.
    return {
      ok: res.ok,
      status: res.status,
      data: res.ok ? json : (json as T | null),
      error: res.ok ? null : (json?.error ?? "request_failed"),
      fields: json?.fields,
    };
  } catch {
    // fetch only throws when there is no answer at all (offline, blocked). Status 0 means exactly that.
    return { ok: false, status: 0, data: null, error: "network_error" };
  }
}

/** Formats an ISO date in the viewer's own time zone. Campus screens use campusDateTime() instead. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
