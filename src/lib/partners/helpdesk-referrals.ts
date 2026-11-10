// What this file does: sends Team 14's Helpdesk a signed callback for each accepted or declined referral,
//   from the referral_event outbox table, and marks each event delivered, given up or to be retried.
// Why it exists: Helpdesk closes the student's ticket when we accept the referral. Deciding must never
//   fail because Helpdesk is down, so the event is saved first (in decide_referral) and sent from here.
// Key idea: the callback carries only eventId, type, ref and status: never a time, a counsellor or
//   anything about a session. The same eventId and body are sent on every retry, so Helpdesk can drop
//   a copy it already handled. The ref is never logged.
// Used by: PATCH /api/v1/practitioner/referrals/{ref} (a small batch right after the decision) and
//   POST /api/v1/internal/events/dispatch (the scheduled run).
import "server-only";
import { createHmac } from "node:crypto";
import { env } from "@/lib/env";
import { db } from "@/lib/supabase/admin";

/** The "type" field of every callback body. */
export const CALLBACK_TYPE = "wellbeing.referral_status";

/** The exact callback body. The key order is part of the contract, because the signature covers this text. */
export function callbackBody(eventId: string, ref: string, status: "approved" | "declined"): string {
  return JSON.stringify({ eventId, type: CALLBACK_TYPE, data: { ref, status } });
}

/**
 * The X-Signature value: lowercase hex HMAC-SHA256 of "<timestamp>.<body>" with the shared secret.
 * HMAC is a signature only we and Helpdesk can make, so Helpdesk knows the callback is really from us
 * and was not changed. The timestamp is signed too, so an old copy cannot be sent again later.
 */
export function signCallback(body: string, timestampSeconds: string, secret: string): string {
  return createHmac("sha256", secret).update(`${timestampSeconds}.${body}`).digest("hex");
}

// What one run did, as counts only.
type SendSummary = { skipped: boolean; sent: number; retry: number; gaveUp: number };

// One waiting row of the referral_event table.
type EventRow = {
  event_id: string;
  ref: string;
  status: "approved" | "declined";
  attempts: number;
};

const TIMEOUT_MS = 3000; // agreed with Team 14, the same as the contacts call
const BACKOFF_BASE_MS = 30_000; // the first retry waits 30 seconds, then 60, 120, 240...
const MAX_ATTEMPTS = 8; // after 8 failed tries we give up on the event

type Outcome = "ok" | "timeout" | "network" | `http_${number}`;

/** One content-free log line per send: outcome and timing, plus the correlation id we sent. Never the ref. */
function logSend(sentCid: string, outcome: Outcome, startedAt: number) {
  console.log(
    JSON.stringify({
      t: new Date().toISOString(),
      svc: "wellbeing",
      kind: "partner",
      partner: "helpdesk",
      op: "referral_callback",
      cid: sentCid,
      outcome,
      ms: Date.now() - startedAt,
    }),
  );
}

/** Sends one callback. Returns Helpdesk's HTTP status, or the reason there was no answer. */
async function sendOne(url: string, secret: string, sentCid: string, row: EventRow): Promise<number | Outcome> {
  const body = callbackBody(row.event_id, row.ref, row.status);
  // Unix time in seconds. A new one on each try, and it is part of the signature.
  const timestamp = String(Math.floor(Date.now() / 1000));
  const startedAt = Date.now();
  let outcome: Outcome = "ok";
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Timestamp": timestamp,
        "X-Signature": signCallback(body, timestamp, secret),
        "X-Correlation-Id": sentCid,
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) outcome = `http_${response.status}`;
    // We do not need the answer's body. Cancelling it frees the connection at once.
    await response.body?.cancel().catch(() => undefined);
    return response.status;
  } catch (error) {
    outcome = error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network";
    return outcome;
  } finally {
    logSend(sentCid, outcome, startedAt);
  }
}

