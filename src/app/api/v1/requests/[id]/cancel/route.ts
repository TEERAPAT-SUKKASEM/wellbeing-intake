import { z } from "zod";
import { hashAccessKey, normalizeAccessKey } from "@/lib/access-key";
import { env } from "@/lib/env";
import { dispatchInline } from "@/lib/events/dispatcher";
import { HttpError, notFound, route } from "@/lib/http";
import { addHit, clientAddress, isLimited } from "@/lib/rate-limit";
import { db } from "@/lib/supabase/admin";

const body = z.object({ access_key: z.string().max(64) }).strict();

// PRD 5: anonymous cancellation. A wrong key is the same 404 as an unknown request. The slot and its
// buffer are released at once, because the overlap rule only counts live requests.
export const POST = route({
  access: "public",
  body,
  handler: async ({ req, params, body, cid }) => {
    const address = clientAddress(req);
    if (isLimited("key-failure", address, env.keyFailuresPerIp)) {
      throw new HttpError(429, { error: "too_many_requests" });
    }

    const accessKey = normalizeAccessKey(body.access_key);
    if (!accessKey) {
      addHit("key-failure", address);
      throw notFound();
    }

    const { data, error } = await db().rpc("cancel_request_by_key", {
      p_id: params.id,
      p_key_hash: hashAccessKey(accessKey),
    });
    if (error) throw new Error("cancel_failed");

    const result = data as { code: string; notify?: boolean };
    if (result.code === "not_found") {
      addHit("key-failure", address);
      throw notFound();
    }
    if (result.code === "invalid_transition") throw new HttpError(409, { error: "invalid_transition" });
    if (result.code === "too_late") throw new HttpError(409, { error: "too_late" });

    if (result.notify) await dispatchInline(cid);
    return { json: { id: params.id, status: "CANCELLED" } };
  },
});
