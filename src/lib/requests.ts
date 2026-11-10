// What this file does: describes an appointment request row from the database and turns it into the
// AppointmentRequest JSON shape from the PRD.
// Why it exists: every route that returns a request uses the same shape, and the access key is only
// included when the caller has just proved they hold it.
// Used by: GET /requests/me, PATCH /requests/{id}/status, GET /practitioner/queue and
// GET /practitioner/schedule.
import "server-only";
import { toIso } from "@/lib/slots/grid";

// The AppointmentRequest shape from the PRD's shared data contract.
// `access_key` appears only when the caller already holds the key. Staff responses leave it out: a
// practitioner must not be able to act as the student, and the database only holds its hash anyway.

// One row of the appointment_request table. buffer_end is always slot_end + 15 minutes: the privacy
// buffer, which the database checks.
export type RequestRow = {
  id: string;
  service_id: string;
  alias: string | null;
  intake_note: string;
  urgency_level: "ROUTINE" | "URGENT";
  triage_mode: "AI_ASSISTED" | "DETERMINISTIC_FALLBACK";
  slot_start: string;
  slot_end: string;
  buffer_end: string;
  status: "PENDING" | "CONFIRMED" | "REJECTED" | "CANCELLED";
};

// The columns routes select. access_key_hash is left out on purpose, so the hash is never sent out.
export const REQUEST_COLUMNS =
  "id, service_id, alias, intake_note, urgency_level, triage_mode, slot_start, slot_end, buffer_end, status";

/** Builds the PRD's AppointmentRequest JSON. Pass accessKey only if the caller just proved they hold it. */
export function toAppointmentRequest(row: RequestRow, accessKey?: string) {
  return {
    id: row.id,
    // access_key is added only when it was passed in; staff responses never get it.
    ...(accessKey ? { access_key: accessKey } : {}),
    service_id: row.service_id,
    alias: row.alias,
    intake_note: row.intake_note,
    urgency_level: row.urgency_level,
    triage_mode: row.triage_mode,
    // Times go out as UTC text like 2026-11-10T10:00:00Z, the format the PRD shows.
    requested_slot_start: toIso(row.slot_start),
    requested_slot_end: toIso(row.slot_end),
    privacy_buffer_end: toIso(row.buffer_end),
    status: row.status,
  };
}