/**
 * Sends up to `limit` due callbacks, oldest first, and returns the counts. Never throws: a problem with
 * one event is counted as a retry, and the event simply stays in the table for the next run.
 */
export async function sendReferralCallbacks(cid: string, limit = 10): Promise<SendSummary> {
  const summary: SendSummary = { skipped: false, sent: 0, retry: 0, gaveUp: 0 };
  const skipped: SendSummary = { ...summary, skipped: true };

  // Switched off, no address or no secret: send nothing. The events wait safely in the table.
  if (!env.referralsEnabled) return skipped;
  const url = env.helpdeskWebhookUrl;
  if (!url) return skipped;
  let secret: string;
  try {
    secret = env.helpdeskWebhookSecret;
  } catch {
    return skipped;
  }

  // The correlation id we send starts with "team16-", so both teams can find this call in their logs.
  // An id that already starts with "team16-" is passed through unchanged.
  const sentCid = (cid.startsWith("team16-") ? cid : `team16-${cid}`).slice(0, 128);

  // Due events: not finished, and their next try time has come.
  let rows: EventRow[];
  try {
    const due = await db()
      .from("referral_event")
      .select("event_id, ref, status, attempts")
      .is("delivered_at", null)
      .is("gave_up_at", null)
      .lte("next_attempt_at", new Date().toISOString())
      .order("created_at", { ascending: true })
      .order("event_id", { ascending: true })
      .limit(limit);
    if (due.error) return summary;
    rows = (due.data ?? []) as EventRow[];
  } catch {
    return summary;
  }

  for (const row of rows) {
    try {
      const result = await sendOne(url, secret, sentCid, row);
      const now = new Date();

      // Each update only touches a row that is still waiting (delivered_at is null). If two runs sent
      // the same event at the same moment, the second update changes nothing.
      if (typeof result === "number" && result >= 200 && result < 300) {
        // Helpdesk accepted the callback.
        const marked = await db()
          .from("referral_event")
          .update({ delivered_at: now.toISOString(), last_status: result })
          .eq("event_id", row.event_id)
          .is("delivered_at", null);
        if (marked.error) throw new Error("mark_failed");
        summary.sent++;
      } else if (typeof result === "number" && result >= 400 && result < 500 && result !== 408 && result !== 429) {
        // Helpdesk refused it (e.g. 400 bad body, 401 wrong signature). Sending the same thing again
        // would get the same answer, so we give up at once. 408 (timeout) and 429 (too many requests)
        // are temporary, so they go to the retry branch below instead.
        const marked = await db()
          .from("referral_event")
          .update({ gave_up_at: now.toISOString(), last_status: result })
          .eq("event_id", row.event_id)
          .is("delivered_at", null)
          .is("gave_up_at", null);
        if (marked.error) throw new Error("mark_failed");
        summary.gaveUp++;
      } else {
        // 5xx, a timeout or no network: Helpdesk may be down for a while, so try again later.
        // Exponential back-off: wait 30s x 2^attempts (attempts before this failure): 30s, 60s, 120s...
        const attempts = row.attempts + 1;
        const giveUp = attempts >= MAX_ATTEMPTS;
        const marked = await db()
          .from("referral_event")
          .update({
            attempts,
            next_attempt_at: new Date(now.getTime() + BACKOFF_BASE_MS * 2 ** row.attempts).toISOString(),
            gave_up_at: giveUp ? now.toISOString() : null,
            // No HTTP answer (timeout or network) is stored as null.
            last_status: typeof result === "number" ? result : null,
          })
          .eq("event_id", row.event_id)
          // Only if no other run has counted a try in the meantime, so one failure is counted once.
          .eq("attempts", row.attempts)
          .is("delivered_at", null)
          .is("gave_up_at", null);
        if (marked.error) throw new Error("mark_failed");
        if (giveUp) summary.gaveUp++;
        else summary.retry++;
      }
    } catch {
      // The event is still waiting in the table, so the next run tries it again.
      summary.retry++;
    }
  }
  return summary;
}
