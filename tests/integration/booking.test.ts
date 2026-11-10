// What this test file does: it tests the booking API end to end on the real local database: services,
// slots, new requests, the practitioner's quick actions, the schedule and the admin settings.
// Why it matters: it covers the rules around the PRD's 7 tests: no double booking (even in a race), safe
// retries, legal status changes only, staff-only actions, and admin changes that students really see.
// How to run it: `pnpm test:integration` (needs the local Supabase database from `pnpm db:start`).
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GET as getAvailability, PUT as putAvailability } from "@/app/api/v1/admin/availability/route";
import { GET as adminServices } from "@/app/api/v1/admin/services/route";
import { PATCH as patchService } from "@/app/api/v1/admin/services/[id]/route";
import { GET as schedule } from "@/app/api/v1/practitioner/schedule/route";
import { POST as cancelRequest } from "@/app/api/v1/requests/[id]/cancel/route";
import { GET as myRequest } from "@/app/api/v1/requests/me/route";
import { PATCH as decide } from "@/app/api/v1/requests/[id]/status/route";
import { GET as services } from "@/app/api/v1/services/route";
import { GET as slotsRoute } from "@/app/api/v1/slots/route";
import { POST as assess } from "@/app/api/v1/triage/assess/route";
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

// Sends a Triage Desk decision (PATCH /requests/{id}/status), logged in as a practitioner by default.
const decideAs = (id: string, body: Record<string, unknown>, as: string = USERS.practitioner) =>
  call(decide, { method: "PATCH", path: `/requests/${id}/status`, as, params: { id }, body });

// Students see the active services, in the shape the PRD defines.
describe("GET /services", () => {
  it("returns active services in the PRD's shape", async () => {
    const r = await call(services, { path: "/services" });
    expect(r.status).toBe(200);
    expect(r.json.map((s: { id: string }) => s.id)).toEqual([SERVICES.academic, SERVICES.general, SERVICES.dropIn].sort((a, b) => a.localeCompare(b)));
    expect(r.json[0]).toMatchObject({ id: SERVICES.academic, name: "Academic Stress Counselling", duration_minutes: 45, is_active: true });
  });
});

// The slot list checks its input, and never offers a past time or a time too far ahead.
describe("GET /slots", () => {
  it("validates its query and hides unknown services", async () => {
    expect((await call(slotsRoute, { path: "/slots" })).status).toBe(400);
    expect((await call(slotsRoute, { path: `/slots?service_id=${SERVICES.academic}&date=2026-02-31` })).status).toBe(400);
    expect((await call(slotsRoute, { path: "/slots?service_id=srv_nope&date=2026-12-01" })).status).toBe(404);
  });

  it("marks past times and times beyond the booking horizon unavailable", async () => {
    const past = await slotsFor(SERVICES.academic, "2020-01-06");
    expect(past.length).toBeGreaterThan(0);
    expect(past.every((s) => !s.is_available)).toBe(true);
    const farAway = await slotsFor(SERVICES.academic, "2099-01-05");
    expect(farAway.every((s) => !s.is_available)).toBe(true);
  });
});

