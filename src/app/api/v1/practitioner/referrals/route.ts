// GET /api/v1/practitioner/referrals: list the referrals Helpdesk has sent us, for the practitioner desk.
// Who can call it: practitioners and admins (signed in). No sign-in gets 401; other staff get 404.
// What it does: Reads up to 200 referrals, the ones still waiting for review first, then the newest.
//   Each one holds only Helpdesk's random ref, the service, the consent time and our own timestamps.
// Returns: 200 with an array of referrals; 401 unauthenticated; 404 not_found, also for everyone while
//   the feature is off (the desk then hides its Helpdesk referrals tab).
import { env } from "@/lib/env";
import { notFound, route } from "@/lib/http";
import { listReferrals } from "@/lib/referrals";

// The answer for every call while referrals are off: the standard 404, before any sign-in check.
const featureOff = route({
  access: "public",
  handler: async () => {
    throw notFound();
  },
});

const list = route({
  access: ["practitioner", "admin"],
  handler: async () => ({ json: await listReferrals() }),
});

// The switch is checked before route() runs its own checks, so while REFERRALS_ENABLED is not "true"
// every caller, signed in or not, gets the same 404 and cannot tell the route exists.
export const GET: typeof list = (req, ctx) => (env.referralsEnabled ? list : featureOff)(req, ctx);
