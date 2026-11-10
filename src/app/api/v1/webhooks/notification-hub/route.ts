// POST /api/v1/webhooks/notification-hub: receive delivery receipts back from the Notification Hub.
// Who can call it: only the Notification Hub, proven by an HMAC signature (made with a shared secret).
// What it does: Checks the signature and its timestamp on the raw body, then checks the envelope shape,
//   the event type and the request reference. It records the event id once in the database; a second
//   copy of the same event is recognised and not processed again.
// Returns: 200 { received, duplicate }; 401 invalid_signature; 400 invalid_envelope; 500 internal_error.
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { db } from "@/lib/supabase/admin";
import { CORRELATION_HEADER, isSafeId } from "@/lib/http";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, inboundEnvelope, verify } from "@/lib/events/contract";

// Inbound webhook receiver: delivery receipts from the Notification Hub.
// Signature is verified over the RAW body before anything is parsed; consumption is idempotent on
// eventId. Receipts carry only our opaque request id.
// (Idempotent means: receiving the same event twice has the same effect as receiving it once.)
//
// Not wrapped by route(): it needs the raw body for verification.

// Only these two receipt types are accepted; any other type is a 400.
const ACCEPTED_TYPES = new Set(["notification.delivered", "notification.failed"]);

// Builds a JSON reply with the same safety headers route() would add: no caching, and the correlation id.
function reply(status: number, json: unknown, cid: string) {
  return new Response(JSON.stringify(json), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", [CORRELATION_HEADER]: cid },
  });
}

export async function POST(req: Request): Promise<Response> {
  // Reuse the sender's correlation id (a tracking id shared across systems), or make a new one.
  const cid = req.headers.get(CORRELATION_HEADER) ?? randomUUID();
  // This file's own log helper. Every log call below writes the outcome and ids only, never the body.
  const log = (entry: Record<string, unknown>) =>
    console.log(JSON.stringify({ t: new Date().toISOString(), svc: "wellbeing", kind: "webhook_in", cid, ...entry }));

  // verify() rebuilds the HMAC with our copy of the Hub's secret and compares it in constant time.
  // It also refuses a timestamp more than 5 minutes away, so an old captured message cannot be replayed.
  const rawBody = await req.text();
  const verdict = verify(
    rawBody,
    req.headers.get(SIGNATURE_HEADER),
    req.headers.get(TIMESTAMP_HEADER),
    env.hubInboundSecret,
  );
  if (!verdict.ok) {
    log({ signature: "rejected", reason: verdict.reason, status: 401 });
    return reply(401, { error: "invalid_signature" }, cid);
  }

  // Parse only after the signature passes. Broken JSON and a wrong shape get the same 400, which
  // tells the sender not to retry.
  let parsed;
  try {
    parsed = inboundEnvelope.safeParse(JSON.parse(rawBody));
  } catch {
    parsed = null;
  }
  if (!parsed?.success || !ACCEPTED_TYPES.has(parsed.data.type)) {
    log({ signature: "verified", status: 400, outcome: "invalid_envelope" });
    return reply(400, { error: "invalid_envelope" }, cid);
  }

  const event = parsed.data;
  // A malformed reference is the sender's error (400), so the sender stops retrying.
  const rawReference = event.data.reference;
  if (rawReference !== undefined && rawReference !== null && !isSafeId(rawReference)) {
    log({ signature: "verified", status: 400, outcome: "invalid_reference" });
    return reply(400, { error: "invalid_envelope" }, cid);
  }
  // A missing reference is allowed and saved as null.
  const reference = isSafeId(rawReference) ? rawReference : null;

  // rpc() calls the SQL function record_inbound_event. It inserts the event id and does nothing if that
  // id is already there, so it returns true only the first time. This is what makes the receiver safe
  // to call twice.
  const { data, error } = await db().rpc("record_inbound_event", {
    p_event: event.eventId,
    p_source: event.source,
    p_type: event.type,
    p_reference: reference,
    p_occurred: event.occurredAt,
  });
  if (error) {
    // Nothing was recorded. A 500 tells the Hub to send the same receipt again later.
    log({ signature: "verified", status: 500, eventId: event.eventId });
    return reply(500, { error: "internal_error" }, cid);
  }

  const firstTime = data === true;
  log({ signature: "verified", status: 200, eventId: event.eventId, type: event.type, duplicate: !firstTime });
  // A duplicate is acknowledged, not reprocessed: the sender can stop retrying.
  return reply(200, { received: true, duplicate: !firstTime }, cid);
}
