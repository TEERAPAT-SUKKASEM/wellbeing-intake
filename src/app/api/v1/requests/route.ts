// POST /api/v1/requests: a student submits an anonymous appointment request.
// Who can call it: public (no sign-in, no personal details needed).
// What it does: Checks rate limits and the optional Idempotency-Key (an id that makes a retried submit
//   return the same result). Then it checks the service and that the time is a real, bookable slot, and
//   decides urgency (AI only if the student opted in). Last, a database function saves the request; the
//   database refuses it if it overlaps another live request or its 15-minute buffer.
// Returns: 201 with the new Private Access Key (shown only once), status, urgency and times; 200 for a
//   retry with the same Idempotency-Key; 400 validation_failed; 409 slot_unavailable with fresh slots; 429.
import { z } from "zod";
import { deriveAccessKey, generateAccessKey, hashAccessKey } from "@/lib/access-key";
import { env } from "@/lib/env";
import { HttpError, route } from "@/lib/http";
import { addHit, clientAddress, isLimited } from "@/lib/rate-limit";
import type { RequestRow } from "@/lib/requests";
import { checkRequestedSlot, listSlots, readActiveService } from "@/lib/slots/calendar";
import { campusDateOf, toIso } from "@/lib/slots/grid";
import { db } from "@/lib/supabase/admin";
import type { EmergencyContact } from "@/lib/emergency";
import { emergencyContactsFor } from "@/lib/partners/helpdesk";
import { assessUrgency, guidanceFor, logTriage } from "@/lib/urgency/assess";

// PRD 3: submit an anonymous request. No sign-in, and `.strict()` means the body cannot carry an email,
// a name field or a student id: there is nowhere to put them. The alias is optional and free-form.
const newRequest = z
  .object({
    service_id: z.string().min(1).max(64),
    alias: z.string().trim().max(40).nullish(),
    intake_note: z.string().trim().min(1).max(2000),
    // The student's own Routine/Urgent toggle (the fallback switch in the PRD). It may be left out.
    manual_urgency: z.enum(["ROUTINE", "URGENT"]).nullish(),
    // A full ISO date-time with a time zone, e.g. 2026-11-10T10:00:00+07:00 or ...T03:00:00Z.
    requested_slot_start: z.iso.datetime({ offset: true }),
    // Added to the PRD body: the note only goes to the AI provider if the student chooses that.
    ai_opt_in: z.boolean().optional(),
  })
  .strict();

// The Idempotency-Key header must be a UUID (a random 36-character id the web app makes once per form).
const uuid = z.uuid();

// The result codes the SQL function create_appointment_request can send back.
type CreateResult =
  | { code: "ok"; created: boolean; request: RequestRow }
  | { code: "service_not_found" | "slot_unavailable" };

// Builds the reply the student sees after submitting: the access key, the status, the times including
// the privacy buffer end, and fixed safety wording (disclaimer and emergency phone links) for the urgency.
// `contacts` is the emergency list from emergencyContactsFor(): ours, with Helpdesk's campus numbers.
function accepted(status: number, request: RequestRow, accessKey: string, contacts: readonly EmergencyContact[]) {
  return {
    status,
    json: {
      id: request.id,
      access_key: accessKey,
      status: request.status,
      urgency_level: request.urgency_level,
      triage_mode: request.triage_mode,
      requested_slot_start: toIso(request.slot_start),
      requested_slot_end: toIso(request.slot_end),
      privacy_buffer_end: toIso(request.buffer_end),
      ...guidanceFor(request.urgency_level, contacts),
    },
  };
}

