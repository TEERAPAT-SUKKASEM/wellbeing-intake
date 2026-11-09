import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// The PRD's webhook contract. The body is exactly the PRD's fields and nothing else: no alias, no
// intake note, no urgency, no service. Everything a receiver needs for safety goes in headers, so the
// body stays clean: X-Event-Id (stable across retries, for de-duplication) and the HMAC signature.
// This file has no server-only dependency so the contract can be unit-tested directly.

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export const confirmedEvent = z
  .object({
    event_type: z.literal("appointment.confirmed"),
    appointment_id: z.string().regex(/^req_[a-z0-9]+$/),
    scheduled_time: z.string().regex(ISO_UTC),
    privacy_buffer_end: z.string().regex(ISO_UTC),
  })
  .strict();

/** Added to the PRD: without it the Hub would keep reminding about a cancelled appointment. */
export const cancelledEvent = z
  .object({
    event_type: z.literal("appointment.cancelled"),
    appointment_id: z.string().regex(/^req_[a-z0-9]+$/),
  })
  .strict();

export const outboundEvent = z.discriminatedUnion("event_type", [confirmedEvent, cancelledEvent]);
export type OutboundEvent = z.infer<typeof outboundEvent>;

/** Validated again at send time: nothing over-full ever leaves. */
export function buildEventBody(row: { type: string; payload: unknown }): OutboundEvent {
  const body = outboundEvent.parse(row.payload);
  if (body.event_type !== row.type) throw new Error("event_type_mismatch");
  return body;
}

// Delivery receipts FROM the Notification Hub still arrive in the platform envelope.
export const inboundEnvelope = z
  .object({
    eventId: z.uuid(),
    type: z.string().min(1),
    occurredAt: z.iso.datetime(),
    source: z.string().min(1),
    subject: z.string().min(1),
    data: z.record(z.string(), z.unknown()),
  })
  .strict();

// --- Signing ---------------------------------------------------------------
// HMAC-SHA256 over `${timestamp}.${rawBody}` with a shared secret. The timestamp bounds replay.

export const EVENT_ID_HEADER = "x-event-id";
export const SIGNATURE_HEADER = "x-signature";
export const TIMESTAMP_HEADER = "x-signature-timestamp";
export const MAX_SKEW_SECONDS = 300;

export function sign(rawBody: string, timestamp: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export type VerifyResult = { ok: true } | { ok: false; reason: "missing" | "stale" | "mismatch" };

export function verify(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  secret: string,
  now: number = Date.now(),
): VerifyResult {
  if (!signature || !timestamp) return { ok: false, reason: "missing" };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > MAX_SKEW_SECONDS) {
    return { ok: false, reason: "stale" };
  }
  const expected = Buffer.from(sign(rawBody, timestamp, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true };
}
