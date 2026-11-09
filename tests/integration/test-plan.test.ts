import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as cancelRequest } from "@/app/api/v1/requests/[id]/cancel/route";
import { PATCH as decide } from "@/app/api/v1/requests/[id]/status/route";
import { GET as myRequest } from "@/app/api/v1/requests/me/route";
import { GET as queue } from "@/app/api/v1/practitioner/queue/route";
import { EVENT_ID_HEADER, SIGNATURE_HEADER, TIMESTAMP_HEADER, verify } from "@/lib/events/contract";
import { campusDateOf } from "@/lib/slots/grid";
import {
  SERVICES,
  USERS,
  admin,
  book,
  call,
  campusTime,
  captureLogs,
  nextFreeSlot,
  quietWeekday,
  requestBody,
  slotsFor,
  submit,
} from "./helpers";

// The PRD's 7 essential test paths (docs/PRD.md, section 7), one describe block each.

const KEY_FORMAT = /^WB-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/;

describe("TEST-01 Privacy Boundary: anonymous request submission", () => {
  it("succeeds with no email, legal identity or auth token", async () => {
    const slot = await nextFreeSlot();
    const r = await submit(requestBody(slot.slot_start));

    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ status: "PENDING", urgency_level: "ROUTINE" });
    expect(r.json.id).toMatch(/^req_[a-z0-9]+$/);
    expect(r.json.access_key).toMatch(KEY_FORMAT);
  });

  it("also succeeds with no alias at all", async () => {
    const slot = await nextFreeSlot();
    const body: Record<string, unknown> = requestBody(slot.slot_start);
    delete body.alias;
    const r = await submit(body);
    expect(r.status).toBe(201);
    const stored = await admin.from("appointment_request").select("alias").eq("id", r.json.id).single();
    expect(stored.data!.alias).toBeNull();
  });

  it("has nowhere to put identity: such fields are rejected and no such column exists", async () => {
    const slot = await nextFreeSlot();
    for (const field of ["email", "student_id", "legal_name"]) {
      const r = await submit(requestBody(slot.slot_start, { [field]: "x" }));
      expect(r.status).toBe(400);
    }
    const created = await book();
    const { data } = await admin.from("appointment_request").select("*").eq("id", created.id).single();
    expect(Object.keys(data!).sort()).toEqual(
      [
        "access_key_hash", "alias", "buffer_end", "created_at", "decided_at", "decided_by", "id", "intake_note",
        "service_id", "slot_end", "slot_start", "status", "submission_key", "triage_mode", "urgency_level",
      ].sort(),
    );
  });

  it("stores only a hash of the access key, unrelated to the request id", async () => {
    const created = await book();
    const { data } = await admin.from("appointment_request").select("*").eq("id", created.id).single();
    expect(JSON.stringify(data)).not.toContain(created.accessKey);
    expect(data!.access_key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(created.accessKey).not.toContain(created.id.replace("req_", "").slice(0, 4).toUpperCase());
  });
});

