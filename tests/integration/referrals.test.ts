// What this test file does: it tests Helpdesk referrals (Team 14 -> Wellbeing, docs/HELPDESK-REFERRALS.md)
// end to end: the real route handlers and the real local database, with a fake Helpdesk on 127.0.0.1 that
// receives our signed callbacks and checks every signature.
// Why it matters: this is the two-way partner contract. Helpdesk may only ever send us a random ref, a
// service and a consent time, and may only ever learn "accepted" or "declined" back. The feature must be
// invisible while off, a Helpdesk outage must never block a practitioner, and a withdrawn or 30-day-old
// referral must be gone for good.
// How to run it: `pnpm test:integration` (needs the local Supabase database from `pnpm db:start`).
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as dispatchRoute } from "@/app/api/v1/internal/events/dispatch/route";
import { PATCH as decideRoute } from "@/app/api/v1/practitioner/referrals/[ref]/route";
import { GET as staffListRoute } from "@/app/api/v1/practitioner/referrals/route";
import { DELETE as withdrawRoute, GET as referralStatusRoute } from "@/app/api/v1/referrals/[ref]/route";
import { POST as createReferralRoute } from "@/app/api/v1/referrals/route";
import { POST as signIn } from "@/app/api/v1/session/route";
import {
  BASE,
  PASSWORD,
  SERVICES,
  USERS,
  admin,
  anon,
  call,
  captureLogs,
  nextFreeSlot,
  requestBody,
  submit,
  tokenFor,
} from "./helpers";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// Where the fake Helpdesk receives callbacks (the same path as the spec's default webhook URL).
const CALLBACK_PATH = "/webhooks/wellbeing";
// The six fields of a referral: everything we store and everything staff see. Nothing else.
const REFERRAL_KEYS = ["consent_at", "decided_at", "received_at", "ref", "service_id", "status"];

type ReferralRow = {
  ref: string;
  service_id: string | null;
  consent_at: string;
  status: string;
  received_at: string;
  decided_at: string | null;
};

// A random ref in Helpdesk's format: "hd-" and 32 lowercase hex characters.
const newRef = () => `hd-${randomBytes(16).toString("hex")}`;
// A time offsetMs from now, in whole seconds (the API answers times without fractions of a second).
const at = (offsetMs: number) => new Date(Math.floor((Date.now() + offsetMs) / 1000) * 1000).toISOString();

// A valid POST /referrals body. Pass overrides to change any field.
const referralBody = (ref: string, overrides: Record<string, unknown> = {}) => ({
  ref,
  service_id: SERVICES.academic,
  consent_at: at(-5 * MINUTE),
  ...overrides,
});

// The bearer token Helpdesk sends us (HELPDESK_REFERRAL_TOKEN, set in setup-env.ts).
const helpdeskAuth = () => ({ authorization: `Bearer ${process.env.HELPDESK_REFERRAL_TOKEN}` });

// Each create comes from its own documentation address, so the per-address limit (60 per 10 minutes)
// never gets in the way here; the limit itself is tested with one fixed address.
let addressCounter = 0;
const nextAddress = () => `198.51.100.${(addressCounter++ % 250) + 1}`;

// The five referral routes and the dispatcher, called as Helpdesk, as staff or as the scheduled job.
const create = (body: unknown, headers: Record<string, string> = helpdeskAuth()) =>
  call(createReferralRoute, { method: "POST", path: "/referrals", body, headers: { "x-forwarded-for": nextAddress(), ...headers } });
const statusOf = (ref: string, headers: Record<string, string> = helpdeskAuth()) =>
  call(referralStatusRoute, { path: `/referrals/${ref}`, params: { ref }, headers });
const withdraw = (ref: string, headers: Record<string, string> = helpdeskAuth()) =>
  call(withdrawRoute, { method: "DELETE", path: `/referrals/${ref}`, params: { ref }, headers });
const staffList = (as?: string, headers?: Record<string, string>) =>
  call(staffListRoute, { path: "/practitioner/referrals", as, headers });
const decide = (ref: string, status: string, opts: { as?: string; headers?: Record<string, string> } = {}) =>
  call(decideRoute, {
    method: "PATCH",
    path: `/practitioner/referrals/${ref}`,
    params: { ref },
    as: opts.as ?? USERS.practitioner,
    headers: opts.headers,
    body: { status },
  });
