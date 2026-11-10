// What this file does: sends waiting events from the outbox table to the Notification Hub as signed
// webhooks, then marks each one delivered or schedules another try.
// Why it exists: confirming or cancelling must never fail just because the Hub is down. Events are
// first saved in the outbox, then sent from here and retried until the Hub accepts them.
// Used by: the confirm/cancel routes (dispatchInline) and the scheduled job that calls
// POST /api/v1/internal/events/dispatch (dispatch).
import "server-only";
import { env } from "@/lib/env";
import { db } from "@/lib/supabase/admin";
import { CORRELATION_HEADER } from "@/lib/http";
import { EVENT_ID_HEADER, SIGNATURE_HEADER, TIMESTAMP_HEADER, buildEventBody, sign } from "@/lib/events/contract";

// Delivers pending outbox rows as signed webhooks with exponential backoff. The row was written in the
// same transaction as the decision, so a Hub outage can delay an event but never lose it or block anyone.
// (An "outbox" is a table of messages waiting to be sent. A "transaction" is a group of database
// changes that are saved all together or not at all.)

// One row of the outbound_event table (the outbox). attempts already counts the try that is starting,
// because claiming a row adds one to it.
type OutboxRow = {
  event_id: string;
  type: string;
  reference: string;
  payload: unknown;
  occurred_at: string;
  attempts: number;
};

// What one run did, as counts only. "Parked" means the event failed too many times and is no longer
// retried; it stays in the table so it can be looked at.
export type DispatchSummary = {
  claimed: number;
  delivered: number;
  retrying: number;
  parked: number;
};

// Wait at most 5 seconds for the Hub per event, so one slow Hub cannot hold up the whole batch.
const DELIVERY_TIMEOUT_MS = 5000;

function logDelivery(entry: Record<string, unknown>) {
  // Event id, type, attempt and status only.
  console.log(JSON.stringify({ t: new Date().toISOString(), svc: "wellbeing", kind: "webhook", ...entry }));
}

// Sends one event and returns the Hub's HTTP status code. A network error or timeout throws.
async function deliver(row: OutboxRow, cid: string): Promise<number> {
  // Re-check the stored body against the contract, then sign exactly the text we will send.
  const rawBody = JSON.stringify(buildEventBody({ type: row.type, payload: row.payload }));
  // Unix time in seconds. It is part of the signature, so the Hub can refuse old copies.
  const timestamp = String(Math.floor(Date.now() / 1000));
  // X-Event-Id is the same on every retry, so the Hub can ignore a copy it has already handled.
  const headers: Record<string, string> = {
    "content-type": "application/json",
    [EVENT_ID_HEADER]: row.event_id,
    [SIGNATURE_HEADER]: sign(rawBody, timestamp, env.hubSigningSecret),
    [TIMESTAMP_HEADER]: timestamp,
    [CORRELATION_HEADER]: cid,
  };
  if (env.hubMachineToken) headers.authorization = `Bearer ${env.hubMachineToken}`;

  const res = await fetch(env.hubWebhookUrl, {
    method: "POST",
    headers,
    body: rawBody,
    signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
  });
  return res.status;
}

/** Claims up to `limit` events that are due, tries each one once, and returns the counts. */
export async function dispatch(cid: string, limit = 20): Promise<DispatchSummary> {
  const summary: DispatchSummary = { claimed: 0, delivered: 0, retrying: 0, parked: 0 };

  if (!env.hubWebhookUrl) return summary; // nothing to deliver to yet; rows wait safely in the outbox

  // The lease must outlast the worst case for this batch (every delivery timing out in turn),
  // or a second dispatcher could re-claim and re-send rows this one is still working through.
  const leaseSeconds = Math.ceil(limit * (DELIVERY_TIMEOUT_MS / 1000 + 2));
  // "Claiming" happens in one database step: pick due rows, add one to attempts, and set their next
  // try time to now + the lease. SKIP LOCKED makes two dispatchers running at once take different rows,
  // so the same event is never sent twice at the same time.
  const claimed = await db().rpc("claim_outbound_events", { p_limit: limit, p_lease: `${leaseSeconds} seconds` });
  if (claimed.error) throw new Error("claim_failed");
  const rows = (claimed.data ?? []) as OutboxRow[];
  summary.claimed = rows.length;

  for (const row of rows) {
    let status = 0;
    try {
      status = await deliver(row, cid);
    } catch {
      status = 0; // network error / timeout
    }

    // Any 2xx status means the Hub accepted the event. The database marks it delivered and deletes
    // the stored body, since it is no longer needed.
    if (status >= 200 && status < 300) {
      await db().rpc("mark_outbound_delivered", { p_event: row.event_id, p_status: status });
      summary.delivered++;
      logDelivery({ cid, eventId: row.event_id, type: row.type, attempt: row.attempts, status, outcome: "delivered" });
    } else {
      // Anything else (an error status, a timeout, no network) is a failed try. The database plans the
      // next try with exponential back-off: wait base x 2^(attempts - 1), so 30s, 60s, 120s, 240s...
      // This gives a broken Hub time to recover instead of flooding it. After WEBHOOK_MAX_ATTEMPTS
      // failures the event is parked.
      const failed = await db().rpc("mark_outbound_attempt_failed", {
        p_event: row.event_id,
        p_status: status,
        p_base: `${env.webhookBackoffBaseSeconds} seconds`,
        p_max_attempts: env.webhookMaxAttempts,
      });
      const parked = Boolean((failed.data as { parked?: boolean } | null)?.parked);
      if (parked) summary.parked++;
      else summary.retrying++;
      logDelivery({
        cid,
        eventId: row.event_id,
        type: row.type,
        attempt: row.attempts,
        status,
        outcome: parked ? "parked" : "retry_scheduled",
        nextAttemptAt: (failed.data as { next_attempt_at?: string } | null)?.next_attempt_at,
      });
    }
  }
  return summary;
}

/** Best-effort inline attempt right after a decision commits. Never throws. */
export async function dispatchInline(cid: string): Promise<void> {
  try {
    // Small batch: a practitioner's click must never wait on a full delivery run.
    await dispatch(cid, 3);
  } catch {
    // The event is already safe in the outbox; the scheduled run will pick it up.
  }
}
