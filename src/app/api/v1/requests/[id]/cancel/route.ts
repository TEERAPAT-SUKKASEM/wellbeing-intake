// POST /api/v1/requests/{id}/cancel: a student cancels their own request with their access key.
// Who can call it: students with an access key (no sign-in). The key in the body proves ownership.
// What it does: Checks the per-address failure limit and the key format, then asks the database to
//   cancel the request only if the id AND the hash of the key both match. If the appointment was
//   already confirmed, the database also queues an appointment.cancelled webhook, which we try to send now.
// Returns: 200 { id, status: "CANCELLED" } (also for a repeat); 404 not_found for an unknown id or a
//   wrong key; 409 invalid_transition (it was rejected) or too_late (the session has started); 429.
import { z } from "zod";
import { hashAccessKey, normalizeAccessKey } from "@/lib/access-key";
import { env } from "@/lib/env";
import { dispatchInline } from "@/lib/events/dispatcher";
import { HttpError, notFound, route } from "@/lib/http";
import { addHit, clientAddress, isLimited } from "@/lib/rate-limit";
import { db } from "@/lib/supabase/admin";

// zod schema (a rule list that checks the JSON body). Only access_key is allowed, and max(64) stops
// very long strings before any work is done.
const body = z.object({ access_key: z.string().max(64) }).strict();

// PRD 5: anonymous cancellation. A wrong key is the same 404 as an unknown request. The slot and its
// buffer are released at once, because the overlap rule only counts live requests.
export const POST = route({
  access: "public",
  body,
  handler: async ({ req, params, body, cid }) => {
    // Rate limit (a cap per address, kept only in server memory and never logged): after too many
    // wrong keys in 10 minutes, one address gets 429. This stops someone guessing keys. The
    // "key-failure" counter is shared with GET /requests/me, so guesses on either endpoint add up.
    const address = clientAddress(req);
    if (isLimited("key-failure", address, env.keyFailuresPerIp)) {
      throw new HttpError(429, { error: "too_many_requests" });
    }

    // normalizeAccessKey() trims spaces and upper-cases. Something that cannot be a key counts as a
    // failure and gets the same 404 as a wrong key, so the reply never says which part was wrong.
    const accessKey = normalizeAccessKey(body.access_key);
    if (!accessKey) {
      addHit("key-failure", address);
      throw notFound();
    }

    // rpc() calls the SQL function cancel_request_by_key, which runs as one transaction. It locks the
    // row and matches on id AND key hash, so a wrong key looks exactly like a missing request. Only the
    // SHA-256 hash of the key is sent: the database never stores the key itself.
    const { data, error } = await db().rpc("cancel_request_by_key", {
      p_id: params.id,
      p_key_hash: hashAccessKey(accessKey),
    });
    if (error) throw new Error("cancel_failed");

    // The SQL function returns a result code instead of raising an error, and each code maps to one
    // HTTP answer here.
    const result = data as { code: string; notify?: boolean };
    if (result.code === "not_found") {
      addHit("key-failure", address);
      throw notFound();
    }
    if (result.code === "invalid_transition") throw new HttpError(409, { error: "invalid_transition" });
    if (result.code === "too_late") throw new HttpError(409, { error: "too_late" });

    // notify is true only if the appointment had been CONFIRMED: the Hub only heard about confirmed ones,
    // so only they need an appointment.cancelled event. dispatchInline() tries to send it now and never
    // throws; if the Hub is down, the event waits in the outbox (a table of events still to send).
    if (result.notify) await dispatchInline(cid);
    // An already-cancelled request also ends here ("ok" from the database), so a double-click is harmless.
    return { json: { id: params.id, status: "CANCELLED" } };
  },
});