const dispatchNow = () =>
  call(dispatchRoute, {
    method: "POST",
    path: "/internal/events/dispatch",
    headers: { authorization: `Bearer ${process.env.DISPATCH_TOKEN}` },
  });

// Reading and arranging stored state, with the service-role client.
const storedReferral = async (ref: string) => (await admin.from("referral").select("*").eq("ref", ref).maybeSingle()).data;
const eventsFor = async (ref: string) =>
  (await admin.from("referral_event").select("*").eq("ref", ref).order("created_at")).data ?? [];
const makeDue = (eventId: string) =>
  admin.from("referral_event").update({ next_attempt_at: at(-MINUTE) }).eq("event_id", eventId);

/** Creates a referral through POST /referrals as Helpdesk and returns its ref. */
async function received(overrides: Record<string, unknown> = {}): Promise<string> {
  const ref = newRef();
  const r = await create(referralBody(ref, overrides));
  if (r.status !== 201) throw new Error(`creating a referral failed: ${r.status} ${r.text}`);
  return ref;
}

// A real staff cookie session, signed in from our own site (the same steps as platform.test.ts).
async function cookieSession(): Promise<string> {
  const r = await signIn(
    new Request(`${BASE}/session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ email: USERS.practitioner, password: PASSWORD }),
    }),
  );
  expect(r.status).toBe(200);
  return r.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

// The fake Helpdesk. It keeps every request, checks X-Signature = HMAC(secret, X-Timestamp + "." + raw
// body), answers 401 to a bad signature and otherwise answers `answer`.
type CallbackBody = { eventId: string; type: string; data: { ref: string; status: string } };
type Callback = {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  raw: string;
  body: CallbackBody;
  signatureOk: boolean;
  answered: number;
};

let helpdesk: Server;
let answer = 200;
let callbacks: Callback[] = []; // this test only
const everyCallback: Callback[] = []; // the whole file, for the privacy check at the end
const saved: Record<string, string | undefined> = {};

function signatureOk(raw: string, timestamp: unknown, signature: unknown): boolean {
  if (typeof timestamp !== "string" || typeof signature !== "string") return false;
  const expected = createHmac("sha256", process.env.HELPDESK_WEBHOOK_SECRET!).update(`${timestamp}.${raw}`).digest("hex");
  return signature === expected;
}

beforeAll(async () => {
  for (const name of ["REFERRALS_ENABLED", "HELPDESK_WEBHOOK_URL"]) saved[name] = process.env[name];
  helpdesk = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const ok = signatureOk(raw, req.headers["x-timestamp"], req.headers["x-signature"]);
      const status = ok ? answer : 401;
      let body = {} as CallbackBody;
      try {
        body = JSON.parse(raw);
      } catch {
        // kept as {}; the raw text is still recorded
      }
      const callback = { method: req.method ?? "", path: req.url ?? "", headers: req.headers, raw, body, signatureOk: ok, answered: status };
      callbacks.push(callback);
      everyCallback.push(callback);
      res.writeHead(status, { "content-type": "application/json" }).end(status < 300 ? JSON.stringify({ received: true }) : "{}");
    });
  });
  await new Promise<void>((resolve) => helpdesk.listen(0, "127.0.0.1", resolve));
  process.env.HELPDESK_WEBHOOK_URL = `http://127.0.0.1:${(helpdesk.address() as AddressInfo).port}${CALLBACK_PATH}`;
  process.env.REFERRALS_ENABLED = "true";
});

afterAll(async () => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await new Promise((resolve) => helpdesk.close(resolve));
});

beforeEach(async () => {
  callbacks = [];
  answer = 200;
  // Callbacks left waiting by an earlier test must not be sent during this one.
  const { error } = await admin.from("referral_event").delete().is("delivered_at", null);
  if (error) throw new Error(`clearing the referral outbox failed: ${error.message}`);
});

