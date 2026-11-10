// PATCH /api/v1/requests/{id}/status: a practitioner approves, reschedules, rejects or cancels a request.
// Who can call it: practitioners only (signed in). No sign-in gets 401; admins and other staff get 404.
// What it does: Checks the decision. For a reschedule it checks the new time is a real future slot of
//   this request's service. A database function then applies the change in one transaction and, when
//   needed, writes a webhook event (appointment.confirmed or .cancelled) to the outbox. Last, it tries
//   to send that webhook at once.
// Returns: 200 with the updated request; 400 validation_failed; 404 not_found; 409 invalid_transition
//   or slot_unavailable; 403 cross_origin_rejected if a cookie-signed write comes from another website.
import { z } from "zod";
import { dispatchInline } from "@/lib/events/dispatcher";
import { HttpError, notFound, route } from "@/lib/http";
import { toAppointmentRequest, type RequestRow } from "@/lib/requests";
import { checkRequestedSlot, type ServiceRow } from "@/lib/slots/calendar";
import { db } from "@/lib/supabase/admin";

// PRD 7: the Triage Desk's quick actions.
//   Approve     { "status": "CONFIRMED" }
//   Reschedule  { "status": "CONFIRMED", "requested_slot_start": "<a free slot>" }  (added to the PRD)
//   Reject      { "status": "REJECTED" }
//   Cancel      { "status": "CANCELLED" }                                           (added to the PRD)
const decision = z
  .object({
    status: z.enum(["CONFIRMED", "REJECTED", "CANCELLED"]),
    requested_slot_start: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

// The result codes the SQL function decide_request can send back. notify says a webhook was queued.
type DecideResult =
  | { code: "ok"; notify: boolean; request: RequestRow }
  | { code: "not_found" | "invalid_transition" | "slot_unavailable" };

export const PATCH = route({
  // route() also blocks a cookie-signed write that comes from another website (403), so another site
  // cannot use a practitioner's browser cookie to approve or cancel requests.
  access: ["practitioner"],
  body: decision,
  handler: async ({ params, body, caller, cid }) => {
    // A new time only makes sense with CONFIRMED (a reschedule). With REJECTED or CANCELLED it is a 400.
    if (body.requested_slot_start && body.status !== "CONFIRMED") {
      throw new HttpError(400, { error: "validation_failed", fields: ["requested_slot_start"] });
    }

    const newStart = body.requested_slot_start ? new Date(body.requested_slot_start) : null;
    if (newStart) {
      // Reschedule: the new time must be a real slot of the SAME service, so read the service length
      // through the request's service_id link. No row means an unknown id: 404.
      const current = await db()
        .from("appointment_request")
        .select("service:service_id(duration_minutes)")
        .eq("id", params.id)
        .maybeSingle();
      if (current.error) throw new Error("read_failed");
      const service = current.data?.service as unknown as Pick<ServiceRow, "duration_minutes"> | null;
      if (!service) throw notFound();

      // "off_grid": not a slot start in the opening hours (400). "out_of_range": past or too far ahead
      // (409). Whether the time is FREE is decided later by the database, inside the transaction.
      const slotCheck = await checkRequestedSlot(service, newStart);
      if (slotCheck === "off_grid") {
        throw new HttpError(400, { error: "validation_failed", fields: ["requested_slot_start"] });
      }
      if (slotCheck === "out_of_range") throw new HttpError(409, { error: "slot_unavailable" });
    }

    // rpc() calls the SQL function decide_request, which locks the row and applies the action in one
    // transaction. It records who decided (p_actor is the staff id). When needed it writes the webhook
    // event into the outbox (a table of events still to send) in the SAME transaction, so a decision can
    // never lose its event. Repeating a decision changes nothing and queues no second event.
    const { data, error } = await db().rpc("decide_request", {
      p_id: params.id,
      p_actor: caller!.id,
      p_status: body.status,
      p_new_start: newStart?.toISOString() ?? null,
    });
    if (error) throw new Error("decide_failed");

    const result = data as DecideResult;
    if (result.code !== "ok") {
      if (result.code === "not_found") throw notFound();
      throw new HttpError(409, { error: result.code }); // invalid_transition or slot_unavailable
    }

    // Fires the webhook right after the decision commits. An outage only delays it (it waits in the outbox).
    if (result.notify) await dispatchInline(cid);
    // Staff replies never include the access key.
    return { json: toAppointmentRequest(result.request) };
  },
});
