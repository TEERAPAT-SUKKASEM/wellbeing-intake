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

type DecideResult =
  | { code: "ok"; notify: boolean; request: RequestRow }
  | { code: "not_found" | "invalid_transition" | "slot_unavailable" };

export const PATCH = route({
  access: ["practitioner"],
  body: decision,
  handler: async ({ params, body, caller, cid }) => {
    if (body.requested_slot_start && body.status !== "CONFIRMED") {
      throw new HttpError(400, { error: "validation_failed", fields: ["requested_slot_start"] });
    }

    const newStart = body.requested_slot_start ? new Date(body.requested_slot_start) : null;
    if (newStart) {
      const current = await db()
        .from("appointment_request")
        .select("service:service_id(duration_minutes)")
        .eq("id", params.id)
        .maybeSingle();
      if (current.error) throw new Error("read_failed");
      const service = current.data?.service as unknown as Pick<ServiceRow, "duration_minutes"> | null;
      if (!service) throw notFound();

      const slotCheck = await checkRequestedSlot(service, newStart);
      if (slotCheck === "off_grid") {
        throw new HttpError(400, { error: "validation_failed", fields: ["requested_slot_start"] });
      }
      if (slotCheck === "out_of_range") throw new HttpError(409, { error: "slot_unavailable" });
    }

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
    return { json: toAppointmentRequest(result.request) };
  },
});