describe("TEST-02 Business Logic: 15-minute privacy buffer", () => {
  const date = quietWeekday(20);
  const at = (time: string) => campusTime(date, time).replace(".000Z", "Z");
  let accessKey: string;
  let id: string;

  beforeAll(async () => {
    const r = await submit(requestBody(at("10:00")));
    expect(r.status).toBe(201);
    ({ id, access_key: accessKey } = r.json);
    expect(r.json.requested_slot_end).toBe(at("10:45"));
    expect(r.json.privacy_buffer_end).toBe(at("11:00"));
  });

  it("booking 10:00-10:45 shows that slot as unavailable and the next slot only from 11:00", async () => {
    const slots = await slotsFor(SERVICES.academic, date);
    expect(slots.find((s) => s.slot_start === at("10:00"))).toMatchObject({ slot_end: at("10:45"), is_available: false });
    expect(slots.find((s) => s.slot_start === at("11:00"))?.is_available).toBe(true);
    expect(slots.find((s) => s.slot_start === at("09:00"))?.is_available).toBe(true); // its own buffer ends exactly at 10:00
  });

  it("no service offers any time touching 10:00-11:00, including a shorter service", async () => {
    for (const service of Object.values(SERVICES)) {
      for (const slot of await slotsFor(service, date)) {
        if (slot.is_available) {
          const startsInside = slot.slot_start >= at("10:00") && slot.slot_start < at("11:00");
          expect(startsInside).toBe(false);
        }
      }
    }
    const dropIn = await slotsFor(SERVICES.dropIn, date); // 30 minutes: 09:00, 09:45, 10:30, 11:15 ...
    expect(dropIn.find((s) => s.slot_start === at("09:45"))?.is_available).toBe(false); // its buffer would reach 10:30
    expect(dropIn.find((s) => s.slot_start === at("10:30"))?.is_available).toBe(false);
    expect(dropIn.find((s) => s.slot_start === at("11:15"))?.is_available).toBe(true);
  });

  it("refuses a booking inside the buffer through the API and in the database itself", async () => {
    const viaApi = await submit(requestBody(at("10:30"), { service_id: SERVICES.dropIn }));
    expect(viaApi.status).toBe(409);
    expect(viaApi.json.error).toBe("slot_unavailable");
    expect(Array.isArray(viaApi.json.slots)).toBe(true); // refreshed availability for the picker

    // Skipping every application check, straight at 10:45: the constraint still says no.
    const direct = await admin.rpc("create_appointment_request", {
      p_key_hash: "a".repeat(64),
      p_submission_key: null,
      p_service: SERVICES.academic,
      p_alias: null,
      p_note: "buffer test",
      p_urgency: "ROUTINE",
      p_mode: "DETERMINISTIC_FALLBACK",
      p_start: at("10:45"),
    });
    expect(direct.error).toBeNull();
    expect((direct.data as { code: string }).code).toBe("slot_unavailable");
  });

  it("reveals nothing about what is holding a slot", async () => {
    for (const slot of await slotsFor(SERVICES.academic, date)) {
      expect(Object.keys(slot).sort()).toEqual(["is_available", "slot_end", "slot_start"]);
    }
  });

  afterAll(async () => {
    await call(cancelRequest, { method: "POST", path: `/requests/${id}/cancel`, params: { id }, body: { access_key: accessKey } });
  });
});

describe("TEST-03 Core Flow: status check by access key", () => {
  it("a valid key returns the accurate request", async () => {
    const created = await book({ alias: "StatusCheck" });
    const r = await call(myRequest, { path: `/requests/me?access_key=${created.accessKey}` });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      id: created.id,
      access_key: created.accessKey,
      service_id: SERVICES.academic,
      alias: "StatusCheck",
      urgency_level: "ROUTINE",
      triage_mode: "DETERMINISTIC_FALLBACK",
      requested_slot_start: created.slot.slot_start,
      requested_slot_end: created.slot.slot_end,
      status: "PENDING",
    });
    expect(r.text).not.toContain("hash");
  });

  it("works from the header too, and forgives case and spaces", async () => {
    const created = await book();
    const header = await call(myRequest, { path: "/requests/me", headers: { "x-access-key": created.accessKey } });
    expect(header.status).toBe(200);
    const typed = await call(myRequest, { path: `/requests/me?access_key=${encodeURIComponent(` ${created.accessKey.toLowerCase()} `)}` });
    expect(typed.json.id).toBe(created.id);
  });

  it("an invalid key returns 404, identical whether malformed, well-formed or missing", async () => {
    const malformed = await call(myRequest, { path: "/requests/me?access_key=WB-9842-X" });
    const unknown = await call(myRequest, { path: "/requests/me?access_key=WB-AAAA-BBBB-CCCC" });
    const missing = await call(myRequest, { path: "/requests/me" });
    for (const r of [malformed, unknown, missing]) {
      expect(r.status).toBe(404);
      expect(r.text).toBe(unknown.text);
    }
  });
});

describe("TEST-04 Core Flow: anonymous cancellation", () => {
  const cancel = (id: string, accessKey: string) =>
    call(cancelRequest, { method: "POST", path: `/requests/${id}/cancel`, params: { id }, body: { access_key: accessKey } });

  it("switches to CANCELLED and immediately releases the slot and its buffer", async () => {
    const created = await book();
    const date = campusDateOf(new Date(created.slot.slot_start));
    const before = await slotsFor(SERVICES.academic, date);
    expect(before.find((s) => s.slot_start === created.slot.slot_start)?.is_available).toBe(false);

    const r = await cancel(created.id, created.accessKey);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ id: created.id, status: "CANCELLED" });
    const status = await call(myRequest, { path: `/requests/me?access_key=${created.accessKey}` });
    expect(status.json.status).toBe("CANCELLED");

    const slots = await slotsFor(SERVICES.academic, date);
    expect(slots.find((s) => s.slot_start === created.slot.slot_start)?.is_available).toBe(true);
    const again = await submit(requestBody(created.slot.slot_start));
    expect(again.status).toBe(201);
    await cancel(again.json.id, again.json.access_key);
  });

  it("a wrong key changes nothing and looks like a request that does not exist", async () => {
    const created = await book();
    const wrong = await cancel(created.id, "WB-AAAA-BBBB-CCCC");
    const absent = await cancel("req_doesnotexist", "WB-AAAA-BBBB-CCCC");
    expect(wrong.status).toBe(404);
    expect(wrong.text).toBe(absent.text);
    const stored = await admin.from("appointment_request").select("status").eq("id", created.id).single();
    expect(stored.data!.status).toBe("PENDING");
  });

  it("cancelling twice is harmless", async () => {
    const created = await book();
    expect((await cancel(created.id, created.accessKey)).status).toBe(200);
    expect((await cancel(created.id, created.accessKey)).status).toBe(200);
  });
});