// Off is the default. Every referral route then gives the standard 404, so the feature cannot even be seen.
describe("Switched off: REFERRALS_ENABLED=false", () => {
  it("every referral route answers the standard 404, even with the right token or a staff login", async () => {
    const existing = await received(); // made while the feature was on
    process.env.REFERRALS_ENABLED = "false";
    try {
      const fresh = newRef();
      const answers = {
        create: await create(referralBody(fresh)),
        createWithoutToken: await create(referralBody(fresh), {}),
        status: await statusOf(existing),
        withdraw: await withdraw(existing),
        staffList: await staffList(USERS.practitioner),
        decide: await decide(existing, "approved"),
      };
      for (const [name, r] of Object.entries(answers)) {
        expect(r.status, name).toBe(404);
        expect(r.json, name).toEqual({ error: "not_found" });
      }
      // Nothing was stored, deleted, decided or sent.
      expect(await storedReferral(fresh)).toBeNull();
      expect(await storedReferral(existing)).toMatchObject({ status: "received", decided_at: null });
      expect(await eventsFor(existing)).toHaveLength(0);

      const d = await dispatchNow();
      expect(d.status).toBe(200);
      expect(d.json.referrals).toEqual({ skipped: true, sent: 0, retry: 0, gaveUp: 0 });
      expect(callbacks).toHaveLength(0);
    } finally {
      process.env.REFERRALS_ENABLED = "true";
    }
  });
});

// Only Helpdesk's own bearer token opens the three /referrals routes; staff logins and our machine
// token do not. One address can send at most 60 referrals in 10 minutes.
describe("Helpdesk's bearer token and the per-address limit", () => {
  it("POST /referrals without the right token is 401 and stores nothing; the right token works", async () => {
    const ref = newRef();
    const refused = {
      none: await create(referralBody(ref), {}),
      wrong: await create(referralBody(ref), { authorization: "Bearer wrong-referral-token" }),
      staffLogin: await create(referralBody(ref), { authorization: `Bearer ${await tokenFor(USERS.admin)}` }),
      dispatchToken: await create(referralBody(ref), { authorization: `Bearer ${process.env.DISPATCH_TOKEN}` }),
    };
    for (const [name, r] of Object.entries(refused)) {
      expect(r.status, name).toBe(401);
      expect(r.json, name).toEqual({ error: "unauthenticated" });
    }
    expect(await storedReferral(ref)).toBeNull();

    const right = await create(referralBody(ref));
    expect(right.status).toBe(201);
  });

  it("GET and DELETE /referrals/{ref} need the token too, and a refused DELETE deletes nothing", async () => {
    const ref = await received();
    const refusedHeaders: Record<string, string>[] = [{}, { authorization: "Bearer wrong-referral-token" }];
    for (const headers of refusedHeaders) {
      for (const r of [await statusOf(ref, headers), await withdraw(ref, headers)]) {
        expect(r.status).toBe(401);
        expect(r.json).toEqual({ error: "unauthenticated" });
      }
    }
    expect(await storedReferral(ref)).not.toBeNull();
  });

  it("one address can send 60 referrals in 10 minutes; the 61st is 429", async () => {
    const headers = { ...helpdeskAuth(), "x-forwarded-for": "203.0.113.160" };
    const send = () =>
      call(createReferralRoute, { method: "POST", path: "/referrals", body: referralBody(newRef()), headers });
    for (let i = 0; i < 60; i++) expect((await send()).status).toBe(201);
    const limited = await send();
    expect(limited.status).toBe(429);
    expect(limited.json).toEqual({ error: "too_many_requests" });
  });
});

