// What this file does: saves, reads, lists, decides and deletes referrals from Team 14's Helpdesk, and
// checks the bearer token Helpdesk sends us.
// Why it exists: the referral routes and the practitioner desk share one set of rules, and only the
// fields we agreed to keep (ref, service, consent time and our own times) ever leave this file.
// Used by: the /api/v1/referrals routes (Helpdesk) and the /api/v1/practitioner/referrals routes (staff).
import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { db } from "@/lib/supabase/admin";
import { toIso } from "@/lib/slots/grid";

// The ref Helpdesk makes: "hd-" and 32 random hex characters. The database checks the same pattern.
export const REF_RE = /^hd-[0-9a-f]{32}$/;

export type ReferralStatus = "received" | "approved" | "declined";

/** One referral as our API returns it. All times are UTC text like 2026-11-10T10:00:00Z. */
export type Referral = {
  ref: string;
  service_id: string | null;
  consent_at: string;
  status: ReferralStatus;
  received_at: string;
  decided_at: string | null;
};

// One row of the referral table, as Supabase returns it (times as Postgres text).
type ReferralRow = Referral;

// Every column of the table. There is nothing else to hide: the table holds no personal data.
const REFERRAL_COLUMNS = "ref, service_id, consent_at, status, received_at, decided_at";

// The staff list shows at most this many referrals.
const LIST_LIMIT = 200;

// Postgres error code for "this row points at a row that does not exist" (a foreign key failure).
const FOREIGN_KEY_VIOLATION = "23503";

/** Turns a database row (or the JSON from decide_referral) into the Referral shape, with ISO UTC times. */
function toReferral(row: ReferralRow): Referral {
  return {
    ref: row.ref,
    service_id: row.service_id ?? null,
    consent_at: toIso(row.consent_at),
    status: row.status,
    received_at: toIso(row.received_at),
    decided_at: row.decided_at ? toIso(row.decided_at) : null,
  };
}

/** True when the request sends "Authorization: Bearer <HELPDESK_REFERRAL_TOKEN>". Never throws. */
export function helpdeskTokenOk(req: Request): boolean {
  // A missing or placeholder token means nobody can get in (required() throws, we answer false).
  let expected: string;
  try {
    expected = env.helpdeskReferralToken;
  } catch {
    return false;
  }
  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) return false;
  // Constant-time compare. We first hash both values, so they always have the same length (32 bytes)
  // and the time taken does not even show how long the real token is. timingSafeEqual then looks at
  // every byte, so the time does not show how much of a guess was right.
  const given = createHash("sha256").update(token).digest();
  const wanted = createHash("sha256").update(expected).digest();
  return timingSafeEqual(given, wanted);
}

/**
 * Saves a new referral. A ref we already have is a retry from Helpdesk: we return the saved row with
 * created = false and change nothing. An unknown service_id gives { error: "unknown_service" }.
 */
export async function createReferral(input: {
  ref: string;
  service_id: string | null;
  consent_at: Date;
}): Promise<{ created: boolean; referral: Referral } | { error: "unknown_service" }> {
  // The service must exist. An inactive service is still fine: Helpdesk may have an older list.
  if (input.service_id !== null) {
    const service = await db().from("service").select("id").eq("id", input.service_id).maybeSingle();
    if (service.error) throw new Error("service_lookup_failed");
    if (!service.data) return { error: "unknown_service" };
  }

  // "ignoreDuplicates" makes this INSERT ... ON CONFLICT (ref) DO NOTHING: an existing row is never
  // changed. The answer then lists only the rows really inserted, so an empty list means "already there".
  const inserted = await db()
    .from("referral")
    .upsert(
      { ref: input.ref, service_id: input.service_id, consent_at: input.consent_at.toISOString() },
      { onConflict: "ref", ignoreDuplicates: true },
    )
    .select(REFERRAL_COLUMNS);
  if (inserted.error) {
    // The service was deleted between our check and the insert.
    if (inserted.error.code === FOREIGN_KEY_VIOLATION) return { error: "unknown_service" };
    throw new Error("referral_insert_failed");
  }
  const row = (inserted.data as ReferralRow[] | null)?.[0];
  if (row) return { created: true, referral: toReferral(row) };

  // Nothing was inserted, so the ref already exists: return it unchanged.
  const existing = await getReferral(input.ref);
  // Only possible if a DELETE ran between the insert and this read.
  if (!existing) throw new Error("referral_vanished");
  return { created: false, referral: existing };
}

/** Returns one referral, or null if the ref is unknown or badly formed. */
export async function getReferral(ref: string): Promise<Referral | null> {
  if (!REF_RE.test(ref)) return null; // strange input never reaches the database
  const found = await db().from("referral").select(REFERRAL_COLUMNS).eq("ref", ref).maybeSingle();
  if (found.error) throw new Error("referral_read_failed");
  return found.data ? toReferral(found.data as ReferralRow) : null;
}

/** Deletes a referral and its waiting callbacks. Deleting a ref that does not exist is fine too. */
export async function deleteReferral(ref: string): Promise<void> {
  if (!REF_RE.test(ref)) return;
  const deleted = await db().from("referral").delete().eq("ref", ref);
  if (deleted.error) throw new Error("referral_delete_failed");
}

/** The staff list: referrals waiting for review first, then the rest; newest first in each part. Max 200. */
export async function listReferrals(): Promise<Referral[]> {
  // Two simple queries, because the database API cannot sort by "status is received" directly.
  const waiting = await db()
    .from("referral")
    .select(REFERRAL_COLUMNS)
    .eq("status", "received")
    .order("received_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (waiting.error) throw new Error("referral_list_failed");
  const rows = (waiting.data ?? []) as ReferralRow[];

  // Fill the rest of the 200 with decided referrals.
  if (rows.length < LIST_LIMIT) {
    const decided = await db()
      .from("referral")
      .select(REFERRAL_COLUMNS)
      .neq("status", "received")
      .order("received_at", { ascending: false })
      .limit(LIST_LIMIT - rows.length);
    if (decided.error) throw new Error("referral_list_failed");
    rows.push(...((decided.data ?? []) as ReferralRow[]));
  }
  return rows.map(toReferral);
}

// What decide_referral returns. event_id is only there when a new callback was queued.
type DecideResult = {
  code: "ok" | "not_found" | "invalid_transition";
  referral?: ReferralRow;
  event_id?: string;
};

/**
 * A practitioner's Accept ("approved") or Decline ("declined"). The database function locks the row,
 * changes the status and queues the callback to Helpdesk, all in one transaction.
 */
export async function decideReferral(
  ref: string,
  status: "approved" | "declined",
): Promise<{ code: "ok"; referral: Referral } | { code: "not_found" } | { code: "invalid_transition" }> {
  if (!REF_RE.test(ref)) return { code: "not_found" };
  const result = await db().rpc("decide_referral", { p_ref: ref, p_status: status });
  if (result.error) throw new Error("referral_decide_failed");
  const data = result.data as DecideResult | null;
  if (data?.code === "ok" && data.referral) return { code: "ok", referral: toReferral(data.referral) };
  if (data?.code === "not_found") return { code: "not_found" };
  if (data?.code === "invalid_transition") return { code: "invalid_transition" };
  throw new Error("referral_decide_unexpected");
}
