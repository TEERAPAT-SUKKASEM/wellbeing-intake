import { z } from "zod";
import { env } from "@/lib/env";
import { HttpError, route } from "@/lib/http";
import { logMatch, suggestServices } from "@/lib/matching/suggest";
import { addHit, clientAddress, isLimited } from "@/lib/rate-limit";
import { db } from "@/lib/supabase/admin";

// Added to the PRD for the home page's optional "Get a suggestion" helper. Service navigation only: it
// is not a diagnosis and not an urgency assessment, which stays with /triage/assess. The description
// goes to the AI provider, so the web app sends it only after the student consents, and ai_opt_in must
// be true or nothing runs. Nothing is stored, and the text is never logged. Booking never depends on it.
const input = z
  .object({
    text: z.string().trim().min(1).max(500),
    ai_opt_in: z.literal(true),
  })
  .strict();

export const POST = route({
  access: "public",
  body: input,
  handler: async ({ req, body, cid }) => {
    const address = clientAddress(req);
    if (isLimited("finder", address, env.triageChecksPerIp)) throw new HttpError(429, { error: "too_many_requests" });
    addHit("finder", address);

    // The allowlist always comes from the server, never from the browser.
    const { data, error } = await db().from("service").select("id, name, description").eq("is_active", true).order("name");
    if (error) throw new HttpError(503, { error: "service_unavailable" });

    const startedAt = Date.now();
    const result = await suggestServices(body.text, data ?? []);
    logMatch(cid, result.mode, startedAt);
    return { json: result };
  },
});
