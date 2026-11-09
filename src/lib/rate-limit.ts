// A small in-memory limiter for anonymous routes. Per server instance and demo-grade, but it means an
// address is only ever held in memory: it is never written to the database or to a log line. The hourly
// cap in the database (consume_request_budget) is the backstop across instances.

const buckets = new Map<string, { count: number; resetAt: number }>();

export const RATE_WINDOW_MS = 10 * 60_000;

function sweep(now: number) {
  for (const [key, bucket] of buckets) if (bucket.resetAt < now) buckets.delete(key);
}

export function isLimited(scope: string, key: string, limit: number, now = Date.now()): boolean {
  sweep(now);
  const bucket = buckets.get(`${scope}:${key}`);
  return !!bucket && bucket.count >= limit;
}

export function addHit(scope: string, key: string, now = Date.now(), windowMs = RATE_WINDOW_MS): void {
  const id = `${scope}:${key}`;
  const bucket = buckets.get(id);
  if (!bucket || bucket.resetAt < now) buckets.set(id, { count: 1, resetAt: now + windowMs });
  else bucket.count++;
}

/** The address the platform reports for this caller. */
export function clientAddress(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
