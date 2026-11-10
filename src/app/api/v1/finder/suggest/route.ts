// POST /api/v1/finder/suggest: suggest up to two services that fit a short description.
// Who can call it: public (no sign-in); the body must carry ai_opt_in: true, the student's consent.
// What it does: Checks and counts the per-address limit, reads the active services from the database as
//   the only allowed answers, then asks the matcher. A crisis phrase gets emergency guidance and no
//   suggestion; if the AI is off or fails, a keyword matcher answers instead.
// Returns: 200 { mode, urgent_guidance, recommendations }; 400 validation_failed; 429; 503 if the
//   services cannot be read.
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
    // z.literal(true): the value must be exactly true. false or a missing field is a 400, so the server
    // itself enforces the consent, not only the web page.
    ai_opt_in: z.literal(true),
  })
  .strict();

export const POST = route({
  access: "public",
  body: input,
  handler: async ({ req, body, cid }) => {
    // Rate limit (a cap per address, kept only in server memory and never logged). Every call counts,
    // because each one may cost an AI call. It has its own "finder" counter, separate from triage.
    const address = clientAddress(req);
    if (isLimited("finder", address, env.triageChecksPerIp)) throw new HttpError(429, { error: "too_many_requests" });
    addHit("finder", address);

    // The allowlist always comes from the server, never from the browser.
    // (The allowlist is the list of services the answer may name, so the AI cannot invent a service.)
    const { data, error } = await db().from("service").select("id, name, description").eq("is_active", true).order("name");
    // 503 means "this optional helper is unavailable right now"; booking does not depend on it.
    if (error) throw new HttpError(503, { error: "service_unavailable" });

    // Inside suggestServices(): a crisis phrase is checked first (no AI at all). Then the AI runs if it
    // is switched on and the daily budget allows, else the keyword matcher. The picks are checked
    // against the allowlist once more before the answer is sent.
    const startedAt = Date.now();
    const result = await suggestServices(body.text, data ?? []);
    // Logs mode and timing only: not the text, the picks, or whether crisis guidance was shown.
    logMatch(cid, result.mode, startedAt);
    return { json: result };
  },
});
