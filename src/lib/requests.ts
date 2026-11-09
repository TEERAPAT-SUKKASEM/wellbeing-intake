import "server-only";
import { toIso } from "@/lib/slots/grid";

// The AppointmentRequest shape from the PRD's shared data contract.
// `access_key` appears only when the caller already holds the key. Staff responses leave it out: a
// practitioner must not be able to act as the student, and the database only holds its hash anyway.

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

export const REQUEST_COLUMNS =
  "id, service_id, alias, intake_note, urgency_level, triage_mode, slot_start, slot_end, buffer_end, status";

export function toAppointmentRequest(row: RequestRow, accessKey?: string) {
  return {
    id: row.id,
    ...(accessKey ? { access_key: accessKey } : {}),
    service_id: row.service_id,
    alias: row.alias,
    intake_note: row.intake_note,
    urgency_level: row.urgency_level,
    triage_mode: row.triage_mode,
    requested_slot_start: toIso(row.slot_start),
    requested_slot_end: toIso(row.slot_end),
    privacy_buffer_end: toIso(row.buffer_end),
    status: row.status,
  };
}
