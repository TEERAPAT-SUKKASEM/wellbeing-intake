// GET /api/v1/requests/me: a student checks their request with their Private Access Key.
// Who can call it: students with an access key (no sign-in). The key is the only proof needed.
// What it does: Checks the per-address failure limit, reads the key from the X-Access-Key header (or
//   the ?access_key= query), and finds the request by the SHA-256 hash of the key. A badly formed key
//   and an unknown key both count as a failure and get the same 404.
// Returns: 200 with the request, including the key the student sent; 404 not_found; 429 too_many_requests.
import { hashAccessKey, normalizeAccessKey } from "@/lib/access-key";
import { env } from "@/lib/env";
import { HttpError, notFound, route } from "@/lib/http";
import { addHit, clientAddress, isLimited } from "@/lib/rate-limit";
import { REQUEST_COLUMNS, toAppointmentRequest, type RequestRow } from "@/lib/requests";
import { db } from "@/lib/supabase/admin";

// PRD 4: a student checks their request with the Private Access Key. An invalid key is exactly the same
// 404 as any other unknown key. The PRD's ?access_key= works, but hosting providers log full URLs, so
// the web app should send the X-Access-Key header instead.
export const GET = route({
  access: "public",
  handler: async ({ req }) => {
    // Rate limit (a cap per address, kept only in server memory and never logged): after too many
    // failed lookups in 10 minutes, one address gets 429, which stops key guessing. The counter is
    // shared with POST /requests/{id}/cancel.
    const address = clientAddress(req);
    if (isLimited("key-failure", address, env.keyFailuresPerIp)) {
      throw new HttpError(429, { error: "too_many_requests" });
    }

    // The header wins over the query. Our own log line never holds the query string either way.
    const supplied = req.headers.get("x-access-key") ?? new URL(req.url).searchParams.get("access_key");
    // Trims spaces and upper-cases; gives null for anything that is not WB-XXXX-XXXX-XXXX.
    const accessKey = normalizeAccessKey(supplied);
    // Look up by the hash only: the database stores no keys, so a data leak reveals none. A malformed
    // key skips the database call. .maybeSingle() gives null data, not an error, when nothing matches.
    const row = accessKey
      ? await db()
          .from("appointment_request")
          .select(REQUEST_COLUMNS)
          .eq("access_key_hash", hashAccessKey(accessKey))
          .maybeSingle()
      : null;
    // A database error is a 500, not a 404, so a real outage is never hidden as "wrong key".
    if (row?.error) throw new Error("read_failed");

    // One 404 for "not a key" and "no such key": a guesser learns nothing from the reply.
    if (!accessKey || !row?.data) {
      addHit("key-failure", address); // only failures count, so a student refreshing is never locked out
      throw notFound();
    }
    // The key is put back in the reply because the caller already holds it.
    return { json: toAppointmentRequest(row.data as unknown as RequestRow, accessKey) };
  },
});
