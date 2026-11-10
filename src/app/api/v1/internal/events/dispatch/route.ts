// POST /api/v1/internal/events/dispatch: send the webhook events that are still waiting in the outbox.
// Who can call it: machine token only (Authorization: Bearer <DISPATCH_TOKEN>), never a signed-in person.
// What it does: route() checks the token. dispatch() then claims up to 20 waiting rows from the outbox
//   (a database table of events waiting to be sent), signs each one with HMAC (a signature made with a
//   shared secret) and POSTs it to the Notification Hub. A failed send is tried again later with a
//   growing delay, and is "parked" (given up) after the maximum number of tries.
//   Then it sends the waiting referral callbacks to Team 14's Helpdesk the same way, and deletes
//   referrals that arrived more than 30 days ago.
// Returns: 200 { claimed, delivered, retrying, parked, referrals: { skipped, sent, retry, gaveUp },
//   referrals_purged }; 401 unauthenticated if the token is wrong.
import { route } from "@/lib/http";
import { dispatch } from "@/lib/events/dispatcher";
import { sendReferralCallbacks } from "@/lib/partners/helpdesk-referrals";
import { db } from "@/lib/supabase/admin";

// Scoped machine credential only: not reachable with any user session. Retries pending webhook
// deliveries. The scheduled GitHub Actions job calls this, and it doubles as the database keep-alive.
// Returns counts only.
export const POST = route({
  // "machine": route() compares the Bearer token with DISPATCH_TOKEN in constant time (so the time
  // taken does not leak how much of the token was right). Cookies and staff sign-ins do not work here.
  access: "machine",
  // cid is the correlation id (a tracking id for this call). It is sent along with each webhook, so
  // the Hub's logs can be matched with ours.
  handler: async ({ cid }) => {
    // Notification Hub first, so its events go out even if the Helpdesk part below has a problem.
    const hub = await dispatch(cid);
    // Callbacks to Helpdesk that are due (up to 10). While referrals are off this sends nothing and
    // answers skipped: true.
    const referrals = await sendReferralCallbacks(cid);

    // Privacy: a referral is kept for 30 days at most. This runs even while referrals are off, so old
    // ones never linger. If the purge fails (for example the table is not there yet), report 0 and go on.
    const purge = await db().rpc("purge_old_referrals", { p_days: 30 });
    const referralsPurged = purge.error ? 0 : Number(purge.data) || 0;

    return { json: { ...hub, referrals, referrals_purged: referralsPurged } };
  },
});
