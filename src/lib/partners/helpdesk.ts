// What this file does: reads Team 14's (Helpdesk) public campus contact list from
//   GET <HELPDESK_API_BASE_URL>/contacts and uses it in place of our two placeholder campus numbers.
// Why it exists: our cross-group integration in the Wellbeing -> Helpdesk direction. Helpdesk owns the
//   campus contact list. We only READ public data, and we never send Helpdesk anything about a student.
// Key idea: Helpdesk can never break our safety guidance. It is off until HELPDESK_API_BASE_URL is set,
//   each call waits at most 3 seconds, good answers are cached, and on ANY problem we use the hard-coded
//   numbers. The national hotlines (1669, 1323) always stay hard-coded and are never replaced.
// Used by: guidanceFor() callers, i.e. POST /requests (the receipt) and POST /triage/assess.
import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { EMERGENCY_CONTACTS, type EmergencyContact } from "@/lib/emergency";

// The shape we agreed with Team 14 (their reply, section 2: exactly these fields). Not strict: an extra
// field they add later is ignored. A wrong value anywhere makes the whole answer unusable.
const HelpdeskContact = z.object({
  id: z.string().regex(/^[a-z0-9_]{2,40}$/),
  name: z.string().min(1).max(80),
  phone: z.string().min(3).max(30),
  tel: z.string().regex(/^\+?[0-9]{3,15}$/),
  hours: z.string().min(1).max(60),
  type: z.enum(["emergency", "service", "support"]),
  available_24h: z.boolean(),
  verified: z.boolean(),
});
const HelpdeskContacts = z.array(HelpdeskContact).max(100);
export type HelpdeskContact = z.infer<typeof HelpdeskContact>;

const TIMEOUT_MS = 3000; // agreed with Team 14
const FRESH_MS = 5 * 60_000; // they send Cache-Control max-age=300, so reuse an answer for 5 minutes
const STALE_MS = 24 * 60 * 60_000; // while Helpdesk is down, an answer up to a day old is still used
const RETRY_AFTER_FAILURE_MS = 60_000; // after a failure with nothing cached, skip calls for a minute

let cache: { at: number; contacts: HelpdeskContact[] } | null = null;
let lastFailureAt = 0;

// Which hard-coded placeholder each Helpdesk contact id replaces. The placeholders are found by their
// fake tel numbers, which are unique in src/lib/emergency.ts.
const REPLACES_PLACEHOLDER: Record<string, string> = {
  "000000000": "campus_security",
  "000000001": "counselling_front_desk",
};

type Outcome = "ok" | "skipped" | "timeout" | "network" | "bad_shape" | `http_${number}`;

/** One content-free log line per real call: outcome and timing, plus the correlation id we sent. */
function logPartner(sentCid: string, outcome: Outcome, startedAt: number) {
  console.log(
    JSON.stringify({
      t: new Date().toISOString(),
      svc: "wellbeing",
      kind: "partner",
      partner: "helpdesk",
      cid: sentCid,
      outcome,
      ms: Date.now() - startedAt,
    }),
  );
}

/** Returns Helpdesk's contacts, or null on ANY problem (then the hard-coded numbers are used). */
export async function fetchHelpdeskContacts(cid: string): Promise<HelpdeskContact[] | null> {
  const base = env.helpdeskApiBaseUrl;
  if (!base) return null; // switched off: no network call at all

  const startedAt = Date.now();
  if (cache && startedAt - cache.at < FRESH_MS) return cache.contacts;
  // The correlation id we send starts with "team16-", so both teams can find this call in their logs.
  // An id that already starts with "team16-" (e.g. the agreed evidence id team16-v1-0001, sent to our
  // own API) is passed through unchanged, so the same id appears in both teams' logs.
  const sentCid = (cid.startsWith("team16-") ? cid : `team16-${cid}`).slice(0, 128);
  if (!cache && startedAt - lastFailureAt < RETRY_AFTER_FAILURE_MS) {
    logPartner(sentCid, "skipped", startedAt);
    return null;
  }

  let outcome: Outcome = "ok";
  try {
    const response = await fetch(`${base.replace(/\/+$/, "")}/contacts`, {
      headers: { accept: "application/json", "x-correlation-id": sentCid },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      outcome = `http_${response.status}`;
    } else {
      const parsed = HelpdeskContacts.safeParse(await response.json().catch(() => null));
      if (parsed.success) {
        cache = { at: Date.now(), contacts: parsed.data };
        return parsed.data;
      }
      outcome = "bad_shape";
    }
  } catch (error) {
    outcome = error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network";
  } finally {
    logPartner(sentCid, outcome, startedAt);
  }

  // This call failed. A recent good copy is still better than the placeholders.
  lastFailureAt = Date.now();
  if (cache && Date.now() - cache.at < STALE_MS) return cache.contacts;
  return null;
}

/**
 * The contact list for safety guidance: our hard-coded list, with the two campus placeholders replaced
 * by Helpdesk's entries when Helpdesk answered. A number Helpdesk has not verified is labelled "(demo)",
 * as Team 14 asked.
 */
export async function emergencyContactsFor(cid: string): Promise<EmergencyContact[]> {
  const live = await fetchHelpdeskContacts(cid);
  if (!live) return EMERGENCY_CONTACTS;
  const byId = new Map(live.map((contact) => [contact.id, contact]));
  return EMERGENCY_CONTACTS.map((contact) => {
    const id = REPLACES_PLACEHOLDER[contact.tel];
    const official = id ? byId.get(id) : undefined;
    if (!official) return contact; // a national hotline, or Helpdesk did not send this entry
    return {
      name: official.verified ? official.name : `${official.name} (demo)`,
      detail: official.hours,
      phone: official.phone,
      tel: official.tel,
    };
  });
}

/** For tests only: forget the cached answer and the last failure. */
export function clearHelpdeskCache() {
  cache = null;
  lastFailureAt = 0;
}
