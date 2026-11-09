import "server-only";
import { randomUUID } from "node:crypto";
import type { ZodType } from "zod";
import { env } from "@/lib/env";
import { resolveIdentity, type CookieToSet, type IdentityResult } from "@/lib/identity/adapter";
import { resolveCaller, type Caller, type Role } from "@/lib/authz";

// One wrapper gives every route the platform conventions and the default-deny contract,
// so no handler implements them by hand.

export const CORRELATION_HEADER = "x-correlation-id";

/** The single body used for "absent", "wrong key" AND "not for your role". */
export const NOT_FOUND_BODY = { error: "not_found" } as const;

export class HttpError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown>,
  ) {
    super(String(body.error ?? status));
  }
}

export const notFound = () => new HttpError(404, NOT_FOUND_BODY);

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

const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** Ids in paths are opaque tokens such as req_3f9a or srv_academic_stress. */
export const isSafeId = (v: unknown): v is string => typeof v === "string" && SAFE_ID_RE.test(v);

function correlationId(req: Request): string {
  const incoming = req.headers.get(CORRELATION_HEADER);
  return incoming && /^[\w.:-]{8,128}$/.test(incoming) ? incoming : randomUUID();
}

function serializeCookie(c: CookieToSet): string {
  const o = (c.options ?? {}) as Record<string, unknown>;
  const parts = [`${c.name}=${encodeURIComponent(c.value)}`, `Path=${String(o.path ?? "/")}`];
  if (typeof o.maxAge === "number") parts.push(`Max-Age=${Math.floor(o.maxAge)}`);
  if (o.expires instanceof Date) parts.push(`Expires=${o.expires.toUTCString()}`);
  parts.push("HttpOnly", "SameSite=Lax");
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

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

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const allowed = env.appOrigin || new URL(req.url).origin;
  return origin === allowed;
}

export function machineAuthorized(req: Request): boolean {
  const h = req.headers.get("authorization") ?? "";
  const token = h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
  const expected = env.dispatchToken;
  if (!token || token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export function route<B = undefined>(opts: RouteOptions<B>) {
  return async (req: Request, routeCtx?: { params?: Promise<Record<string, string>> }): Promise<Response> => {
    const started = Date.now();
    const cid = correlationId(req);
    const path = new URL(req.url).pathname;
    let role: string = "visitor";
    let setCookies: CookieToSet[] = [];

    const finish = (status: number, json: unknown, extra?: Record<string, string>) => {
      log({ cid, method: req.method, path, status, role, ms: Date.now() - started });
      return respond(status, json, cid, setCookies, extra);
    };

    try {
      const params = (await routeCtx?.params) ?? {};
      for (const value of Object.values(params)) {
        if (!isSafeId(value)) throw notFound();
      }

      // Shares the wrapper's cookie list, so a public route (sign-in/out) can still set cookies.
      let identity: IdentityResult = { identity: null, via: null, setCookies };
      let caller: Caller | null = null;

      if (opts.access === "machine") {
        if (!machineAuthorized(req)) throw new HttpError(401, { error: "unauthenticated" });
        role = "machine";
      } else if (opts.access !== "public") {
        identity = await resolveIdentity(req);
        setCookies = identity.setCookies;
        if (!identity.identity) throw new HttpError(401, { error: "unauthenticated" });

        caller = await resolveCaller(identity.identity);
        // Outside the matrix => the same 404 as an absent resource; never a hint.
        if (!caller || !opts.access.includes(caller.role)) throw notFound();
        role = caller.role;

        const mutating = req.method !== "GET" && req.method !== "HEAD";
        if (mutating && identity.via === "cookie" && !sameOrigin(req)) {
          throw new HttpError(403, { error: "cross_origin_rejected" });
        }
      }

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

      const result = await opts.handler({ req, cid, params, body, caller, identity });
      return finish(result.status ?? 200, result.json, result.headers);
    } catch (err) {
      if (err instanceof HttpError) return finish(err.status, err.body);
      // Never leak internals or content into the response or the log line.
      log({ cid, level: "error", path, name: err instanceof Error ? err.name : "unknown" });
      return finish(500, { error: "internal_error" });
    }
  };
}