// Booking rules: one winner per time, only real future slots, safe retries with an Idempotency-Key,
// and crisis wording always marked URGENT.
describe("POST /requests", () => {
  it("two students racing for one time: exactly one wins, the other gets refreshed slots", async () => {
    const slot = await nextFreeSlot();
    const [a, b] = await Promise.all([submit(requestBody(slot.slot_start)), submit(requestBody(slot.slot_start))]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.json.error).toBe("slot_unavailable");
    expect(loser.json.slots.find((s: { slot_start: string }) => s.slot_start === slot.slot_start).is_available).toBe(false);
  });

  it("two different services racing into overlapping times: exactly one wins", async () => {
    const date = quietWeekday(14);
    const academicAtTen = campusTime(date, "10:00");
    const dropInAtTenThirty = campusTime(date, "10:30");
    const [a, b] = await Promise.all([
      submit(requestBody(academicAtTen)),
      submit(requestBody(dropInAtTenThirty, { service_id: SERVICES.dropIn })),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
  });

  it("rejects a time that is not a real slot, and a time in the past", async () => {
    const date = quietWeekday(14);
    expect((await submit(requestBody(campusTime(date, "10:07")))).status).toBe(400); // not on the grid
    expect((await submit(requestBody(campusTime(date, "22:00")))).status).toBe(400); // closed
    expect((await submit(requestBody("2020-01-06T02:00:00Z"))).status).toBe(409); // on the grid, but past
  });

  it("rejects an unknown or inactive service", async () => {
    const slot = await nextFreeSlot();
    const r = await submit(requestBody(slot.slot_start, { service_id: "srv_nope" }));
    expect(r.status).toBe(400);
    expect(r.json.fields).toContain("service_id");
  });

  it("a retry with the same Idempotency-Key returns the same request and the same access key", async () => {
    const slot = await nextFreeSlot();
    const key = randomUUID();
    const first = await submit(requestBody(slot.slot_start), { "idempotency-key": key });
    const retry = await submit(requestBody(slot.slot_start), { "idempotency-key": key });
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.json.id).toBe(first.json.id);
    expect(retry.json.access_key).toBe(first.json.access_key);
    const { count } = await admin.from("appointment_request").select("id", { count: "exact", head: true }).eq("submission_key", key);
    expect(count).toBe(1);

    const status = await call(myRequest, { path: "/requests/me", headers: { "x-access-key": retry.json.access_key } });
    expect(status.json.id).toBe(first.json.id);
  });

  it("two identical submissions racing with one Idempotency-Key make one request", async () => {
    const slot = await nextFreeSlot();
    const key = randomUUID();
    const [a, b] = await Promise.all([
      submit(requestBody(slot.slot_start), { "idempotency-key": key }),
      submit(requestBody(slot.slot_start), { "idempotency-key": key }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.json.access_key).toBe(b.json.access_key);
  });

  it("rejects a malformed Idempotency-Key", async () => {
    const slot = await nextFreeSlot();
    expect((await submit(requestBody(slot.slot_start), { "idempotency-key": "not-a-uuid" })).status).toBe(400);
  });

  it("treats an empty alias as no alias", async () => {
    const created = await book({ alias: "   " });
    const stored = await admin.from("appointment_request").select("alias").eq("id", created.id).single();
    expect(stored.data!.alias).toBeNull();
  });

  it("marks crisis wording URGENT even if the student chose Routine", async () => {
    const created = await book({ manual_urgency: "ROUTINE", intake_note: "ฉันอยากตาย ไม่ไหวแล้ว" });
    expect(created.response.json.urgency_level).toBe("URGENT");
  });

  it("does not treat an ordinary request for help as urgent", async () => {
    const created = await book({ manual_urgency: "ROUTINE", intake_note: "I need help with exam stress" });
    expect(created.response.json.urgency_level).toBe("ROUTINE");
  });
});

// The urgency preview works with the AI off, saves nothing, logs no student text and echoes nothing back.
describe("POST /triage/assess", () => {
  it("works with the AI off, stores nothing and logs no text", async () => {
    const sentinel = "AssessSentinel I want to die";
    const before = await admin.from("appointment_request").select("id", { count: "exact", head: true });
    const { logs, result } = await captureLogs(() =>
      call(assess, { method: "POST", path: "/triage/assess", body: { intake_note: sentinel } }),
    );
    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({ urgency_level: "URGENT", triage_mode: "DETERMINISTIC_FALLBACK" });
    expect(result.json.emergency_links.length).toBeGreaterThan(0);
    expect(logs).not.toContain("AssessSentinel");
    const after = await admin.from("appointment_request").select("id", { count: "exact", head: true });
    expect(after.count).toBe(before.count);
  });

  it("rejects extra fields without echoing them", async () => {
    const r = await call(assess, { method: "POST", path: "/triage/assess", body: { intake_note: "ok", email: "echo-me" } });
    expect(r.status).toBe(400);
    expect(r.text).not.toContain("echo-me");
  });
});

// Approve, reject, reschedule and cancel hold or free the time correctly; illegal moves and
// non-practitioners are refused.
describe("PATCH /requests/{id}/status: the Triage Desk's quick actions", () => {
  it("approve, then the student sees CONFIRMED", async () => {
    const created = await book();
    const r = await decideAs(created.id, { status: "CONFIRMED" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ id: created.id, status: "CONFIRMED", intake_note: "Feeling overwhelmed with upcoming exams." });
    expect(r.text).not.toContain("access_key");
    const mine = await call(myRequest, { path: `/requests/me?access_key=${created.accessKey}` });
    expect(mine.json.status).toBe("CONFIRMED");
  });

  it("records which practitioner decided, without exposing it", async () => {
    const created = await book();
    const r = await decideAs(created.id, { status: "CONFIRMED" });
    expect(r.text).not.toContain("decided_by");
    const stored = await admin.from("appointment_request").select("decided_by, decided_at").eq("id", created.id).single();
    expect(stored.data!.decided_by).toBeTruthy();
    expect(stored.data!.decided_at).toBeTruthy();
  });

  it("reject releases the time", async () => {
    const created = await book();
    expect((await decideAs(created.id, { status: "REJECTED" })).json.status).toBe("REJECTED");
    expect((await submit(requestBody(created.slot.slot_start))).status).toBe(201);
  });

  it("reschedule moves the request and frees the old time", async () => {
    const created = await book();
    const target = await nextFreeSlot();
    const r = await decideAs(created.id, { status: "CONFIRMED", requested_slot_start: target.slot_start });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ status: "CONFIRMED", requested_slot_start: target.slot_start });
    expect((await slotsFor(SERVICES.academic, campusDateOf(new Date(target.slot_start)))).find((s) => s.slot_start === target.slot_start)?.is_available).toBe(false);
    expect((await submit(requestBody(created.slot.slot_start))).status).toBe(201);
  });

  it("reschedule refuses a taken time, and a time that is not a slot", async () => {
    const created = await book();
    const other = await book();
    const taken = await decideAs(created.id, { status: "CONFIRMED", requested_slot_start: other.slot.slot_start });
    expect(taken.status).toBe(409);
    expect(taken.json.error).toBe("slot_unavailable");

    const offGrid = await decideAs(created.id, { status: "CONFIRMED", requested_slot_start: campusTime(quietWeekday(14), "10:07") });
    expect(offGrid.status).toBe(400);

    const stored = await admin.from("appointment_request").select("status").eq("id", created.id).single();
    expect(stored.data!.status).toBe("PENDING");
  });

  it("cancel by a practitioner releases a confirmed time", async () => {
    const created = await book();
    await decideAs(created.id, { status: "CONFIRMED" });
    expect((await decideAs(created.id, { status: "CANCELLED" })).json.status).toBe("CANCELLED");
    expect((await submit(requestBody(created.slot.slot_start))).status).toBe(201);
  });

  it("only legal moves are allowed", async () => {
    const created = await book();
    await decideAs(created.id, { status: "REJECTED" });
    for (const status of ["CONFIRMED", "CANCELLED"]) {
      const r = await decideAs(created.id, { status });
      expect(r.status).toBe(409);
      expect(r.json.error).toBe("invalid_transition");
    }
    const confirmed = await book();
    await decideAs(confirmed.id, { status: "CONFIRMED" });
    expect((await decideAs(confirmed.id, { status: "REJECTED" })).status).toBe(409);

    expect((await decideAs(confirmed.id, { status: "PENDING" })).status).toBe(400);
    expect((await decideAs(confirmed.id, { status: "CONFIRMED", intake_note: "edited" })).status).toBe(400);
    expect((await decideAs(confirmed.id, { status: "REJECTED", requested_slot_start: confirmed.slot.slot_start })).status).toBe(400);
  });

  it("a student cannot cancel a rejected request back into anything", async () => {
    const created = await book();
    await decideAs(created.id, { status: "REJECTED" });
    const r = await call(cancelRequest, {
      method: "POST",
      path: `/requests/${created.id}/cancel`,
      params: { id: created.id },
      body: { access_key: created.accessKey },
    });
    expect(r.status).toBe(409);
  });

  it("an unknown request is 404, and only practitioners can decide", async () => {
    expect((await decideAs("req_doesnotexist", { status: "CONFIRMED" })).status).toBe(404);
    const created = await book();
    expect((await decideAs(created.id, { status: "CONFIRMED" }, USERS.admin)).status).toBe(404);
    const anonymous = await call(decide, {
      method: "PATCH",
      path: `/requests/${created.id}/status`,
      params: { id: created.id },
      body: { status: "CONFIRMED" },
    });
    expect(anonymous.status).toBe(401);
  });
});

// The practitioner timeline shows each session with its buffer end, and needs a practitioner login.
describe("GET /practitioner/schedule", () => {
  it("returns pending and confirmed sessions with their buffer ends", async () => {
    const created = await book();
    const date = campusDateOf(new Date(created.slot.slot_start));
    const r = await call(schedule, { path: `/practitioner/schedule?from=${date}&to=${date}`, as: USERS.practitioner });
    expect(r.status).toBe(200);
    const item = r.json.find((x: { id: string }) => x.id === created.id);
    expect(item.privacy_buffer_end).toBe(new Date(new Date(created.slot.slot_end).getTime() + 15 * 60_000).toISOString().replace(".000Z", "Z"));
    expect(r.text).not.toContain("access_key");
  });

  it("validates dates and requires a practitioner", async () => {
    expect((await call(schedule, { path: "/practitioner/schedule?from=nope", as: USERS.practitioner })).status).toBe(400);
    expect((await call(schedule, { path: "/practitioner/schedule?from=2026-01-01&to=2026-06-01", as: USERS.practitioner })).status).toBe(400);
    expect((await call(schedule, { path: "/practitioner/schedule" })).status).toBe(401);
  });
});

// Only an admin can change services and opening hours, and students see each change at once.
describe("Administrator configuration", () => {
  it("only an administrator can reach it", async () => {
    for (const r of [
      await call(adminServices, { path: "/admin/services" }),
      await call(getAvailability, { path: "/admin/availability" }),
    ]) {
      expect(r.status).toBe(401);
    }
    expect((await call(adminServices, { path: "/admin/services", as: USERS.practitioner })).status).toBe(404);
    expect((await call(getAvailability, { path: "/admin/availability", as: USERS.practitioner })).status).toBe(404);
  });

  it("deactivating a service removes it for students, and it can be turned back on", async () => {
    const off = await call(patchService, {
      method: "PATCH",
      path: `/admin/services/${SERVICES.general}`,
      as: USERS.admin,
      params: { id: SERVICES.general },
      body: { is_active: false },
    });
    expect(off.status).toBe(200);
    try {
      const list = await call(services, { path: "/services" });
      expect(list.json.map((s: { id: string }) => s.id)).not.toContain(SERVICES.general);
      const all = await call(adminServices, { path: "/admin/services", as: USERS.admin });
      expect(all.json.find((s: { id: string }) => s.id === SERVICES.general).is_active).toBe(false);
      const slot = await nextFreeSlot();
      expect((await submit(requestBody(slot.slot_start, { service_id: SERVICES.general }))).status).toBe(400);
    } finally {
      await call(patchService, {
        method: "PATCH",
        path: `/admin/services/${SERVICES.general}`,
        as: USERS.admin,
        params: { id: SERVICES.general },
        body: { is_active: true },
      });
    }
  });

  it("rejects an empty change and an unknown service", async () => {
    const empty = await call(patchService, { method: "PATCH", path: `/admin/services/${SERVICES.general}`, as: USERS.admin, params: { id: SERVICES.general }, body: {} });
    expect(empty.status).toBe(400);
    const unknown = await call(patchService, { method: "PATCH", path: "/admin/services/srv_nope", as: USERS.admin, params: { id: "srv_nope" }, body: { is_active: true } });
    expect(unknown.status).toBe(404);
  });

  it("changing opening hours changes the slots students see", async () => {
    const before = await call(getAvailability, { path: "/admin/availability", as: USERS.admin });
    expect(before.json.windows).toHaveLength(5);
    const date = quietWeekday(14);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    try {
      const r = await call(putAvailability, {
        method: "PUT",
        path: "/admin/availability",
        as: USERS.admin,
        body: { windows: [{ weekday, start_time: "13:00", end_time: "15:00" }] },
      });
      expect(r.status).toBe(200);
      expect(r.json.windows).toEqual([{ weekday, start_time: "13:00", end_time: "15:00" }]);
      const slots = await slotsFor(SERVICES.academic, date);
      expect(slots.map((s) => s.slot_start)).toEqual([
        campusTime(date, "13:00").replace(".000Z", "Z"),
        campusTime(date, "14:00").replace(".000Z", "Z"),
      ]);
    } finally {
      await call(putAvailability, { method: "PUT", path: "/admin/availability", as: USERS.admin, body: { windows: before.json.windows } });
    }
  });

  it("rejects overlapping or backwards hours", async () => {
    const put = (windows: unknown[]) => call(putAvailability, { method: "PUT", path: "/admin/availability", as: USERS.admin, body: { windows } });
    expect((await put([{ weekday: 1, start_time: "12:00", end_time: "09:00" }])).status).toBe(400);
    expect((await put([
      { weekday: 1, start_time: "09:00", end_time: "12:00" },
      { weekday: 1, start_time: "11:00", end_time: "13:00" },
    ])).status).toBe(400);
    const after = await call(getAvailability, { path: "/admin/availability", as: USERS.admin });
    expect(after.json.windows).toHaveLength(5); // nothing was changed
  });
});