// Helpdesk sends a ref, a service (or null) and the consent time. A replay of the same ref is harmless,
// and every other shape is refused with the name of the bad field only.
describe("POST /referrals: create, replay and validation", () => {
  it("creates a referral (201); the same ref again answers 200 with the same shape and changes nothing", async () => {
    const ref = newRef();
    const body = referralBody(ref);
    const first = await create(body);
    expect(first.status).toBe(201);
    expect(first.json).toEqual({ id: ref, status: "received" });

    const stored = await storedReferral(ref);
    expect(stored).toMatchObject({ ref, service_id: SERVICES.academic, status: "received", decided_at: null });
    expect(new Date(stored!.consent_at).getTime()).toBe(new Date(body.consent_at).getTime());

    const replay = await create({ ...body, service_id: null, consent_at: at(-MINUTE) });
    expect(replay.status).toBe(200);
    expect(replay.json).toEqual({ id: ref, status: "received" });
    expect(await storedReferral(ref)).toEqual(stored);
  });

  it("accepts service_id: null (the student did not pick a service)", async () => {
    const ref = newRef();
    const r = await create(referralBody(ref, { service_id: null }));
    expect(r.status).toBe(201);
    expect(r.json).toEqual({ id: ref, status: "received" });
    expect((await storedReferral(ref))!.service_id).toBeNull();
  });

  it("accepts consent_at with a +07:00 offset, a minute ahead (clock skew) and 29 days back", async () => {
    const instant = new Date(at(-10 * MINUTE));
    const campusClock = new Date(instant.getTime() + 7 * 60 * MINUTE).toISOString().replace(/\.\d{3}Z$/, "+07:00");
    const withOffset = newRef();
    expect((await create(referralBody(withOffset, { consent_at: campusClock }))).status).toBe(201);
    expect(new Date((await storedReferral(withOffset))!.consent_at).getTime()).toBe(instant.getTime());

    for (const consent_at of [at(MINUTE), at(-29 * DAY)]) {
      const r = await create(referralBody(newRef(), { consent_at }));
      expect(r.status, consent_at).toBe(201);
    }
  });

  // Each case changes one field of a valid body. The answer names that field and echoes no value.
  const invalid: [string, () => Record<string, unknown>, string][] = [
    ["a badly formed ref", () => ({ ref: "hd-not-a-hex-ref" }), "ref"],
    ["an uppercase ref", () => ({ ref: `hd-${"AB".repeat(16)}` }), "ref"],
    ["a missing ref", () => ({ ref: undefined }), "ref"],
    ["a badly formed service_id", () => ({ service_id: "Academic stress" }), "service_id"],
    ["a missing consent_at", () => ({ consent_at: undefined }), "consent_at"],
    ["a consent_at that is not a date", () => ({ consent_at: "yesterday" }), "consent_at"],
    ["a consent_at with no offset", () => ({ consent_at: at(-MINUTE).replace(/\.\d{3}Z$/, "") }), "consent_at"],
    ["a consent_at an hour in the future", () => ({ consent_at: at(60 * MINUTE) }), "consent_at"],
    ["a consent_at 31 days ago", () => ({ consent_at: at(-31 * DAY) }), "consent_at"],
    ["an extra field", () => ({ student_id: "echo-6612345" }), "(body)"],
  ];
  it.each(invalid)("refuses %s with 400 and names the field", async (_label, overrides, field) => {
    const ref = newRef();
    const r = await create({ ...referralBody(ref), ...overrides() });
    expect(r.status).toBe(400);
    expect(r.json).toEqual({ error: "validation_failed", fields: [field] });
    expect(r.text).not.toContain("echo-6612345");
    expect(await storedReferral(ref)).toBeNull();
  });

  it("refuses a well-formed but unknown service with 400 [service_id]", async () => {
    const ref = newRef();
    const r = await create(referralBody(ref, { service_id: "srv_does_not_exist" }));
    expect(r.status).toBe(400);
    expect(r.json).toEqual({ error: "validation_failed", fields: ["service_id"] });
    expect(await storedReferral(ref)).toBeNull();
  });
});

// Helpdesk can poll a referral's status at any time. It learns the status and nothing else.
describe("GET /referrals/{ref}: Helpdesk polls the status", () => {
  it("answers only the status", async () => {
    const ref = await received();
    const r = await statusOf(ref);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ status: "received" });
  });

  it("an unknown or badly formed ref is the standard 404", async () => {
    for (const ref of [newRef(), "hd-not-a-real-ref", `hd-${"F".repeat(32)}`]) {
      const r = await statusOf(ref);
      expect(r.status, ref).toBe(404);
      expect(r.json, ref).toEqual({ error: "not_found" });
    }
  });
});