describe("TEST-05 Role Boundary: practitioner queue", () => {
  it("rejects calls without credentials with 401", async () => {
    const none = await call(queue, { path: "/practitioner/queue" });
    const bad = await call(queue, { path: "/practitioner/queue", headers: { authorization: "Bearer not-a-token" } });
    for (const r of [none, bad]) {
      expect(r.status).toBe(401);
      expect(r.json).toEqual({ error: "unauthenticated" });
    }
  });

  it("keeps the queue from other staff roles and from access keys", async () => {
    const created = await book();
    expect((await call(queue, { path: "/practitioner/queue", as: USERS.admin })).status).toBe(404);

    const r = await call(queue, { path: "/practitioner/queue", as: USERS.practitioner });
    expect(r.status).toBe(200);
    expect(r.text).not.toContain(created.accessKey);
    expect(r.text).not.toContain("access_key");
  });

  it("pins Urgent to the top", async () => {
    await book({ manual_urgency: "ROUTINE" });
    await book({ manual_urgency: "URGENT" });
    const r = await call(queue, { path: "/practitioner/queue", as: USERS.practitioner });
    const levels = (r.json as { urgency_level: string }[]).map((x) => x.urgency_level);
    expect(levels[0]).toBe("URGENT");
    expect(levels.lastIndexOf("URGENT")).toBeLessThan(levels.indexOf("ROUTINE"));
  });
});

