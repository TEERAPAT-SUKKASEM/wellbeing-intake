// What this test file does: it checks the exact shape of the webhook events we send to the Notification
// Hub, and the signature (HMAC) that proves a webhook really came from the right sender.
// Why it matters: it is the unit-level proof for PRD TEST-07. appointment.confirmed may carry only the
// 4 fields in PRD section 6, so no intake note, alias or urgency can ever leave the system.
// How to run it: `pnpm test`.
import { describe, expect, it } from "vitest";
import { buildEventBody, cancelledEvent, confirmedEvent, inboundEnvelope, sign, verify } from "@/lib/events/contract";

// The webhook body from the PRD, section 6.
const confirmed = {
  event_type: "appointment.confirmed",
  appointment_id: "req_8842",
  scheduled_time: "2026-11-10T10:00:00Z",
  privacy_buffer_end: "2026-11-10T11:00:00Z",
};

// The PRD's example body is accepted; the same body with any one extra field is refused.
describe("appointment.confirmed: zero sensitive data", () => {
  it("accepts exactly the PRD's example", () => {
    expect(confirmedEvent.safeParse(confirmed).success).toBe(true);
    expect(buildEventBody({ type: "appointment.confirmed", payload: confirmed })).toEqual(confirmed);
  });

  it.each(["intake_note", "alias", "urgency_level", "service_id", "access_key", "subject"])("blocks an over-full body carrying %s", (field) => {
    const overFull = { ...confirmed, [field]: "x" };
    expect(confirmedEvent.safeParse(overFull).success).toBe(false);
    expect(() => buildEventBody({ type: "appointment.confirmed", payload: overFull })).toThrow();
  });

  it("refuses a body whose type does not match its outbox row", () => {
    expect(() => buildEventBody({ type: "appointment.cancelled", payload: confirmed })).toThrow();
  });

  it("refuses times that are not exact UTC", () => {
    expect(confirmedEvent.safeParse({ ...confirmed, scheduled_time: "tomorrow" }).success).toBe(false);
    expect(confirmedEvent.safeParse({ ...confirmed, scheduled_time: "2026-11-10T10:00:00+07:00" }).success).toBe(false);
  });
});

// The cancelled event carries only its type and the appointment id, nothing more.
describe("appointment.cancelled", () => {
  it("carries the id only", () => {
    expect(cancelledEvent.safeParse({ event_type: "appointment.cancelled", appointment_id: "req_8842" }).success).toBe(true);
    expect(cancelledEvent.safeParse({ event_type: "appointment.cancelled", appointment_id: "req_8842", scheduled_time: "x" }).success).toBe(false);
  });
});

// Receipts coming back from the Hub must match the shared envelope exactly, with no extra fields.
describe("inbound receipts", () => {
  it("still use the platform envelope", () => {
    const receipt = {
      eventId: "b3e0d6c4-2f7a-4e91-8c1d-5a9f3b2e6d47",
      type: "notification.delivered",
      occurredAt: "2026-11-10T10:00:00Z",
      source: "notification-hub",
      subject: "reference:req_8842",
      data: { reference: "req_8842" },
    };
    expect(inboundEnvelope.safeParse(receipt).success).toBe(true);
    expect(inboundEnvelope.safeParse({ ...receipt, extra: 1 }).success).toBe(false);
  });
});

// A signature is valid only for the same body, the same secret and a recent timestamp (no replays).
describe("webhook signing", () => {
  const secret = "test-secret";
  const body = JSON.stringify(confirmed);
  const now = 1_790_000_000_000;
  const ts = String(now / 1000);

  it("verifies a correctly signed body", () => {
    expect(verify(body, sign(body, ts, secret), ts, secret, now)).toEqual({ ok: true });
  });

  it("rejects a tampered body", () => {
    expect(verify(body + " ", sign(body, ts, secret), ts, secret, now)).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rejects the wrong secret", () => {
    expect(verify(body, sign(body, ts, "other"), ts, secret, now)).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rejects a stale timestamp (replay bound)", () => {
    const old = String(now / 1000 - 3600);
    expect(verify(body, sign(body, old, secret), old, secret, now)).toEqual({ ok: false, reason: "stale" });
  });

  it("rejects missing headers", () => {
    expect(verify(body, null, null, secret, now)).toEqual({ ok: false, reason: "missing" });
  });
});