// The new Helpdesk referrals tab: practitioners and admins see the six stored fields, waiting ones first.
describe("GET /practitioner/referrals: the staff list", () => {
  it("shows a practitioner and an admin the referral, with only the six stored fields", async () => {
    const consentAt = at(-10 * MINUTE);
    const ref = await received({ consent_at: consentAt });
    for (const who of [USERS.practitioner, USERS.admin]) {
      const r = await staffList(who);
      expect(r.status, who).toBe(200);
      expect(Array.isArray(r.json)).toBe(true);
      const row = (r.json as ReferralRow[]).find((x) => x.ref === ref);
      expect(row, who).toBeDefined();
      expect(Object.keys(row!).sort()).toEqual(REFERRAL_KEYS);
      expect(row).toMatchObject({ ref, service_id: SERVICES.academic, status: "received", decided_at: null });
      expect(new Date(row!.consent_at).getTime()).toBe(new Date(consentAt).getTime());
      expect(Math.abs(new Date(row!.received_at).getTime() - Date.now())).toBeLessThan(5 * MINUTE);
    }
  });

  it("lists waiting referrals first, newest first, and at most 200", async () => {
    const older = await received();
    const newer = await received();
    const decided = await received();
    // Make the order certain: "older" arrived a minute before "newer".
    expect((await admin.from("referral").update({ received_at: at(-MINUTE) }).eq("ref", older)).error).toBeNull();
    expect((await decide(decided, "declined")).status).toBe(200);

    const rows = (await staffList(USERS.practitioner)).json as ReferralRow[];
    expect(rows.length).toBeLessThanOrEqual(200);
    const position = (ref: string) => rows.findIndex((x) => x.ref === ref);
    expect(position(newer)).toBeGreaterThanOrEqual(0);
    expect(position(newer)).toBeLessThan(position(older));
    expect(position(older)).toBeLessThan(position(decided));

    const firstDecided = rows.findIndex((x) => x.status !== "received");
    if (firstDecided >= 0) expect(rows.slice(firstDecided).map((x) => x.status)).not.toContain("received");
    const waiting = rows.filter((x) => x.status === "received").map((x) => new Date(x.received_at).getTime());
    expect(waiting).toEqual([...waiting].sort((a, b) => b - a));
  });

  it("needs a staff login: none, a bad token or Helpdesk's token is 401", async () => {
    const answers = [
      await staffList(),
      await staffList(undefined, { authorization: "Bearer not-a-token" }),
      await staffList(undefined, helpdeskAuth()),
    ];
    for (const r of answers) {
      expect(r.status).toBe(401);
      expect(r.json).toEqual({ error: "unauthenticated" });
    }
  });
});

