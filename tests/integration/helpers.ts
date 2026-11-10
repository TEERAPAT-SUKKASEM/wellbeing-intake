// What this file does: shared helpers for the integration tests: the demo users and services, database
// clients, and call(), which runs a route handler directly with a built HTTP request.
// Why it matters: the tests run the real route code against the real local database with no web server,
// and these helpers keep every test short and the same in style.
// How to run it: it is not run by itself; the `pnpm test:integration` test files import it.
import { createClient } from "@supabase/supabase-js";
import { POST as createRequest } from "@/app/api/v1/requests/route";
import { GET as getSlots } from "@/app/api/v1/slots/route";
import { campusDateOf, type Slot } from "@/lib/slots/grid";

// The base URL for built requests. No server listens here; handlers are called directly.
export const BASE = "http://localhost:3000/api/v1";
// The staff demo password. It must match the one `pnpm seed` used.
export const PASSWORD = process.env.SEED_PASSWORD ?? "demo-password-16";

// The demo staff logins created by `pnpm seed`.
export const USERS = {
  practitioner: "practitioner.1@demo.test",
  practitioner2: "practitioner.2@demo.test",
  admin: "admin@demo.test",
} as const;

// The demo service ids created by `pnpm seed`.
export const SERVICES = {
  academic: "srv_academic_stress", // 45 minutes
  general: "srv_general_counselling", // 45 minutes
  dropIn: "srv_urgent_drop_in", // 30 minutes
} as const;

/** Service-role client: for arranging fixtures and asserting on stored state only. */
export const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** What a browser could hold: the anon key and nothing else. */
export const anon = () =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const tokens = new Map<string, string>();

// Signs in as a staff user and returns their login token. Each user signs in only once per run (cached).
export async function tokenFor(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const { data, error } = await anon().auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.session) throw new Error(`sign-in failed for ${email}: ${error?.message}`);
  tokens.set(email, data.session.access_token);
  return data.session.access_token;
}

type Handler = (req: Request, ctx?: { params?: Promise<Record<string, string>> }) => Promise<Response>;

// What call() returns: the status code, the raw body text, the parsed JSON and the response headers.
// `json` is loose on purpose: routes answer with objects and with arrays.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CallResult = { status: number; text: string; json: any; headers: Headers };

// Builds a Request (optional staff login with `as`, JSON body, URL params, extra headers), passes it to
// the route handler and returns the answer. Every integration test talks to the API through this.
export async function call(
  handler: Handler,
  opts: {
    method?: string;
    path: string;
    as?: string;
    body?: unknown;
    params?: Record<string, string>;
    headers?: Record<string, string>;
  },
): Promise<CallResult> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.as) headers.authorization = `Bearer ${await tokenFor(opts.as)}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const req = new Request(`${BASE}${opts.path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
  const text = await res.text();
  let json: unknown = {};
  try {
    json = JSON.parse(text);
  } catch {
    // leave empty
  }
  return { status: res.status, text, json, headers: res.headers };
}

// GET /slots for one service and one date, as a student would see them. Throws if the status is not 200.
export const slotsFor = async (serviceId: string, date: string): Promise<Slot[]> => {
  const r = await call(getSlots, { path: `/slots?service_id=${serviceId}&date=${date}` });
  if (r.status !== 200) throw new Error(`slots failed: ${r.status}`);
  return r.json as Slot[];
};

const DAY_MS = 86_400_000;

/** The earliest free time on the shared calendar for this service. */
export async function nextFreeSlot(serviceId: string = SERVICES.academic): Promise<Slot> {
  for (let i = 0; i < 30; i++) {
    const date = campusDateOf(new Date(Date.now() + i * DAY_MS));
    const free = (await slotsFor(serviceId, date)).find((s) => s.is_available);
    if (free) return free;
  }
  throw new Error("the calendar is full");
}

/** A weekday far enough ahead that nextFreeSlot, which fills from the front, never reaches it. */
export function quietWeekday(startingDaysAhead: number): string {
  for (let i = startingDaysAhead; i < startingDaysAhead + 7; i++) {
    const date = campusDateOf(new Date(Date.now() + i * DAY_MS));
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (weekday >= 1 && weekday <= 5) return date;
  }
  throw new Error("no weekday in range");
}

// Turns a campus date and time (UTC+7), for example "2026-11-10" and "10:00", into a UTC ISO string.
export const campusTime = (date: string, time: string) => new Date(`${date}T${time}:00+07:00`).toISOString();

// A valid anonymous booking body for the given start time. Pass overrides to change any field.
export const requestBody = (requestedSlotStart: string, overrides: Record<string, unknown> = {}) => ({
  service_id: SERVICES.academic,
  alias: "QuietStudent",
  intake_note: "Feeling overwhelmed with upcoming exams.",
  manual_urgency: "ROUTINE",
  requested_slot_start: requestedSlotStart,
  ...overrides,
});

// POST /requests with this body and optional headers. No login is sent: students are anonymous.
export const submit = (body: Record<string, unknown>, headers?: Record<string, string>) =>
  call(createRequest, { method: "POST", path: "/requests", body, headers });

/** Books the next free time and returns what the student would hold. */
export async function book(overrides: Record<string, unknown> = {}) {
  const serviceId = (overrides.service_id as string | undefined) ?? SERVICES.academic;
  const slot = await nextFreeSlot(serviceId);
  const r = await submit(requestBody(slot.slot_start, overrides));
  if (r.status !== 201) throw new Error(`booking failed: ${r.status} ${r.text}`);
  return { id: r.json.id as string, accessKey: r.json.access_key as string, slot, response: r };
}

/** Captures everything written to the console while `fn` runs. */
export async function captureLogs<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string }> {
  const lines: string[] = [];
  const original = { log: console.log, error: console.error, warn: console.warn };
  const sink = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  console.log = sink;
  console.error = sink;
  console.warn = sink;
  try {
    const result = await fn();
    return { result, logs: lines.join("\n") };
  } finally {
    console.log = original.log;
    console.error = original.error;
    console.warn = original.warn;
  }
}
