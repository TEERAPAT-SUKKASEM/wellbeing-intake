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

export type Identity = {
  identityRef: string;
  email: string;
  displayName: string;
  kind: "student" | "staff";
};

export type CookieToSet = { name: string; value: string; options?: Record<string, unknown> };

export type IdentityResult = {
  identity: Identity | null;
  via: "bearer" | "cookie" | null;
  /** Session-refresh cookies the response must carry (fixture mode only). */
  setCookies: CookieToSet[];
};

const CAMPUS_COOKIE = "campus_token";

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

function bearerToken(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (!h || !h.toLowerCase().startsWith("bearer ")) return null;
  const token = h.slice(7).trim();
  return token || null;
}

/** A cookie-backed Supabase Auth client bound to one request. */
export function sessionClient(req: Request, setCookies: CookieToSet[]) {
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => parseCookieHeader(req.headers.get("cookie")),
      setAll: (list) => {
        for (const c of list) setCookies.push({ name: c.name, value: c.value, options: c.options });
      },
    },
  });
}

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

async function resolveFixture(req: Request): Promise<IdentityResult> {
  const setCookies: CookieToSet[] = [];
  const token = bearerToken(req);
  if (token) {
    const { data, error } = await db().auth.getUser(token);
    if (error || !data.user) return { identity: null, via: null, setCookies };
    const identity = fromFixtureUser(data.user);
    return { identity, via: identity ? "bearer" : null, setCookies };
  }
  const client = sessionClient(req, setCookies);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return { identity: null, via: null, setCookies };
  const identity = fromFixtureUser(data.user);
  return { identity, via: identity ? "cookie" : null, setCookies };
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

async function resolveCampus(req: Request): Promise<IdentityResult> {
  const setCookies: CookieToSet[] = [];
  const bearer = bearerToken(req);
  const cookie = parseCookieHeader(req.headers.get("cookie")).find((c) => c.name === CAMPUS_COOKIE)?.value;
  const token = bearer ?? cookie ?? null;
  if (!token) return { identity: null, via: null, setCookies };

  try {
    jwks ??= createRemoteJWKSet(new URL(env.identityJwksUrl));
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

export async function resolveIdentity(req: Request): Promise<IdentityResult> {
  return env.identityMode === "campus" ? resolveCampus(req) : resolveFixture(req);
}