// Accept or Decline. The first decision writes one outbox event and sends Helpdesk one signed callback
// carrying only eventId, type and {ref, status}. A decision is final.
describe("PATCH /practitioner/referrals/{ref}: decide, and the signed callback", () => {
  it("accepting sends Helpdesk exactly one signed callback with only the ref and the status", async () => {
    const ref = await received();
    const { result: r, logs } = await captureLogs(() => decide(ref, "approved"));
    expect(r.status).toBe(200);
    expect(Object.keys(r.json).sort()).toEqual(REFERRAL_KEYS);
    expect(r.json).toMatchObject({ ref, service_id: SERVICES.academic, status: "approved" });
    expect(r.json.decided_at).toEqual(expect.any(String));

    // Exactly one request reached Helpdesk, a POST to the webhook path.
    expect(callbacks).toHaveLength(1);
    const [cb] = callbacks;
    expect(cb.method).toBe("POST");
    expect(cb.path).toBe(CALLBACK_PATH);
    expect(cb.answered).toBe(200);

    // The body: exactly eventId, type and data {ref, status}, in that order.
    expect(Object.keys(cb.body)).toEqual(["eventId", "type", "data"]);
    expect(Object.keys(cb.body.data)).toEqual(["ref", "status"]);
    expect(cb.body).toEqual({
      eventId: expect.stringMatching(/^evt-[0-9a-f-]{36}$/),
      type: "wellbeing.referral_status",
      data: { ref, status: "approved" },
    });
    expect(cb.raw).toBe(JSON.stringify({ eventId: cb.body.eventId, type: "wellbeing.referral_status", data: { ref, status: "approved" } }));

    // The headers: a valid signature, a timestamp in seconds close to now, and a team16- correlation id.
    expect(cb.signatureOk).toBe(true);
    expect(cb.headers["content-type"]).toMatch(/^application\/json/);
    const timestamp = String(cb.headers["x-timestamp"]);
    expect(timestamp).toMatch(/^\d+$/);
    expect(Math.abs(Number(timestamp) - Date.now() / 1000)).toBeLessThanOrEqual(300);
    const correlationId = String(cb.headers["x-correlation-id"]);
    expect(correlationId).toMatch(/^team16-/);
    expect(correlationId.length).toBeLessThanOrEqual(128);

    // The outbox row is marked delivered, under the same eventId.
    const events = await eventsFor(ref);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event_id: cb.body.eventId, status: "approved", last_status: 200, gave_up_at: null });
    expect(events[0].delivered_at).not.toBeNull();
    expect((await statusOf(ref)).json).toEqual({ status: "approved" });

    // One content-free partner log line, which never contains the ref.
    const lines = logs.split("\n").filter((line) => line.includes('"op":"referral_callback"'));
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry).toMatchObject({ svc: "wellbeing", kind: "partner", partner: "helpdesk", op: "referral_callback", outcome: "ok" });
    expect(Object.keys(entry).sort()).toEqual(["cid", "kind", "ms", "op", "outcome", "partner", "svc", "t"]);
    expect(lines[0]).not.toContain(ref);
  });

  it("the same decision again is 200 with no second callback; the other decision is 409", async () => {
    const ref = await received();
    expect((await decide(ref, "approved")).status).toBe(200);
    expect(callbacks).toHaveLength(1);

    const again = await decide(ref, "approved");
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ ref, status: "approved" });

    const flip = await decide(ref, "declined");
    expect(flip.status).toBe(409);
    expect(flip.json).toEqual({ error: "invalid_transition" });

    expect(callbacks).toHaveLength(1);
    expect(await eventsFor(ref)).toHaveLength(1);
    expect((await statusOf(ref)).json).toEqual({ status: "approved" });
  });

  it("an admin can decline; the callback says declined and keeps an id that already starts with team16-", async () => {
    const ref = await received();
    const r = await decide(ref, "declined", { as: USERS.admin, headers: { "x-correlation-id": "team16-referral-evidence-0001" } });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ref, status: "declined" });

    expect(callbacks).toHaveLength(1);
    expect(callbacks[0].signatureOk).toBe(true);
    expect(callbacks[0].body.data).toEqual({ ref, status: "declined" });
    expect(callbacks[0].headers["x-correlation-id"]).toBe("team16-referral-evidence-0001");

    expect((await decide(ref, "approved")).status).toBe(409);
    expect((await statusOf(ref)).json).toEqual({ status: "declined" });
  });

  it("Helpdesk re-sending the POST after a decision answers 200 and changes nothing", async () => {
    const ref = await received();
    expect((await decide(ref, "approved")).status).toBe(200);
    const before = await storedReferral(ref);

    const replay = await create(referralBody(ref, { service_id: null }));
    expect(replay.status).toBe(200);
    expect(Object.keys(replay.json).sort()).toEqual(["id", "status"]);
    expect(replay.json.id).toBe(ref);
    expect(await storedReferral(ref)).toEqual(before);
    expect(await eventsFor(ref)).toHaveLength(1);
    expect(callbacks).toHaveLength(1);
  });

  it("an unknown ref is 404, and any body but {status: approved|declined} is 400", async () => {
    const unknown = await decide(newRef(), "approved");
    expect(unknown.status).toBe(404);
    expect(unknown.json).toEqual({ error: "not_found" });

    const ref = await received();
    for (const body of [{ status: "received" }, { status: "APPROVED" }, {}, { status: "approved", note: "x" }]) {
      const r = await call(decideRoute, {
        method: "PATCH",
        path: `/practitioner/referrals/${ref}`,
        params: { ref },
        as: USERS.practitioner,
        body,
      });
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.json.error).toBe("validation_failed");
    }
    expect(await storedReferral(ref)).toMatchObject({ status: "received", decided_at: null });
    expect(callbacks).toHaveLength(0);
  });

  it("a cookie decision from another website is refused (403) and nothing is sent", async () => {
    const cookie = await cookieSession();
    const ref = await received();
    const attempt = (origin?: string) =>
      call(decideRoute, {
        method: "PATCH",
        path: `/practitioner/referrals/${ref}`,
        params: { ref },
        headers: { cookie, ...(origin ? { origin } : {}) },
        body: { status: "approved" },
      });

    const evil = await attempt("https://evil.example");
    expect(evil.status).toBe(403);
    expect(evil.json).toEqual({ error: "cross_origin_rejected" });
    expect((await attempt()).status).toBe(403); // no Origin header at all is not trusted either
    expect(await storedReferral(ref)).toMatchObject({ status: "received" });
    expect(callbacks).toHaveLength(0);

    expect((await attempt("http://localhost:3000")).status).toBe(200);
    expect(callbacks).toHaveLength(1);
  });
});

