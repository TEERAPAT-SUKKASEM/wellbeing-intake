// GET /api/v1/referrals/{ref}: Helpdesk asks where one referral stands.
// DELETE /api/v1/referrals/{ref}: Helpdesk tells us the student withdrew, so we delete the referral.
// Who can call it: Helpdesk's server only, with "Authorization: Bearer <HELPDESK_REFERRAL_TOKEN>". No sign-in.
// What it does: Checks the feature switch, the ref format and the token. GET reads only the status.
//   DELETE removes the referral and any callbacks still waiting for it; deleting twice is harmless.
// Returns: GET 200 { status: "received" | "approved" | "declined" }, 404 not_found for an unknown or badly
//   formed ref. DELETE 200 { deleted: true }, also for a ref we never had. Both: 401 unauthenticated with a
//   wrong or missing token; 404 not_found while the feature is off.
import { env } from "@/lib/env";
import { HttpError, notFound, route } from "@/lib/http";
import { REF_RE, deleteReferral, getReferral, helpdeskTokenOk } from "@/lib/referrals";

// The checks both methods share, in the same order as route() uses for other routes: the switch (404),
// the id in the path (404), then who is calling (401). It returns the checked ref.
function checkedRef(req: Request, params: Record<string, string>): string {
  if (!env.referralsEnabled) throw notFound();
  // route() has already refused ids with odd characters. This also refuses a safe id that is not a ref.
  if (!REF_RE.test(params.ref)) throw notFound();
  if (!helpdeskTokenOk(req)) throw new HttpError(401, { error: "unauthenticated" });
  return params.ref;
}

export const GET = route({
  // "public" because Helpdesk has no staff sign-in. checkedRef() checks Helpdesk's own token instead.
  access: "public",
  handler: async ({ req, params }) => {
    const referral = await getReferral(checkedRef(req, params));
    if (!referral) throw notFound();
    // Only the status: Helpdesk already knows the rest, and nothing about a booking is ever shared.
    return { json: { status: referral.status } };
  },
});

export const DELETE = route({
  access: "public",
  handler: async ({ req, params }) => {
    // Deleting a ref we do not have (or no longer have) is not an error, so a retry is harmless.
    // Waiting callbacks for this ref are deleted with it (ON DELETE CASCADE in the database).
    await deleteReferral(checkedRef(req, params));
    return { json: { deleted: true } };
  },
});
