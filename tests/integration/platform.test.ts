import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { POST as dispatchRoute } from "@/app/api/v1/internal/events/dispatch/route";
import { GET as health } from "@/app/api/v1/health/route";
import { GET as me } from "@/app/api/v1/me/route";
import { POST as mockHub, PUT as mockHubSwitch } from "@/app/api/v1/mock/hub/route";
import { GET as queue } from "@/app/api/v1/practitioner/queue/route";
import { PATCH as decide } from "@/app/api/v1/requests/[id]/status/route";
import { GET as myRequest } from "@/app/api/v1/requests/me/route";
import { GET as services } from "@/app/api/v1/services/route";
import { POST as signIn } from "@/app/api/v1/session/route";
import { POST as assess } from "@/app/api/v1/triage/assess/route";
import { POST as inboundWebhook } from "@/app/api/v1/webhooks/notification-hub/route";
import { EVENT_ID_HEADER, SIGNATURE_HEADER, TIMESTAMP_HEADER, sign } from "@/lib/events/contract";
import { BASE, PASSWORD, USERS, admin, anon, book, call, captureLogs, nextFreeSlot, requestBody, submit } from "./helpers";

describe("Platform conventions", () => {
  it("health is public and content-free", async () => {
    const r = await call(health, { path: "/health" });
    expect(r.status).toBe(200);
    expect(Object.keys(r.json).sort()).toEqual(["database", "service", "status", "version"]);
    expect(r.json.database).toBe("up");
  });

  it("every response carries a correlation id and echoes a supplied one", async () => {
    const generated = await call(services, { path: "/services" });
    expect(generated.headers.get("x-correlation-id")).toMatch(/^[0-9a-f-]{36}$/);
    const supplied = await call(services, { path: "/services", headers: { "x-correlation-id": "evidence-run-0001" } });
    expect(supplied.headers.get("x-correlation-id")).toBe("evidence-run-0001");
    expect(supplied.headers.get("cache-control")).toBe("no-store");
  });

  it("ships no analytics or telemetry package", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    for (const d of deps) expect(d).not.toMatch(/analytics|segment|mixpanel|posthog|gtag|sentry|datadog/);
  });

  it("emergency contacts stay static, with no data dependency", async () => {
    const { EMERGENCY_CONTACTS, CANNOT_HELP_NOW } = await import("@/lib/emergency");
    expect(EMERGENCY_CONTACTS.length).toBeGreaterThan(0);
    expect(CANNOT_HELP_NOW).toMatch(/cannot provide immediate help/);
    expect(readFileSync("src/app/emergency/page.tsx", "utf8")).toContain('dynamic = "force-static"');
  });
});

describe("Privacy", () => {
  it("a sentinel in the note and alias appears in no log line and no error", async () => {
    const sentinel = `SENTINEL${randomUUID().replaceAll("-", "")}`;
    const { logs } = await captureLogs(async () => {
      const created = await book({ intake_note: sentinel, alias: sentinel.slice(0, 30) });
      await call(decide, { method: "PATCH", path: `/requests/${created.id}/status`, as: USERS.practitioner, params: { id: created.id }, body: { status: "CONFIRMED" } });
      await call(myRequest, { path: "/requests/me", headers: { "x-access-key": created.accessKey } });
      const slot = await nextFreeSlot();
      const bad = await submit(requestBody(slot.slot_start, { intake_note: sentinel, extra: sentinel }));
      expect(bad.status).toBe(400);
      expect(bad.text).not.toContain(sentinel); // validation errors never echo values
    });
    expect(logs).not.toContain(sentinel);
    expect(logs).not.toContain(sentinel.slice(0, 30));
  });

  it("an access key sent in the URL is not written to our log line, and neither is the urgency", async () => {
    const created = await book({ manual_urgency: "URGENT" });
    const { logs } = await captureLogs(() => call(myRequest, { path: `/requests/me?access_key=${created.accessKey}` }));
    expect(logs).toContain('"path":"/api/v1/requests/me"');
    expect(logs).not.toContain(created.accessKey);
    expect(logs).not.toContain("URGENT");
  });

  it("the browser's anon key is a dead end: deny-all RLS and no executable functions", async () => {
    const browser = anon();
    for (const table of ["appointment_request", "service", "staff", "availability_window", "outbound_event", "inbound_event"]) {
      const { data, error } = await browser.from(table).select("*").limit(1);
      expect(error !== null || (data ?? []).length === 0).toBe(true);
    }
    const rpc = await browser.rpc("cancel_request_by_key", { p_id: "req_x", p_key_hash: "a".repeat(64) });
    expect(rpc.error).not.toBeNull();
    const reset = await browser.rpc("reset_demo_data");
    expect(reset.error).not.toBeNull();
  });
});