// A Helpdesk outage (5xx) never blocks the practitioner: the event waits and the dispatcher retries it
// later with the same eventId and body. Any other 4xx means "never send this", so we give up at once.
describe("Callback delivery when Helpdesk is down or refuses", () => {
  it("a 503 never fails the decision; the event waits, then the dispatcher sends the same eventId", async () => {
    const ref = await received();
    answer = 503;
    const r = await decide(ref, "approved");
    expect(r.status).toBe(200);
    expect(r.json.status).toBe("approved");
    expect(callbacks.map((c) => c.answered)).toEqual([503]);

    const [waiting] = await eventsFor(ref);
    expect(waiting).toMatchObject({ delivered_at: null, gave_up_at: null });
    expect(waiting.attempts).toBeGreaterThanOrEqual(1);
    expect(new Date(waiting.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
    expect(callbacks[0].body.eventId).toBe(waiting.event_id);
    // Helpdesk can still poll the decision while the callback waits.
    expect((await statusOf(ref)).json).toEqual({ status: "approved" });

    // Helpdesk is back, but the retry is not due yet: nothing is sent early.
    answer = 200;
    const early = await dispatchNow();
    expect(early.status).toBe(200);
    expect(early.json.referrals).toMatchObject({ skipped: false, sent: 0 });
    expect(callbacks).toHaveLength(1);

    // Once due, the dispatcher sends it. Its existing answer keys stay, with the referral counts added.
    expect((await makeDue(waiting.event_id)).error).toBeNull();
    const d = await dispatchNow();
    expect(d.status).toBe(200);
    expect(d.json).toMatchObject({
      claimed: expect.any(Number),
      delivered: expect.any(Number),
      retrying: expect.any(Number),
      parked: expect.any(Number),
      referrals: { skipped: false, sent: 1, retry: 0, gaveUp: 0 },
      referrals_purged: expect.any(Number),
    });

    expect(callbacks).toHaveLength(2);
    expect(callbacks[1]).toMatchObject({ answered: 200, signatureOk: true });
    expect(callbacks[1].body.eventId).toBe(waiting.event_id);
    expect(callbacks[1].raw).toBe(callbacks[0].raw);

    const [delivered] = await eventsFor(ref);
    expect(delivered.delivered_at).not.toBeNull();
    expect(delivered.last_status).toBe(200);
  });

  it("a 401 from Helpdesk gives up at once, and the event is never retried", async () => {
    const ref = await received();
    answer = 401;
    expect((await decide(ref, "approved")).status).toBe(200);
    expect(callbacks).toHaveLength(1);
    expect(callbacks[0]).toMatchObject({ answered: 401, signatureOk: true });

    const [event] = await eventsFor(ref);
    expect(event.gave_up_at).not.toBeNull();
    expect(event.delivered_at).toBeNull();
    expect(event.last_status).toBe(401);

    // Even when made due again and Helpdesk would accept it, a given-up event is not sent.
    answer = 200;
    expect((await makeDue(event.event_id)).error).toBeNull();
    const d = await dispatchNow();
    expect(d.status).toBe(200);
    expect(d.json.referrals).toMatchObject({ sent: 0 });
    expect(callbacks).toHaveLength(1);

    const [after] = await eventsFor(ref);
    expect(after.delivered_at).toBeNull();
    expect(after.gave_up_at).toBe(event.gave_up_at);
    // The decision itself stands, and Helpdesk can still poll it.
    expect((await statusOf(ref)).json).toEqual({ status: "approved" });
  });
});

// The student withdrew on Helpdesk: the referral and its events are deleted, and DELETE is idempotent.
describe("DELETE /referrals/{ref}: the student withdrew", () => {
  it("deletes the referral and its events; deleting again, or an unknown ref, is still 200", async () => {
    const ref = await received();
    expect((await decide(ref, "approved")).status).toBe(200);
    expect(await eventsFor(ref)).toHaveLength(1);

    const r = await withdraw(ref);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ deleted: true });

    expect((await statusOf(ref)).status).toBe(404);
    expect(await storedReferral(ref)).toBeNull();
    expect(await eventsFor(ref)).toHaveLength(0);
    const list = await staffList(USERS.practitioner);
    expect((list.json as ReferralRow[]).map((x) => x.ref)).not.toContain(ref);
    expect((await decide(ref, "approved")).status).toBe(404);

    for (const again of [ref, newRef()]) {
      const second = await withdraw(again);
      expect(second.status).toBe(200);
      expect(second.json).toEqual({ deleted: true });
    }
  });

  it("a callback still waiting for a down Helpdesk is dropped with its referral and never sent", async () => {
    const ref = await received();
    answer = 503;
    expect((await decide(ref, "approved")).status).toBe(200);
    const [waiting] = await eventsFor(ref);
    expect(waiting.delivered_at).toBeNull();

    expect((await withdraw(ref)).status).toBe(200);
    expect(await eventsFor(ref)).toHaveLength(0);

    answer = 200;
    const d = await dispatchNow();
    expect(d.json.referrals).toMatchObject({ sent: 0 });
    expect(callbacks.filter((c) => c.answered === 200)).toHaveLength(0);
  });
});

