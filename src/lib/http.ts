// What this file does: route() wraps every API handler and applies the shared rules before and after it
// runs: who may call, input checks, one log line, and the same error format everywhere.
// Why it exists: no route can forget a security or privacy rule. Access is denied unless a route allows it,
// and "missing", "wrong key" and "not your role" all get the same 404, so an answer never leaks a hint.
// Used by: every API route under src/app/api/v1 via route(); the dispatcher and webhook routes also use
// CORRELATION_HEADER, isSafeId and machineAuthorized.
import "server-only";
import { randomUUID } from "node:crypto";
import type { ZodType } from "zod";
import { env } from "@/lib/env";
import { resolveIdentity, type CookieToSet, type IdentityResult } from "@/lib/identity/adapter";
import { resolveCaller, type Caller, type Role } from "@/lib/authz";

// One wrapper gives every route the platform conventions and the default-deny contract,
// so no handler implements them by hand.

// A correlation id is one random id per request. It goes into the log line and the response header,
// so one request can be followed across services without logging any of its content.
export const CORRELATION_HEADER = "x-correlation-id";

/** The single body used for "absent", "wrong key" AND "not for your role". */
export const NOT_FOUND_BODY = { error: "not_found" } as const;

/** An error with an HTTP status and a safe JSON body. route() turns it into the response. */
export class HttpError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown>,
  ) {
    super(String(body.error ?? status));
  }
}

/** Makes the one shared 404 error (see NOT_FOUND_BODY above). */
export const notFound = () => new HttpError(404, NOT_FOUND_BODY);

// Who may call a route: "public" (anyone, no sign-in), "machine" (a server job that holds
// DISPATCH_TOKEN), or a list of staff roles, e.g. ["practitioner"].
type Access = "public" | "machine" | Role[];

export type RouteCtx<B> = {
  req: Request;
  cid: string;
  params: Record<string, string>;
  body: B;
  /** Present for role-protected routes; null on public and machine routes. */
  caller: Caller | null;
  identity: IdentityResult;
};

type HandlerResult = { status?: number; json: unknown; headers?: Record<string, string> };

type RouteOptions<B> = {
  access: Access;
  body?: ZodType<B>;
  handler: (ctx: RouteCtx<B>) => Promise<HandlerResult>;
};

// Ids in the URL may only use letters, digits, "_" and "-", up to 64 characters. Anything else is
// answered as "not found", so strange input never reaches the database.
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** Ids in paths are opaque tokens such as req_3f9a or srv_academic_stress. */
export const isSafeId = (v: unknown): v is string => typeof v === "string" && SAFE_ID_RE.test(v);

// Reuse the caller's correlation id only if it looks safe (8 to 128 plain characters). Otherwise make
// a new one, so a caller cannot write strange text into our logs.
function correlationId(req: Request): string {
  const incoming = req.headers.get(CORRELATION_HEADER);
  return incoming && /^[\w.:-]{8,128}$/.test(incoming) ? incoming : randomUUID();
}

// Turns a cookie into a Set-Cookie header line. We always add HttpOnly (page JavaScript cannot read
// the cookie) and SameSite=Lax (the browser leaves it off most requests that start on another site).
// In production we also add Secure (sent over HTTPS only).
function serializeCookie(c: CookieToSet): string {
  const o = (c.options ?? {}) as Record<string, unknown>;
  const parts = [`${c.name}=${encodeURIComponent(c.value)}`, `Path=${String(o.path ?? "/")}`];
  if (typeof o.maxAge === "number") parts.push(`Max-Age=${Math.floor(o.maxAge)}`);
  if (o.expires instanceof Date) parts.push(`Expires=${o.expires.toUTCString()}`);
  parts.push("HttpOnly", "SameSite=Lax");
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

// Builds the JSON response. "no-store" tells browsers and proxies not to keep a copy, because an
// answer can hold private request details.
function respond(
  status: number,
  json: unknown,
  cid: string,
  setCookies: CookieToSet[] = [],
  extra: Record<string, string> = {},
): Response {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    [CORRELATION_HEADER]: cid,
    ...extra,
  });
  for (const c of setCookies) headers.append("set-cookie", serializeCookie(c));
  return new Response(JSON.stringify(json), { status, headers });
}

/** Logs carry method, path (no query string), status, role and timing: never a body, never content. */
function log(entry: Record<string, unknown>) {
  console.log(JSON.stringify({ t: new Date().toISOString(), svc: "wellbeing", ...entry }));
}

// True only when the browser's Origin header is our own site. This blocks CSRF (cross-site request
// forgery: another website making a signed-in staff browser send a request to us with its cookie).
// A missing Origin header counts as "not ours", so the check fails closed.
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const allowed = env.appOrigin || new URL(req.url).origin;
  return origin === allowed;
}