describe("Abuse limits", () => {
  const address = (label: string) => `203.0.113.${label}`;

  it("one address can only submit so many requests", async () => {
    process.env.RATE_REQUESTS_PER_IP = "2";
    try {
      const headers = { "x-forwarded-for": address("10") };
      const results = [];
      for (let i = 0; i < 3; i++) {
        const slot = await nextFreeSlot();
        results.push(await submit(requestBody(slot.slot_start), headers));
      }
      expect(results.map((r) => r.status)).toEqual([201, 201, 429]);
      expect(results[2].json).toEqual({ error: "too_many_requests" });
    } finally {
      process.env.RATE_REQUESTS_PER_IP = "100000";
    }
  });

  it("the hourly cap stops a script that keeps changing address", async () => {
    process.env.RATE_REQUESTS_PER_HOUR = "0";
    try {
      const slot = await nextFreeSlot();
      const r = await submit(requestBody(slot.slot_start), { "x-forwarded-for": address("11") });
      expect(r.status).toBe(429);
    } finally {
      process.env.RATE_REQUESTS_PER_HOUR = "100000";
    }
  });

  it("guessing access keys gets locked out, but a valid key is never counted against anyone", async () => {
    process.env.RATE_KEY_FAILURES_PER_IP = "2";
    try {
      const headers = { "x-forwarded-for": address("12") };
      const created = await book();
      for (let i = 0; i < 5; i++) {
        expect((await call(myRequest, { path: `/requests/me?access_key=${created.accessKey}`, headers })).status).toBe(200);
      }
      const guess = () => call(myRequest, { path: "/requests/me?access_key=WB-AAAA-BBBB-CCCC", headers });
      expect((await guess()).status).toBe(404);
      expect((await guess()).status).toBe(404);
      expect((await guess()).status).toBe(429);
      expect((await call(myRequest, { path: `/requests/me?access_key=${created.accessKey}`, headers })).status).toBe(429);
    } finally {
      process.env.RATE_KEY_FAILURES_PER_IP = "100000";
    }
  });

  it("the AI check is limited per address too", async () => {
    process.env.RATE_TRIAGE_CHECKS_PER_IP = "1";
    try {
      const headers = { "x-forwarded-for": address("13") };
      const check = () => call(assess, { method: "POST", path: "/triage/assess", headers, body: { intake_note: "exam stress" } });
      expect((await check()).status).toBe(200);
      expect((await check()).status).toBe(429);
    } finally {
      process.env.RATE_TRIAGE_CHECKS_PER_IP = "100000";
    }
  });
});

