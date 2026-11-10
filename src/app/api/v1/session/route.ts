// POST /api/v1/session: staff sign-in with email and password.
// DELETE /api/v1/session: staff sign-out.
// Who can call it: public (this is how staff sign in). Students never use it.
// What it does: POST checks the call comes from our own website, applies a small throttle per email,
//   then signs in through Supabase Auth, which sets HttpOnly session cookies (cookies page scripts
//   cannot read). DELETE signs out and clears those cookies. Both only work in "fixture" mode.
// Returns: POST 200 { ok, accessToken, expiresAt }; 400 validation_failed; 401 invalid_credentials;
//   403 cross_origin_rejected; 429 too_many_attempts. DELETE 200 { ok: true }. 404 in campus mode.
import { z } from "zod";
import { HttpError, route } from "@/lib/http";
import { env } from "@/lib/env";
import { sessionClient } from "@/lib/identity/adapter";

// Staff sign-in and sign-out, in fixture mode. In campus mode sign-in belongs to the identity
// provider, so these endpoints answer 404 rather than pretend to be one. Students never sign in.
// ("fixture" mode uses seeded demo staff accounts in Supabase Auth; this is what the deployment runs.)

// zod schema (a rule list that checks the JSON body): exactly an email and a password, nothing else.
// The 200-character cap stops very large bodies.
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

    // route() checks the Origin only for signed-in writes, and this route is public, so it checks here.
    // It stops another website from silently signing a browser in. A call with no Origin header at all
    // (a script or a test tool, not a browser form) is let through.
    // Origin first, so rejected cross-origin posts never count towards the throttle.
    const origin = req.headers.get("origin");
    const allowed = env.appOrigin || new URL(req.url).origin;
    if (origin && origin !== allowed) throw new HttpError(403, { error: "cross_origin_rejected" });

    // The throttle counts per email, lower-cased so "A@x.com" and "a@x.com" share one counter.
    const key = body.email.toLowerCase();
    if (throttled(key)) throw new HttpError(429, { error: "too_many_attempts" });

    // Cookies the auth client sets land in identity.setCookies; route() serialises them.
    const client = sessionClient(req, identity.setCookies);
    const { data, error } = await client.auth.signInWithPassword(body);
    // One general 401 for every failure, so the reply never says whether the email exists.
    if (error || !data.session) {
      recordFailure(key);
      throw new HttpError(401, { error: "invalid_credentials" });
    }
    // A successful sign-in clears this email's failure count.
    attempts.delete(key);

    // accessToken is for API tools that send "Authorization: Bearer"; the web app uses the cookie.
    return { json: { ok: true, accessToken: data.session.access_token, expiresAt: data.session.expires_at } };
  },
});

export const DELETE = route({
  access: "public",
  handler: async ({ req, identity }) => {
    if (env.identityMode !== "fixture") throw new HttpError(404, { error: "not_found" });
    // signOut() ends the session in Supabase Auth; the cookie-clearing headers go out through route().
    const client = sessionClient(req, identity.setCookies);
    await client.auth.signOut();
    return { json: { ok: true } };
  },
});
