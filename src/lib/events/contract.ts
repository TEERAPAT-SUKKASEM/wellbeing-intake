// What this file does: defines the exact webhook messages we send (appointment.confirmed and
// appointment.cancelled), the receipts we accept back, and how a message is signed and checked.
// Why it exists: the PRD says the webhook must carry no sensitive data. A strict schema means nothing
// extra can leave, and the signature means nobody can fake a message or send an old copy again.
// Used by: the dispatcher (signs and sends), the Notification Hub receipt route and the mock Hub
// (check signatures), and the unit and integration tests.
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// The PRD's webhook contract. The body is exactly the PRD's fields and nothing else: no alias, no
// intake note, no urgency, no service. Everything a receiver needs for safety goes in headers, so the
// body stays clean: X-Event-Id (stable across retries, for de-duplication) and the HMAC signature.
// This file has no server-only dependency so the contract can be unit-tested directly.

// A UTC time with no fractions of a second, e.g. 2026-11-10T10:00:00Z.
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

// The appointment.confirmed body. zod is a library that checks data has the expected shape, and
// .strict() rejects any extra field, so private data has no way to slip into the message.
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

// Any message we send: one of the two events above, picked by its event_type field.
export const outboundEvent = z.discriminatedUnion("event_type", [confirmedEvent, cancelledEvent]);
export type OutboundEvent = z.infer<typeof outboundEvent>;

/** Validated again at send time: nothing over-full ever leaves. */
export function buildEventBody(row: { type: string; payload: unknown }): OutboundEvent {
  const body = outboundEvent.parse(row.payload);
  // The outbox row's type and the body's event_type must agree, so a row cannot go out as the wrong event.
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
//
// HMAC is a signature made with a secret that only we and the Hub know. Without the secret nobody can
// make a valid signature, and if even one character of the body changes the signature no longer fits.
// So the Hub knows the message really came from us and was not changed on the way (no forgery).
// The timestamp is signed too, so it cannot be changed. The receiver refuses messages more than
// MAX_SKEW_SECONDS old, so a copied message cannot be "replayed" (sent again) later. Inside that
// window, the X-Event-Id header lets the receiver drop a copy it has already handled.

export const EVENT_ID_HEADER = "x-event-id";
export const SIGNATURE_HEADER = "x-signature";
export const TIMESTAMP_HEADER = "x-signature-timestamp";
// 5 minutes: enough room for small clock differences between two servers.
export const MAX_SKEW_SECONDS = 300;

/** Makes the X-Signature value: "sha256=" plus the hex HMAC of "<timestamp>.<raw body>". */
export function sign(rawBody: string, timestamp: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

// The result of a check. The reason says only which check failed, never anything from the message.
export type VerifyResult = { ok: true } | { ok: false; reason: "missing" | "stale" | "mismatch" };

/** Checks a received message's signature and timestamp against the shared secret. */
export function verify(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  secret: string,
  now: number = Date.now(),
): VerifyResult {
  if (!signature || !timestamp) return { ok: false, reason: "missing" };
  // The timestamp is Unix time in seconds. Refuse it if it is more than 5 minutes away from our
  // clock, in the past or in the future.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > MAX_SKEW_SECONDS) {
    return { ok: false, reason: "stale" };
  }
  // Work out the signature we expect, then compare. timingSafeEqual takes the same time whether or not
  // the values match, so an attacker cannot find the right signature by timing our answers.
  const expected = Buffer.from(sign(rawBody, timestamp, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true };
}