describe("TEST-06 AI & Fallback: AI triage processing failure", () => {
  let llm: Server;
  let llmMode: "error" | "routine" | "urgent" = "error";
  let llmBodies: string[] = [];

  beforeAll(async () => {
    llm = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        llmBodies.push(raw);
        if (llmMode === "error") {
          res.writeHead(500).end("{}");
          return;
        }
        const content = JSON.stringify({ urgency: llmMode === "urgent" ? "URGENT" : "ROUTINE" });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content } }] }));
      });
    });
    await new Promise<void>((resolve) => llm.listen(0, "127.0.0.1", resolve));
    process.env.LLM_BASE_URL = `http://127.0.0.1:${(llm.address() as AddressInfo).port}`;
    process.env.LLM_API_KEY = "test-key";
    process.env.AI_TRIAGE_ENABLED = "true";
  });

  afterAll(async () => {
    process.env.LLM_BASE_URL = "";
    process.env.LLM_API_KEY = "";
    process.env.AI_TRIAGE_ENABLED = "false";
    await new Promise((resolve) => llm.close(resolve));
  });

  beforeEach(() => {
    llmMode = "error";
    llmBodies = [];
  });

  it("defaults to the student's manual choice and gives emergency links when the AI errors", async () => {
    const { logs, result: urgent } = await captureLogs(() => book({ ai_opt_in: true, manual_urgency: "URGENT" }));
    expect(llmBodies).toHaveLength(1); // the AI really was tried
    expect(urgent.response.status).toBe(201);
    expect(urgent.response.json).toMatchObject({ urgency_level: "URGENT", triage_mode: "DETERMINISTIC_FALLBACK" });
    expect(urgent.response.json.emergency_links.length).toBeGreaterThan(0);
    expect(urgent.response.json.emergency_links[0].href).toMatch(/^tel:/);
    expect(urgent.response.json.disclaimer).toMatch(/cannot provide immediate help/);
    expect(logs).toContain('"reason":"ai_unavailable"');

    const routine = await book({ ai_opt_in: true, manual_urgency: "ROUTINE" });
    expect(routine.response.json).toMatchObject({ urgency_level: "ROUTINE", triage_mode: "DETERMINISTIC_FALLBACK" });
  });

  it("the keyword rule still catches a crisis while the AI is down", async () => {
    const r = await book({ ai_opt_in: true, manual_urgency: "ROUTINE", intake_note: "I want to kill myself" });
    expect(r.response.json).toMatchObject({ urgency_level: "URGENT", triage_mode: "DETERMINISTIC_FALLBACK" });
  });

  it("falls back when the daily AI budget is exhausted, for real, through the database", async () => {
    process.env.AI_DAILY_BUDGET = "0";
    try {
      const { logs, result } = await captureLogs(() => book({ ai_opt_in: true }));
      expect(result.response.status).toBe(201);
      expect(llmBodies).toHaveLength(0); // no budget means no call
      expect(logs).toContain('"reason":"budget_exhausted"');
    } finally {
      process.env.AI_DAILY_BUDGET = "100000";
    }
  });

  it("uses the AI when it works, and it can raise urgency but never lower the student's choice", async () => {
    llmMode = "urgent";
    const raised = await book({ ai_opt_in: true, manual_urgency: "ROUTINE" });
    expect(raised.response.json).toMatchObject({ urgency_level: "URGENT", triage_mode: "AI_ASSISTED" });

    llmMode = "routine";
    const kept = await book({ ai_opt_in: true, manual_urgency: "URGENT" });
    expect(kept.response.json).toMatchObject({ urgency_level: "URGENT", triage_mode: "AI_ASSISTED" });
    const calm = await book({ ai_opt_in: true, manual_urgency: "ROUTINE" });
    expect(calm.response.json).toMatchObject({ urgency_level: "ROUTINE", triage_mode: "AI_ASSISTED" });
  });

  it("never contacts the AI unless the student chose it", async () => {
    llmMode = "urgent";
    const r = await book({ manual_urgency: "ROUTINE" });
    expect(llmBodies).toHaveLength(0);
    expect(r.response.json).toMatchObject({ urgency_level: "ROUTINE", triage_mode: "DETERMINISTIC_FALLBACK" });
  });

  it("sends the AI the note and nothing that could identify anyone", async () => {
    llmMode = "routine";
    await book({ ai_opt_in: true, alias: "AliasSentinel" });
    expect(llmBodies).toHaveLength(1);
    expect(llmBodies[0]).toContain("Feeling overwhelmed with upcoming exams.");
    expect(llmBodies[0]).not.toContain("AliasSentinel");
  });
});