describe("Staff sessions", () => {
  async function cookieSession() {
    const r = await signIn(
      new Request(`${BASE}/session`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ email: USERS.practitioner, password: PASSWORD }),
      }),
    );
    expect(r.status).toBe(200);
    const cookies = r.headers.getSetCookie();
    expect(cookies.length).toBeGreaterThan(0);
    for (const c of cookies) {
      expect(c).toContain("HttpOnly");
      expect(c).toContain("SameSite=Lax");
    }
    return cookies.map((c) => c.split(";")[0]).join("; ");
  }

  it("a wrong password is refused", async () => {
    const r = await call(signIn, { method: "POST", path: "/session", body: { email: USERS.practitioner, password: "wrong" } });
    expect(r.status).toBe(401);
  });

  it("a real cookie session can read, and /me reports the role", async () => {
    const cookie = await cookieSession();
    const q = await call(queue, { path: "/practitioner/queue", headers: { cookie } });
    expect(q.status).toBe(200);
    const who = await call(me, { path: "/me", headers: { cookie } });
    expect(who.json).toMatchObject({ role: "practitioner", displayName: "Demo Practitioner One" });
  });

  it("a cookie write from another site is rejected; the same write from our site works", async () => {
    const cookie = await cookieSession();
    const created = await book();
    const attempt = (origin?: string) =>
      call(decide, {
        method: "PATCH",
        path: `/requests/${created.id}/status`,
        params: { id: created.id },
        headers: { cookie, ...(origin ? { origin } : {}) },
        body: { status: "CONFIRMED" },
      });

    const evil = await attempt("https://evil.example");
    expect(evil.status).toBe(403);
    expect(evil.json).toEqual({ error: "cross_origin_rejected" });
    expect((await attempt()).status).toBe(403); // no Origin header at all is not trusted either
    const stored = await admin.from("appointment_request").select("status").eq("id", created.id).single();
    expect(stored.data!.status).toBe("PENDING");

    expect((await attempt("http://localhost:3000")).status).toBe(200);
  });

  it("a sign-in from another site is rejected", async () => {
    const r = await call(signIn, {
      method: "POST",
      path: "/session",
      headers: { origin: "https://evil.example" },
      body: { email: USERS.practitioner, password: PASSWORD },
    });
    expect(r.status).toBe(403);
  });

  it("an account with no staff row gets no role", async () => {
    const email = `not-staff-${randomUUID()}@demo.test`;
    const created = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, app_metadata: { kind: "staff" } });
    try {
      const session = await anon().auth.signInWithPassword({ email, password: PASSWORD });
      const r = await call(queue, { path: "/practitioner/queue", headers: { authorization: `Bearer ${session.data.session!.access_token}` } });
      expect(r.status).toBe(404);
    } finally {
      await admin.auth.admin.deleteUser(created.data.user!.id);
    }
  });
});

describe("Machine routes", () => {
  it("the dispatcher accepts only the machine credential", async () => {
    const none = await call(dispatchRoute, { method: "POST", path: "/internal/events/dispatch" });
    const user = await call(dispatchRoute, { method: "POST", path: "/internal/events/dispatch", as: USERS.admin });
    const wrong = await call(dispatchRoute, { method: "POST", path: "/internal/events/dispatch", headers: { authorization: "Bearer nope" } });
    for (const r of [none, user, wrong]) expect(r.status).toBe(401);
    const right = await call(dispatchRoute, { method: "POST", path: "/internal/events/dispatch", headers: { authorization: `Bearer ${process.env.DISPATCH_TOKEN}` } });
    expect(right.status).toBe(200);
  });
});