/** True when the request sends "Authorization: Bearer <DISPATCH_TOKEN>" (the machine credential). */
export function machineAuthorized(req: Request): boolean {
  const h = req.headers.get("authorization") ?? "";
  const token = h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
  const expected = env.dispatchToken;
  if (!token || token.length !== expected.length) return false;
  // Constant-time compare: we look at every character even after a mismatch, so the time taken
  // does not tell an attacker how much of the token they guessed right.
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/** Wraps one route handler with access checks, body validation, logging and the shared error format. */
export function route<B = undefined>(opts: RouteOptions<B>) {
  return async (req: Request, routeCtx?: { params?: Promise<Record<string, string>> }): Promise<Response> => {
    const started = Date.now();
    const cid = correlationId(req);
    // Only the path is logged, never the query string, which could hold an access key.
    const path = new URL(req.url).pathname;
    // "visitor" is what the log shows for anonymous callers, until a real role is known.
    let role: string = "visitor";
    let setCookies: CookieToSet[] = [];

    // Every answer, success or error, leaves through finish(), so each one is logged the same way.
    const finish = (status: number, json: unknown, extra?: Record<string, string>) => {
      log({ cid, method: req.method, path, status, role, ms: Date.now() - started });
      return respond(status, json, cid, setCookies, extra);
    };

    // The checks run in a fixed order and the first failure stops the request:
    //   1. ids in the path  2. who is calling (401)  3. their role (404)
    //   4. same origin for cookie writes (403)  5. the JSON body (400)  6. the handler itself.
    try {
      // 1. Every id in the URL must look like a safe id, or we answer 404 straight away.
      const params = (await routeCtx?.params) ?? {};
      for (const value of Object.values(params)) {
        if (!isSafeId(value)) throw notFound();
      }

      // Shares the wrapper's cookie list, so a public route (sign-in/out) can still set cookies.
      let identity: IdentityResult = { identity: null, via: null, setCookies };
      let caller: Caller | null = null;

      // 2. Public routes skip steps 2 to 4. A machine route (the scheduled webhook dispatcher) needs
      // the secret machine token instead of a person's sign-in.
      if (opts.access === "machine") {
        if (!machineAuthorized(req)) throw new HttpError(401, { error: "unauthenticated" });
        role = "machine";
      } else if (opts.access !== "public") {
        // Staff route: check the sign-in (cookie or bearer token). Nobody signed in => 401.
        identity = await resolveIdentity(req);
        setCookies = identity.setCookies;
        if (!identity.identity) throw new HttpError(401, { error: "unauthenticated" });

        // 3. Look up the person's role in our own staff table and compare it with the route's list.
        caller = await resolveCaller(identity.identity);
        // Outside the matrix => the same 404 as an absent resource; never a hint.
        if (!caller || !opts.access.includes(caller.role)) throw notFound();
        role = caller.role;

        // 4. A write (POST, PATCH, DELETE...) that signs in with a cookie must come from our own site.
        // A bearer token is never sent by the browser on its own, so it cannot be abused by CSRF.
        const mutating = req.method !== "GET" && req.method !== "HEAD";
        if (mutating && identity.via === "cookie" && !sameOrigin(req)) {
          throw new HttpError(403, { error: "cross_origin_rejected" });
        }
      }

      // 5. Read the JSON body and check it against the route's zod schema (zod is a library that
      // checks data has the expected shape). Routes usually use .strict(), so unknown fields fail.
      let body = undefined as B;
      if (opts.body) {
        let raw: unknown;
        try {
          raw = await req.json();
        } catch {
          throw new HttpError(400, { error: "invalid_json" });
        }
        const parsed = opts.body.safeParse(raw);
        if (!parsed.success) {
          // Field names only: submitted values are never echoed.
          const fields = [...new Set(parsed.error.issues.map((i) => i.path.join(".") || "(body)"))];
          throw new HttpError(400, { error: "validation_failed", fields });
        }
        body = parsed.data;
      }

      // 6. Every check passed: run the route's own logic.
      const result = await opts.handler({ req, cid, params, body, caller, identity });
      return finish(result.status ?? 200, result.json, result.headers);
    } catch (err) {
      // A planned error (400, 401, 404, 409, 429...) is sent as it is.
      if (err instanceof HttpError) return finish(err.status, err.body);
      // Never leak internals or content into the response or the log line.
      log({ cid, level: "error", path, name: err instanceof Error ? err.name : "unknown" });
      return finish(500, { error: "internal_error" });
    }
  };
}