// We keep a referral for 30 days at most. The scheduled dispatcher run deletes older ones and their events.
describe("Retention: the dispatcher purges referrals after 30 days", () => {
  it("deletes a referral that arrived 31 days ago, with its events, and keeps a 29-day-old one", async () => {
    const old = newRef();
    const young = newRef();
    const longAgo = at(-31 * DAY);
    const insertedOld = await admin.from("referral").insert({
      ref: old,
      service_id: SERVICES.academic,
      consent_at: longAgo,
      received_at: longAgo,
      status: "approved",
      decided_at: longAgo,
    });
    expect(insertedOld.error).toBeNull();
    const insertedEvent = await admin.from("referral_event").insert({
      event_id: `evt-${randomUUID()}`,
      ref: old,
      status: "approved",
      delivered_at: longAgo,
      last_status: 200,
    });
    expect(insertedEvent.error).toBeNull();
    const insertedYoung = await admin.from("referral").insert({
      ref: young,
      service_id: null,
      consent_at: at(-29 * DAY),
      received_at: at(-29 * DAY),
      status: "received",
      decided_at: null,
    });
    expect(insertedYoung.error).toBeNull();

    try {
      const d = await dispatchNow();
      expect(d.status).toBe(200);
      expect(d.json.referrals_purged).toBeGreaterThanOrEqual(1);
      expect(await storedReferral(old)).toBeNull();
      expect(await eventsFor(old)).toHaveLength(0);
      expect(await storedReferral(young)).not.toBeNull();
      expect(callbacks).toHaveLength(0);
    } finally {
      await admin.from("referral").delete().eq("ref", young);
    }
  });
});

// The privacy rules of docs/HELPDESK-REFERRALS.md section 1, checked across everything this file did.
describe("Privacy: what Helpdesk learns, and what we keep", () => {
  it("no callback carried the service, the consent time or any time at all", () => {
    expect(everyCallback.length).toBeGreaterThanOrEqual(5);
    for (const cb of everyCallback) {
      expect(cb.raw).not.toContain("service_id");
      expect(cb.raw).not.toContain("consent_at");
      expect(cb.raw).not.toContain(SERVICES.academic);
      expect(cb.raw).not.toMatch(/srv_|received_at|decided_at|\d{4}-\d{2}-\d{2}/);
      expect(Object.keys(cb.body)).toEqual(["eventId", "type", "data"]);
      expect(Object.keys(cb.body.data)).toEqual(["ref", "status"]);
      expect(cb.signatureOk).toBe(true);
    }
  });

  it("stores only the ref, the service, the consent time and our own timestamps", async () => {
    const ref = await received();
    expect((await decide(ref, "approved")).status).toBe(200);
    expect(Object.keys((await storedReferral(ref))!).sort()).toEqual(REFERRAL_KEYS);
    const [event] = await eventsFor(ref);
    expect(Object.keys(event).sort()).toEqual([
      "attempts", "created_at", "delivered_at", "event_id", "gave_up_at", "last_status", "next_attempt_at", "ref", "status",
    ]);
  });

  it("the browser's anon key cannot read referrals or run their functions", async () => {
    const browser = anon();
    for (const table of ["referral", "referral_event"]) {
      const { data, error } = await browser.from(table).select("*").limit(1);
      expect(error !== null || (data ?? []).length === 0, table).toBe(true);
    }
    expect((await browser.rpc("decide_referral", { p_ref: newRef(), p_status: "approved" })).error).not.toBeNull();
    // A harmless age (100 years), in case the grant were ever wrong.
    expect((await browser.rpc("purge_old_referrals", { p_days: 36500 })).error).not.toBeNull();
  });

  it("a booking cannot carry a Helpdesk ref", async () => {
    const slot = await nextFreeSlot();
    const r = await submit(requestBody(slot.slot_start, { ref: newRef() }));
    expect(r.status).toBe(400);
  });
});
