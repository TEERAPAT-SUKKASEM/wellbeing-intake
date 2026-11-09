import { z } from "zod";
import { HttpError, route } from "@/lib/http";
import { env } from "@/lib/env";
import { sessionClient } from "@/lib/identity/adapter";

// Staff sign-in and sign-out, in fixture mode. In campus mode sign-in belongs to the identity
// provider, so these endpoints answer 404 rather than pretend to be one. Students never sign in.

const credentials = z.object({ email: z.email(), password: z.string().min(1).max(200) }).strict();

// A tiny in-memory throttle on sign-in attempts. Per instance and demo-grade.
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;

/** Read-only: is this key locked out right now? Also sweeps expired entries so the map stays small. */
function throttled(key: string): boolean {
  const now = Date.now();
  for (const [k, v] of attempts) if (v.resetAt < now) attempts.delete(k);
  const entry = attempts.get(key);
  return !!entry && entry.count >= MAX_ATTEMPTS;
}

/** Only FAILED sign-ins count, so nobody can lock an account out with successful or rejected posts. */
function recordFailure(key: string): void {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  else entry.count++;
}

export const POST = route({
  access: "public",
  body: credentials,
  handler: async ({ req, body, identity }) => {
    if (env.identityMode !== "fixture") throw new HttpError(404, { error: "not_found" });

    // Origin first, so rejected cross-origin posts never count towards the throttle.
    const origin = req.headers.get("origin");
    const allowed = env.appOrigin || new URL(req.url).origin;
    if (origin && origin !== allowed) throw new HttpError(403, { error: "cross_origin_rejected" });

    const key = body.email.toLowerCase();
    if (throttled(key)) throw new HttpError(429, { error: "too_many_attempts" });

    // Cookies the auth client sets land in identity.setCookies; route() serialises them.
    const client = sessionClient(req, identity.setCookies);
    const { data, error } = await client.auth.signInWithPassword(body);
    if (error || !data.session) {
      recordFailure(key);
      throw new HttpError(401, { error: "invalid_credentials" });
    }
    attempts.delete(key);

    return { json: { ok: true, accessToken: data.session.access_token, expiresAt: data.session.expires_at } };
  },
});

export const DELETE = route({
  access: "public",
  handler: async ({ req, identity }) => {
    if (env.identityMode !== "fixture") throw new HttpError(404, { error: "not_found" });
    const client = sessionClient(req, identity.setCookies);
    await client.auth.signOut();
    return { json: { ok: true } };
  },
});
