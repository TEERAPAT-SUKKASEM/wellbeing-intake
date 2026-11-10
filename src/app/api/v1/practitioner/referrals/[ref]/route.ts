// PATCH /api/v1/practitioner/referrals/{ref}: a practitioner or admin accepts or declines a Helpdesk referral.
// Who can call it: practitioners and admins (signed in). No sign-in gets 401; other staff get 404.
// What it does: Checks the decision, then a database function records it in one transaction and queues
//   one callback for Helpdesk (only the ref and the new status). Last, it tries to send that callback at once.
//   "Approved" means we accept the referral, not that a session happened: the student still books anonymously.
// Returns: 200 with the updated referral (also when the same decision is repeated); 400 validation_failed;
//   404 not_found for an unknown or badly formed ref, and for everyone while the feature is off;
//   409 invalid_transition (it was already decided the other way); 403 cross_origin_rejected if a
//   cookie-signed write comes from another website.
import { z } from "zod";
import { env } from "@/lib/env";
import { HttpError, notFound, route } from "@/lib/http";
import { sendReferralCallbacks } from "@/lib/partners/helpdesk-referrals";
import { REF_RE, decideReferral } from "@/lib/referrals";

// zod schema (a rule list that checks the JSON body). Only the decision itself is allowed.
const decision = z.object({ status: z.enum(["approved", "declined"]) }).strict();

// The answer for every call while referrals are off: the standard 404, before any sign-in check.
const featureOff = route({
  access: "public",
  handler: async () => {
    throw notFound();
  },
});

const decide = route({
  // route() also blocks a cookie-signed write that comes from another website (403), so another site
  // cannot use a staff member's browser cookie to decide referrals.
  access: ["practitioner", "admin"],
  body: decision,
  handler: async ({ params, body, cid }) => {
    // route() has already refused ids with odd characters. This also refuses a safe id that is not a ref.
    if (!REF_RE.test(params.ref)) throw notFound();

    // The database function locks the row and, in the same transaction, writes the callback event to an
    // outbox (a table of callbacks still to send), so a decision can never lose its callback.
    // Repeating the same decision changes nothing and queues no second callback.
    const result = await decideReferral(params.ref, body.status);
    if (result.code === "not_found") throw notFound();
    if (result.code === "invalid_transition") throw new HttpError(409, { error: "invalid_transition" });

    // Try to tell Helpdesk now (at most 3 waiting callbacks). A problem here never fails the decision:
    // the callback stays in the outbox and the scheduled dispatcher sends it later.
    try {
      await sendReferralCallbacks(cid, 3);
    } catch {
      // Ignored on purpose; see above.
    }
    return { json: result.referral };
  },
});

// The switch is checked before route() runs its own checks, so while REFERRALS_ENABLED is not "true"
// every caller, signed in or not, gets the same 404 and cannot tell the route exists.
export const PATCH: typeof decide = (req, ctx) => (env.referralsEnabled ? decide : featureOff)(req, ctx);
