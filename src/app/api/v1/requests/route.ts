import { z } from "zod";
import { deriveAccessKey, generateAccessKey, hashAccessKey } from "@/lib/access-key";
import { env } from "@/lib/env";
import { HttpError, route } from "@/lib/http";
import { addHit, clientAddress, isLimited } from "@/lib/rate-limit";
import type { RequestRow } from "@/lib/requests";
import { checkRequestedSlot, listSlots, readActiveService } from "@/lib/slots/calendar";
import { campusDateOf, toIso } from "@/lib/slots/grid";
import { db } from "@/lib/supabase/admin";
import { assessUrgency, guidanceFor, logTriage } from "@/lib/urgency/assess";

// PRD 3: submit an anonymous request. No sign-in, and `.strict()` means the body cannot carry an email,
// a name field or a student id: there is nowhere to put them. The alias is optional and free-form.
const newRequest = z
  .object({
    service_id: z.string().min(1).max(64),
    alias: z.string().trim().max(40).nullish(),
    intake_note: z.string().trim().min(1).max(2000),
    manual_urgency: z.enum(["ROUTINE", "URGENT"]).nullish(),
    requested_slot_start: z.iso.datetime({ offset: true }),
    // Added to the PRD body: the note only goes to the AI provider if the student chooses that.
    ai_opt_in: z.boolean().optional(),
  })
  .strict();

const uuid = z.uuid();

type CreateResult =
  | { code: "ok"; created: boolean; request: RequestRow }
  | { code: "service_not_found" | "slot_unavailable" };

function accepted(status: number, request: RequestRow, accessKey: string) {
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
      ...guidanceFor(request.urgency_level),
    },
  };
}

export const POST = route({
  access: "public",
  body: newRequest,
  handler: async ({ req, body, cid }) => {
    const address = clientAddress(req);
    if (isLimited("request", address, env.requestsPerIp)) throw new HttpError(429, { error: "too_many_requests" });

    // Optional, for the double-click or lost-response case: the same key returns the same request.
    const idempotencyHeader = req.headers.get("idempotency-key");
    if (idempotencyHeader !== null && !uuid.safeParse(idempotencyHeader).success) {
      throw new HttpError(400, { error: "validation_failed", fields: ["Idempotency-Key"] });
    }
    const submissionKey = idempotencyHeader;
    const accessKey = submissionKey ? deriveAccessKey(submissionKey, env.accessKeySecret) : generateAccessKey();

    if (submissionKey) {
      const existing = await db()
        .from("appointment_request")
        .select("id, status, urgency_level, triage_mode, slot_start, slot_end, buffer_end")
        .eq("submission_key", submissionKey)
        .maybeSingle();
      if (existing.error) throw new Error("read_failed");
      if (existing.data) return accepted(200, existing.data as RequestRow, accessKey);
    }

    const service = await readActiveService(body.service_id);
    if (!service) throw new HttpError(400, { error: "validation_failed", fields: ["service_id"] });

    const start = new Date(body.requested_slot_start);
    const slotCheck = await checkRequestedSlot(service, start);
    if (slotCheck === "off_grid") throw new HttpError(400, { error: "validation_failed", fields: ["requested_slot_start"] });

    const unavailable = async () =>
      new HttpError(409, { error: "slot_unavailable", slots: await listSlots(service, campusDateOf(start)) });
    if (slotCheck === "out_of_range") throw await unavailable();

    addHit("request", address);

    // Global hourly cap: a script rotating addresses still cannot fill the whole calendar at once.
    const budget = await db().rpc("consume_request_budget", { p_limit: env.requestsPerHour });
    if (budget.error) throw new Error("budget_failed");
    if (budget.data !== true) throw new HttpError(429, { error: "too_many_requests" });

    const startedAt = Date.now();
    const triage = await assessUrgency({
      note: body.intake_note,
      manualUrgency: body.manual_urgency,
      useAi: body.ai_opt_in === true,
    });
    logTriage(cid, triage, startedAt);

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
      if (result.code === "service_not_found") throw new HttpError(400, { error: "validation_failed", fields: ["service_id"] });
      throw await unavailable();
    }

    return accepted(result.created ? 201 : 200, result.request, accessKey);
  },
});
