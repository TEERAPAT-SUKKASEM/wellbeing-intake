// What this file does: checks a staff member's sign-in (a session cookie or a bearer token) and says
// who they are.
// Why it exists: all credential checks live in one place, and only a few fields (id, email, name, kind)
// leave it, so the rest of the app never handles raw tokens or full user records.
// Used by: route() in src/lib/http.ts (resolveIdentity) and the sign-in route
// src/app/api/v1/session/route.ts (sessionClient).
import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "@/lib/env";
import { db } from "@/lib/supabase/admin";

// Staff sign-in only: students are anonymous and never reach this module. It is the ONLY module that
// verifies a credential. Two modes, one shape:
//   fixture: Supabase Auth demo accounts (what the deployment runs)
//   campus:  a campus identity provider's access tokens, verified against its published key set
// Only the required contact and access claims leave this module.
//
// The mode is chosen by the IDENTITY_MODE setting. Fixture mode is for the demo: test accounts made by
// our seed script. Campus mode is for a real university login; the code is ready but untested.

// The only facts about a signed-in person that the rest of the app ever sees.
export type Identity = {
  identityRef: string;
  email: string;
  displayName: string;
  kind: "student" | "staff";
};

// A cookie the response must set. route() turns it into a Set-Cookie header.
export type CookieToSet = { name: string; value: string; options?: Record<string, unknown> };

// "via" records how the person proved who they are. route() needs it: only cookie-based writes get
// the same-origin check.
export type IdentityResult = {
  identity: Identity | null;
  via: "bearer" | "cookie" | null;
  /** Session-refresh cookies the response must carry (fixture mode only). */
  setCookies: CookieToSet[];
};

// In campus mode the browser may keep the identity provider's token in this cookie.
const CAMPUS_COOKIE = "campus_token";

/** Splits a raw Cookie header ("a=1; b=2") into a list of name and value pairs. */
export function parseCookieHeader(header: string | null): { name: string; value: string }[] {
  if (!header) return [];
  return header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const i = part.indexOf("=");
      const name = i === -1 ? part : part.slice(0, i);
      const raw = i === -1 ? "" : part.slice(i + 1);
      let value = raw;
      try {
        value = decodeURIComponent(raw);
      } catch {
        // keep the raw value
      }
      return { name, value };
    });
}

// Reads the token from "Authorization: Bearer <token>". Returns null if it is missing or empty.
function bearerToken(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (!h || !h.toLowerCase().startsWith("bearer ")) return null;
  const token = h.slice(7).trim();
  return token || null;
}

/** A cookie-backed Supabase Auth client bound to one request. */
export function sessionClient(req: Request, setCookies: CookieToSet[]) {
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    // getAll reads the session from the request's cookies. setAll collects new or refreshed cookies,
    // and route() sends them back on the response.
    cookies: {
      getAll: () => parseCookieHeader(req.headers.get("cookie")),
      setAll: (list) => {
        for (const c of list) setCookies.push({ name: c.name, value: c.value, options: c.options });
      },
    },
  });
}

// The parts of a Supabase Auth user record that we read.
type FixtureUser = {
  id: string;
  email?: string | null;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
};

function fromFixtureUser(user: FixtureUser): Identity | null {
  // Only seeded fixture users carry app_metadata.kind (set by the service role in scripts/seed.ts;
  // users cannot edit app_metadata). An account created any other way — e.g. a self-signup on a
  // project where signups were left on — gets no identity at all.
  const kind = user.app_metadata?.kind;
  if (kind !== "student" && kind !== "staff") return null;
  // Anything else Supabase Auth knows about the user is discarded here.
  return {
    identityRef: user.id,
    email: user.email ?? "",
    displayName: String(user.user_metadata?.display_name ?? "Demo user"),
    kind,
  };
}

// Fixture mode: accounts live in Supabase Auth. A bearer token (used by scripts and tests) is checked
// first; without one we use the session cookie that the sign-in route set.
async function resolveFixture(req: Request): Promise<IdentityResult> {
  const setCookies: CookieToSet[] = [];
  const token = bearerToken(req);
  if (token) {
    // getUser asks Supabase Auth itself to check the token, so a forged or expired token is refused.
    const { data, error } = await db().auth.getUser(token);
    if (error || !data.user) return { identity: null, via: null, setCookies };
    const identity = fromFixtureUser(data.user);
    return { identity, via: identity ? "bearer" : null, setCookies };
  }
  // No bearer token: read the session cookie. Supabase may refresh the session here, and any new
  // cookies are collected in setCookies.
  const client = sessionClient(req, setCookies);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return { identity: null, via: null, setCookies };
  const identity = fromFixtureUser(data.user);
  return { identity, via: identity ? "cookie" : null, setCookies };
}

// JWKS (JSON Web Key Set) is the identity provider's published list of public keys. We create the
// key set once and reuse it; the jose library fetches and caches the keys.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

// Campus mode: the token is a JWT (JSON Web Token: signed JSON data) made by the campus identity
// provider. A bearer header wins over the cookie.
async function resolveCampus(req: Request): Promise<IdentityResult> {
  const setCookies: CookieToSet[] = [];
  const bearer = bearerToken(req);
  const cookie = parseCookieHeader(req.headers.get("cookie")).find((c) => c.name === CAMPUS_COOKIE)?.value;
  const token = bearer ?? cookie ?? null;
  if (!token) return { identity: null, via: null, setCookies };

  try {
    jwks ??= createRemoteJWKSet(new URL(env.identityJwksUrl));
    // jwtVerify checks the signature with the provider's public key, the expiry time, the issuer
    // (who made the token) and the audience (that the token was made for this app).
    const { payload } = await jwtVerify(token, jwks, {
      issuer: env.identityIssuer,
      audience: env.identityAudience,
    });
    if (!payload.sub) return { identity: null, via: null, setCookies };
    // Assumption: campus tokens carry sub, email, name and a roles array. Never tested against a real provider.
    const roles = Array.isArray(payload.roles) ? payload.roles.map(String) : [];
    return {
      identity: {
        identityRef: payload.sub,
        email: typeof payload.email === "string" ? payload.email : "",
        displayName: typeof payload.name === "string" ? payload.name : "Campus user",
        kind: roles.includes("student") ? "student" : "staff",
      },
      via: bearer ? "bearer" : "cookie",
      setCookies,
    };
  } catch {
    // bad signature, wrong issuer/audience, expired — all the same to the caller
    return { identity: null, via: null, setCookies };
  }
}

/** Checks the staff sign-in on a request, using the mode set by IDENTITY_MODE (fixture or campus). */
export async function resolveIdentity(req: Request): Promise<IdentityResult> {
  return env.identityMode === "campus" ? resolveCampus(req) : resolveFixture(req);
}
