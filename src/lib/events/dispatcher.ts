import "server-only";
import { env } from "@/lib/env";
import { db } from "@/lib/supabase/admin";
import { CORRELATION_HEADER } from "@/lib/http";
import { EVENT_ID_HEADER, SIGNATURE_HEADER, TIMESTAMP_HEADER, buildEventBody, sign } from "@/lib/events/contract";

// Delivers pending outbox rows as signed webhooks with exponential backoff. The row was written in the
// same transaction as the decision, so a Hub outage can delay an event but never lose it or block anyone.

type OutboxRow = {
  event_id: string;
  type: string;
  reference: string;
  payload: unknown;
  occurred_at: string;
  attempts: number;
};

export type DispatchSummary = {
  claimed: number;
  delivered: number;
  retrying: number;
  parked: number;
};

const DELIVERY_TIMEOUT_MS = 5000;

function logDelivery(entry: Record<string, unknown>) {
  // Event id, type, attempt and status only.
  console.log(JSON.stringify({ t: new Date().toISOString(), svc: "wellbeing", kind: "webhook", ...entry }));
}

async function deliver(row: OutboxRow, cid: string): Promise<number> {
  const rawBody = JSON.stringify(buildEventBody({ type: row.type, payload: row.payload }));
  const timestamp = String(Math.floor(Date.now() / 1000));
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

export async function dispatch(cid: string, limit = 20): Promise<DispatchSummary> {
  const summary: DispatchSummary = { claimed: 0, delivered: 0, retrying: 0, parked: 0 };

  if (!env.hubWebhookUrl) return summary; // nothing to deliver to yet; rows wait safely in the outbox

  // The lease must outlast the worst case for this batch (every delivery timing out in turn),
  // or a second dispatcher could re-claim and re-send rows this one is still working through.
  const leaseSeconds = Math.ceil(limit * (DELIVERY_TIMEOUT_MS / 1000 + 2));
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

    if (status >= 200 && status < 300) {
      await db().rpc("mark_outbound_delivered", { p_event: row.event_id, p_status: status });
      summary.delivered++;
      logDelivery({ cid, eventId: row.event_id, type: row.type, attempt: row.attempts, status, outcome: "delivered" });
    } else {
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
