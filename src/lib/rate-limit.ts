// What this file does: counts hits per caller address and tells a route when that address has reached
// its limit.
// Why it exists: anonymous routes have no account to block, so we slow down abuse (spam bookings,
// guessing access keys, using up the AI budget) by network address instead.
// Used by: POST /requests, GET /requests/me, POST /requests/{id}/cancel, POST /triage/assess and
// POST /finder/suggest.
//
// A small in-memory limiter for anonymous routes. Per server instance and demo-grade, but it means an
// address is only ever held in memory: it is never written to the database or to a log line. The hourly
// cap in the database (consume_request_budget) is the backstop across instances.

// One "bucket" per scope and address, e.g. "key-failure:203.0.113.5": the number of hits so far and
// when the count resets. It is a plain Map, so it is lost when the server restarts.
// Memory only is a privacy choice: an IP address could help identify a student, so we never save it.
const buckets = new Map<string, { count: number; resetAt: number }>();

// Counts reset after 10 minutes.
export const RATE_WINDOW_MS = 10 * 60_000;

// Deletes buckets whose window has ended, so an address does not stay in memory longer than needed.
function sweep(now: number) {
  for (const [key, bucket] of buckets) if (bucket.resetAt < now) buckets.delete(key);
}

/** True when this address has already used up its limit in this scope. It does not add a hit. */
export function isLimited(scope: string, key: string, limit: number, now = Date.now()): boolean {
  sweep(now);
  const bucket = buckets.get(`${scope}:${key}`);
  return !!bucket && bucket.count >= limit;
}

// Checking (isLimited) and counting (addHit) are separate on purpose: a route can count only some
// events. For example, only WRONG access keys count, so a student who keeps checking their own status
// is never blocked.
/** Records one hit. Starts a new 10-minute window if there is none yet or the old one has ended. */
export function addHit(scope: string, key: string, now = Date.now(), windowMs = RATE_WINDOW_MS): void {
  const id = `${scope}:${key}`;
  const bucket = buckets.get(id);
  if (!bucket || bucket.resetAt < now) buckets.set(id, { count: 1, resetAt: now + windowMs });
  else bucket.count++;
}

// The hosting platform (Vercel) sets x-forwarded-for; its first entry is the original caller.
// With no header, every such caller shares the one "unknown" bucket.
/** The address the platform reports for this caller. */
export function clientAddress(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