describe("TEST-07 Inter-team Webhook: outbound confirmation", () => {
  type Received = { headers: Record<string, string | string[] | undefined>; raw: string; body: Record<string, unknown> };
  let hub: Server;
  let received: Received[] = [];
  let failNext = 0;

  beforeAll(async () => {
    hub = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        if (failNext > 0) {
          failNext--;
          res.writeHead(503).end("{}");
          return;
        }
        received.push({ headers: req.headers, raw, body: JSON.parse(raw) });
        res.writeHead(202, { "content-type": "application/json" }).end(JSON.stringify({ accepted: true }));
      });
    });
    await new Promise<void>((resolve) => hub.listen(0, "127.0.0.1", resolve));
    process.env.HUB_WEBHOOK_URL = `http://127.0.0.1:${(hub.address() as AddressInfo).port}/hub`;
  });

  afterAll(async () => {
    process.env.HUB_WEBHOOK_URL = "";
    await new Promise((resolve) => hub.close(resolve));
  });

  beforeEach(async () => {
    received = [];
    failNext = 0;
    // Events left by other tests must not use up the small inline delivery batch.
    await admin.from("outbound_event").delete().is("delivered_at", null);
  });

  afterEach(() => {
    failNext = 0;
  });

  const decideAs = (id: string, body: Record<string, unknown>) =>
    call(decide, { method: "PATCH", path: `/requests/${id}/status`, as: USERS.practitioner, params: { id }, body });

  it("fires on confirmation with exactly the PRD's fields and no personal intake text", async () => {
    const created = await book({ alias: "HookAliasSentinel", intake_note: "HookNoteSentinel feeling low" });
    expect(received).toHaveLength(0); // submitting alone sends nothing

    const r = await decideAs(created.id, { status: "CONFIRMED" });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe("CONFIRMED");
    expect(received).toHaveLength(1);

    const { body, raw, headers } = received[0];
    const start = new Date(created.slot.slot_start).getTime();
    expect(body).toEqual({
      event_type: "appointment.confirmed",
      appointment_id: created.id,
      scheduled_time: created.slot.slot_start,
      privacy_buffer_end: new Date(start + 60 * 60_000).toISOString().replace(".000Z", "Z"),
    });
    expect(raw).not.toMatch(/HookAliasSentinel|HookNoteSentinel|urgency|srv_/);
    expect(raw).not.toContain(created.accessKey);

    const verdict = verify(raw, String(headers[SIGNATURE_HEADER]), String(headers[TIMESTAMP_HEADER]), process.env.HUB_SIGNING_SECRET!);
    expect(verdict).toEqual({ ok: true });
    expect(headers[EVENT_ID_HEADER]).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers["x-correlation-id"]).toBeTruthy();
  });

  it("fires only once, however many times the button is pressed", async () => {
    const created = await book();
    await decideAs(created.id, { status: "CONFIRMED" });
    expect((await decideAs(created.id, { status: "CONFIRMED" })).status).toBe(200);
    expect(received.filter((e) => e.body.appointment_id === created.id)).toHaveLength(1);
  });

  it("does not fire on rejection", async () => {
    const created = await book();
    await decideAs(created.id, { status: "REJECTED" });
    expect(received.filter((e) => e.body.appointment_id === created.id)).toHaveLength(0);
  });

  it("a hub outage never blocks the decision, and the event retries with the same id", async () => {
    failNext = 99;
    const created = await book();
    const r = await decideAs(created.id, { status: "CONFIRMED" });
    expect(r.status).toBe(200); // the practitioner is not affected

    const first = await admin.from("outbound_event").select("*").eq("reference", created.id).single();
    expect(first.data!.delivered_at).toBeNull();

    failNext = 0;
    await admin.from("outbound_event").update({ next_attempt_at: new Date().toISOString() }).eq("event_id", first.data!.event_id);
    const { dispatch } = await import("@/lib/events/dispatcher");
    await dispatch("test-recovery");

    const delivered = received.filter((e) => e.body.appointment_id === created.id);
    expect(delivered).toHaveLength(1);
    expect(delivered[0].headers[EVENT_ID_HEADER]).toBe(first.data!.event_id);
    const after = await admin.from("outbound_event").select("delivered_at, payload").eq("event_id", first.data!.event_id).single();
    expect(after.data!.delivered_at).not.toBeNull();
    expect(after.data!.payload).toBeNull();
  });

  it("the database itself refuses a payload with extra fields", async () => {
    const { error } = await admin.from("outbound_event").insert({
      type: "appointment.confirmed",
      reference: "req_x",
      payload: {
        event_type: "appointment.confirmed",
        appointment_id: "req_x",
        scheduled_time: "2026-11-10T10:00:00Z",
        privacy_buffer_end: "2026-11-10T11:00:00Z",
        intake_note: "should never be possible",
      },
    });
    expect(error).not.toBeNull();
  });

  it("retracts with appointment.cancelled when a confirmed appointment is cancelled", async () => {
    const created = await book();
    await decideAs(created.id, { status: "CONFIRMED" });
    received = [];
    const r = await call(cancelRequest, {
      method: "POST",
      path: `/requests/${created.id}/cancel`,
      params: { id: created.id },
      body: { access_key: created.accessKey },
    });
    expect(r.status).toBe(200);
    expect(received.map((e) => e.body)).toEqual([{ event_type: "appointment.cancelled", appointment_id: created.id }]);
  });

  it("a reschedule publishes the new time, and an undelivered old time can never go out", async () => {
    failNext = 1; // the first confirmation fails, so the old time is left waiting to retry
    const created = await book();
    await decideAs(created.id, { status: "CONFIRMED" });
    expect(received).toHaveLength(0);

    const newSlot = await nextFreeSlot();
    const moved = await decideAs(created.id, { status: "CONFIRMED", requested_slot_start: newSlot.slot_start });
    expect(moved.status).toBe(200);
    expect(moved.json.requested_slot_start).toBe(newSlot.slot_start);

    await admin.from("outbound_event").update({ next_attempt_at: new Date().toISOString() }).eq("reference", created.id).is("delivered_at", null);
    const { dispatch } = await import("@/lib/events/dispatcher");
    await dispatch("test-reschedule");

    const events = received.filter((e) => e.body.appointment_id === created.id);
    expect(events).toHaveLength(1);
    expect(events[0].body.scheduled_time).toBe(newSlot.slot_start);
  });
});
