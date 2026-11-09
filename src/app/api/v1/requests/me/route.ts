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
    const address = clientAddress(req);
    if (isLimited("key-failure", address, env.keyFailuresPerIp)) {
      throw new HttpError(429, { error: "too_many_requests" });
    }

    const supplied = req.headers.get("x-access-key") ?? new URL(req.url).searchParams.get("access_key");
    const accessKey = normalizeAccessKey(supplied);
    const row = accessKey
      ? await db()
          .from("appointment_request")
          .select(REQUEST_COLUMNS)
          .eq("access_key_hash", hashAccessKey(accessKey))
          .maybeSingle()
      : null;
    if (row?.error) throw new Error("read_failed");

    if (!accessKey || !row?.data) {
      addHit("key-failure", address); // only failures count, so a student refreshing is never locked out
      throw notFound();
    }
    return { json: toAppointmentRequest(row.data as unknown as RequestRow, accessKey) };
  },
});
