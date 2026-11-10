// POST /api/v1/referrals: Team 14's Helpdesk hands one student referral to Wellbeing.
// Who can call it: Helpdesk's server only, with "Authorization: Bearer <HELPDESK_REFERRAL_TOKEN>". No sign-in.
// What it does: Checks the feature switch, the token and a per-address limit, then checks the body: only a
//   random ref, a service id (or null) and the time the student consented. Then it saves the referral.
//   Sending the same ref again changes nothing. No name, email, student id or ticket text can be sent.
// Returns: 201 { id, status: "received" } for a new ref; 200 with the same shape for a ref we already have;
//   400 invalid_json or validation_failed; 401 unauthenticated; 404 not_found while the feature is off; 429.
import { z } from "zod";
import { env } from "@/lib/env";
import { HttpError, notFound, route } from "@/lib/http";
import { addHit, clientAddress, isLimited } from "@/lib/rate-limit";
import { REF_RE, createReferral, helpdeskTokenOk } from "@/lib/referrals";

// zod schema (a rule list that checks the JSON body). .strict() refuses any other field, so the body can
// never carry a name, an email, a student id or ticket text: there is nowhere to put them.
const newReferral = z
  .object({
    // Helpdesk's random reference, e.g. "hd-" and 32 hex characters. It means nothing to us.
    ref: z.string().regex(REF_RE),
    // The service the student picked on Helpdesk, or null when they did not pick one.
    // nullish: Helpdesk may send null or leave the key out when the ticket has no suggested service.
    service_id: z.string().max(64).regex(/^srv_[a-z0-9_]+$/).nullish(),
    // When the student ticked the consent box: a full ISO date-time with a time zone.
    consent_at: z.iso.datetime({ offset: true }),
  })
  .strict();

// Helpdesk is one server, so this is a cap against a runaway loop, not against students.
const REFERRALS_PER_WINDOW = 60;
// Consent may be at most 5 minutes in the future (clock drift between servers) and at most 30 days old.
const MAX_FUTURE_MS = 5 * 60_000;
const MAX_AGE_MS = 30 * 86_400_000;

export const POST = route({
  // "public" because Helpdesk has no staff sign-in. The handler checks Helpdesk's own token instead.
  access: "public",
  // No `body` option here on purpose: route() would check the body BEFORE the token. We read it in
  // the handler after the token check, so a caller without the token learns nothing about the body rules.
  handler: async ({ req }) => {
    // Off switch first: while REFERRALS_ENABLED is not "true", answer the standard 404 to everyone.
    if (!env.referralsEnabled) throw notFound();
    if (!helpdeskTokenOk(req)) throw new HttpError(401, { error: "unauthenticated" });

    // Rate limit (a cap per address, kept only in server memory and never logged). Only calls with the
    // right token are counted, and each one counts, even if its body turns out to be wrong.
    const address = clientAddress(req);
    if (isLimited("referral", address, REFERRALS_PER_WINDOW)) {
      throw new HttpError(429, { error: "too_many_requests" });
    }
    addHit("referral", address);

    // Read and check the body the same way route() does for other routes: field names only, never values.
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new HttpError(400, { error: "invalid_json" });
    }
    const parsed = newReferral.safeParse(raw);
    if (!parsed.success) {
      const fields = [...new Set(parsed.error.issues.map((i) => i.path.join(".") || "(body)"))];
      throw new HttpError(400, { error: "validation_failed", fields });
    }
    const body = parsed.data;

    // A consent time far in the future or older than 30 days is not a real, current consent.
    const consentAt = new Date(body.consent_at);
    const now = Date.now();
    if (consentAt.getTime() > now + MAX_FUTURE_MS || consentAt.getTime() < now - MAX_AGE_MS) {
      throw new HttpError(400, { error: "validation_failed", fields: ["consent_at"] });
    }

    // Saves the referral. A ref we already have is left exactly as it is (created: false), so a retry
    // from Helpdesk is harmless.
    const result = await createReferral({ ref: body.ref, service_id: body.service_id ?? null, consent_at: consentAt });
    // The service id has the right format but is not one of ours: a 400 on that field, as in POST /requests.
    if ("error" in result) throw new HttpError(400, { error: "validation_failed", fields: ["service_id"] });

    // Only the ref and its status go back. A repeat answers 200 with the referral's current status.
    return {
      status: result.created ? 201 : 200,
      json: { id: result.referral.ref, status: result.referral.status },
    };
  },
});