export const POST = route({
  access: "public",
  body: newRequest,
  handler: async ({ req, body, cid }) => {
    // Rate limit (a cap per address, kept only in server memory and never saved or logged): a few
    // submissions per 10 minutes from one address. The hit itself is counted further down.
    const address = clientAddress(req);
    if (isLimited("request", address, env.requestsPerIp)) throw new HttpError(429, { error: "too_many_requests" });

    // Optional, for the double-click or lost-response case: the same key returns the same request.
    const idempotencyHeader = req.headers.get("idempotency-key");
    if (idempotencyHeader !== null && !uuid.safeParse(idempotencyHeader).success) {
      throw new HttpError(400, { error: "validation_failed", fields: ["Idempotency-Key"] });
    }
    const submissionKey = idempotencyHeader;
    // With an Idempotency-Key, the access key is made from it with a server secret (HMAC), so a retry
    // rebuilds the SAME key without the key ever being stored. Without one, the key is fully random.
    const accessKey = submissionKey ? deriveAccessKey(submissionKey, env.accessKeySecret) : generateAccessKey();

    // A retry of a submission that was already saved: answer 200 with the same request and key, and stop.
    if (submissionKey) {
      const existing = await db()
        .from("appointment_request")
        .select("id, status, urgency_level, triage_mode, slot_start, slot_end, buffer_end")
        .eq("submission_key", submissionKey)
        .maybeSingle();
      if (existing.error) throw new Error("read_failed");
      if (existing.data) return accepted(200, existing.data as RequestRow, accessKey, await emergencyContactsFor(cid));
    }

    // The service must exist and be active. Here an unknown service is a 400 on the service_id field,
    // because it is part of the body the student sent.
    const service = await readActiveService(body.service_id);
    if (!service) throw new HttpError(400, { error: "validation_failed", fields: ["service_id"] });

    // "off_grid": not a real slot start for this service in the opening hours, so a 400.
    // "out_of_range": in the past or beyond the booking horizon (30 days by default), so a 409 below.
    const start = new Date(body.requested_slot_start);
    const slotCheck = await checkRequestedSlot(service, start);
    if (slotCheck === "off_grid") throw new HttpError(400, { error: "validation_failed", fields: ["requested_slot_start"] });

    // The 409 reply carries that day's fresh slot list, so the page can offer other free times at once.
    const unavailable = async () =>
      new HttpError(409, { error: "slot_unavailable", slots: await listSlots(service, campusDateOf(start)) });
    if (slotCheck === "out_of_range") throw await unavailable();

    // Count the hit only now, after the checks above pass, so fixing form mistakes does not use the limit.
    addHit("request", address);

    // Global hourly cap: a script rotating addresses still cannot fill the whole calendar at once.
    // The SQL function adds 1 to this hour's counter and answers false once the cap is reached.
    const budget = await db().rpc("consume_request_budget", { p_limit: env.requestsPerHour });
    if (budget.error) throw new Error("budget_failed");
    if (budget.data !== true) throw new HttpError(429, { error: "too_many_requests" });

    // Decide urgency. The note goes to the AI only if ai_opt_in is true. The result is URGENT if the AI,
    // a crisis phrase, or the student's own choice says so. Any AI failure falls back without blocking.
    const startedAt = Date.now();
    const triage = await assessUrgency({
      note: body.intake_note,
      manualUrgency: body.manual_urgency,
      useAi: body.ai_opt_in === true,
    });
    // Logs only the mode, the fallback reason and the time taken: never the note and never the urgency.
    logTriage(cid, triage, startedAt);

    // rpc() calls the SQL function create_appointment_request as one transaction. It stores only the HASH
    // of the access key, checks again that the service is active and the time is in the future, then adds
    // the session length and the 15-minute buffer and inserts the row. An exclusion constraint (a database
    // rule that no two live rows may overlap) refuses the insert if the time, buffer included, touches
    // another PENDING or CONFIRMED request. It works even when two students click at the same moment.
    const { data, error } = await db().rpc("create_appointment_request", {
      p_key_hash: hashAccessKey(accessKey),
      p_submission_key: submissionKey,
      p_service: service.id,
      p_alias: body.alias ?? null,
      p_note: body.intake_note,
      p_urgency: triage.urgency_level,
      p_mode: triage.triage_mode,
      p_start: start.toISOString(),
    });
    if (error) throw new Error("create_failed");

    const result = data as CreateResult;
    if (result.code !== "ok") {
      // service_not_found: the service was switched off between our check and the insert.
      if (result.code === "service_not_found") throw new HttpError(400, { error: "validation_failed", fields: ["service_id"] });
      // slot_unavailable: someone else holds this time (or it has just passed). 409 with fresh slots.
      throw await unavailable();
    }

    // created is false when the database found this Idempotency-Key already saved (two copies of the
    // same submit raced each other). Then it is the same request, so the answer is 200, not 201.
    return accepted(result.created ? 201 : 200, result.request, accessKey, await emergencyContactsFor(cid));
  },
});