describe("Mock Notification Hub", () => {
  const event = { event_type: "appointment.confirmed", appointment_id: "req_abc", scheduled_time: "2026-11-10T03:00:00Z", privacy_buffer_end: "2026-11-10T04:00:00Z" };
  function delivery(body: unknown, secret = process.env.HUB_SIGNING_SECRET!) {
    const raw = JSON.stringify(body);
    const ts = String(Math.floor(Date.now() / 1000));
    return new Request(`${BASE}/mock/hub`, {
      method: "POST",
      headers: { [SIGNATURE_HEADER]: sign(raw, ts, secret), [TIMESTAMP_HEADER]: ts, [EVENT_ID_HEADER]: randomUUID() },
      body: raw,
    });
  }

  it("is off unless enabled, and checks the signature and the exact body when on", async () => {
    process.env.MOCK_HUB_ENABLED = "false";
    expect((await mockHub(delivery(event))).status).toBe(404);

    process.env.MOCK_HUB_ENABLED = "true";
    try {
      expect((await mockHub(delivery(event))).status).toBe(202);
      expect((await mockHub(delivery(event, "wrong-secret"))).status).toBe(401);
      expect((await mockHub(delivery({ ...event, intake_note: "x" }))).status).toBe(422);
    } finally {
      process.env.MOCK_HUB_ENABLED = "false";
    }
  });

  it("its outage switch needs the machine credential", async () => {
    process.env.MOCK_HUB_ENABLED = "true";
    try {
      const put = (headers: Record<string, string>, fail: boolean) =>
        mockHubSwitch(new Request(`${BASE}/mock/hub`, { method: "PUT", headers, body: JSON.stringify({ fail }) }));
      expect((await put({}, true)).status).toBe(401);
      const auth = { authorization: `Bearer ${process.env.DISPATCH_TOKEN}` };
      expect((await put(auth, true)).status).toBe(200);
      expect((await mockHub(delivery(event))).status).toBe(503);
      expect((await put(auth, false)).status).toBe(200);
      expect((await mockHub(delivery(event))).status).toBe(202);
    } finally {
      process.env.MOCK_HUB_ENABLED = "false";
    }
  });
});

describe("Inbound webhook receiver", () => {
  function signedRequest(body: Record<string, unknown>, opts: { secret?: string; tamper?: boolean } = {}) {
    const raw = JSON.stringify(body);
    const ts = String(Math.floor(Date.now() / 1000));
    return new Request(`${BASE}/webhooks/notification-hub`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [SIGNATURE_HEADER]: sign(raw, ts, opts.secret ?? process.env.HUB_INBOUND_SECRET!),
        [TIMESTAMP_HEADER]: ts,
      },
      body: opts.tamper ? raw.replace("notification.delivered", "notification.failed") : raw,
    });
  }

  const receipt = () => ({
    eventId: randomUUID(),
    type: "notification.delivered",
    occurredAt: new Date().toISOString(),
    source: "notification-hub",
    subject: "reference:demo",
    data: { reference: "req_abc123" },
  });

  const storedCount = async (eventId: string) =>
    (await admin.from("inbound_event").select("event_id", { count: "exact", head: true }).eq("event_id", eventId)).count;

  it("accepts a correctly signed receipt and stores it", async () => {
    const body = receipt();
    const res = await inboundWebhook(signedRequest(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, duplicate: false });
    expect(await storedCount(body.eventId)).toBe(1);
    const row = await admin.from("inbound_event").select("reference").eq("event_id", body.eventId).single();
    expect(row.data!.reference).toBe("req_abc123");
  });

  it("rejects a wrong secret and a tampered body, storing nothing", async () => {
    const body = receipt();
    expect((await inboundWebhook(signedRequest(body, { secret: "wrong" }))).status).toBe(401);
    expect((await inboundWebhook(signedRequest(body, { tamper: true }))).status).toBe(401);
    expect(await storedCount(body.eventId)).toBe(0);
  });

  it("a malformed reference is the sender's error (400), never a 500", async () => {
    const res = await inboundWebhook(signedRequest({ ...receipt(), data: { reference: "not a valid id!" } }));
    expect(res.status).toBe(400);
  });

  it("the same eventId delivered twice is acknowledged twice and stored once", async () => {
    const body = receipt();
    const first = await inboundWebhook(signedRequest(body));
    const second = await inboundWebhook(signedRequest(body));
    expect(await first.json()).toEqual({ received: true, duplicate: false });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ received: true, duplicate: true });
    expect(await storedCount(body.eventId)).toBe(1);
  });
});
