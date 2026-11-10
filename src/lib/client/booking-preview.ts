// What this helper does: a fake, in-memory copy of the student API, used only in UI preview mode.
// Talks to: no real API. It imitates GET /services, GET /slots, POST /requests, GET /requests/me
//   and POST /requests/{id}/cancel, with the same answers and status codes.
// Note: nothing is saved anywhere. Refreshing the page clears every preview request and key.
import { api, type ApiInit, type ApiResult } from "./api";
import type {
  AppointmentRequest,
  Assessment,
  Receipt,
  Service,
  Slot,
} from "./contracts";
import { EMERGENCY_CONTACTS, CANNOT_HELP_NOW } from "@/lib/emergency";
/** Three fictional services, the same examples as in the PRD. */
export const sampleServices: Service[] = [
  {
    id: "srv_academic_stress",
    name: "Academic Stress Counselling",
    description:
      "Talk through study pressure, exams, and finding balance in student life.",
    duration_minutes: 45,
    is_active: true,
  },
  {
    id: "srv_general_counselling",
    name: "General Counselling",
    description:
      "A private space to discuss relationships, worries, or anything weighing on you.",
    duration_minutes: 45,
    is_active: true,
  },
  {
    id: "srv_urgent_drop_in",
    name: "Urgent Drop-in",
    description:
      "Request counselling for a concern that feels urgent. For immediate help, use the emergency contacts.",
    duration_minutes: 30,
    is_active: true,
  },
];
// The fake "database", kept in memory only: requests by access key, receipts by Idempotency-Key.
const records = new Map<string, AppointmentRequest>();
const receipts = new Map<string, Receipt>();
/** A fake triage answer. It is labelled DETERMINISTIC_FALLBACK, so the preview never pretends to be AI. */
export function sampleGuidance(urgent = false): Assessment {
  return {
    urgency_level: urgent ? "URGENT" : "ROUTINE",
    triage_mode: "DETERMINISTIC_FALLBACK",
    disclaimer: CANNOT_HELP_NOW,
    emergency_links: EMERGENCY_CONTACTS.map((c) => ({
      ...c,
      href: `tel:${c.tel}`,
    })),
  };
}
/** Six fake start times for one day (09:00 to 15:00 campus time), with the 15-minute buffer rule. */
export function sampleSlots(serviceId: string, date: string): Slot[] {
  const duration =
    sampleServices.find((s) => s.id === serviceId)?.duration_minutes ?? 45;
  return [9, 10, 11, 13, 14, 15].map((hour, i) => {
    // "+07:00" is Bangkok time, so the fake slots follow the campus clock.
    const start = new Date(
      `${date}T${String(hour).padStart(2, "0")}:00:00+07:00`,
    );
    return {
      slot_start: start.toISOString(),
      slot_end: new Date(start.getTime() + duration * 60000).toISOString(),
      // A slot is NOT available when: it is the 3rd slot (always taken, to show the "Unavailable" look),
      // it is already in the past, or this session plus its own 15-minute buffer would overlap
      // a PENDING or CONFIRMED booking plus that booking's buffer.
      is_available:
        i !== 2 &&
        start.getTime() > Date.now() &&
        ![...records.values()].some(
          (r) =>
            ["PENDING", "CONFIRMED"].includes(r.status) &&
            start < new Date(r.privacy_buffer_end) &&
            new Date(start.getTime() + (duration + 15) * 60000) >
              new Date(r.requested_slot_start),
        ),
    };
  });
}
// Selected only by development UI_PREVIEW props. Nothing persists across refreshes.
// It has the same inputs and output as api(), so a screen can use either one (see studentApi).
export async function previewApi<T>(
  path: string,
  init?: ApiInit,
): Promise<ApiResult<T>> {
  // Small helper that builds an ApiResult. Any status of 400 or more counts as a failure.
  const result = (
    data: unknown,
    status = 200,
    error: string | null = null,
  ): ApiResult<T> => ({ ok: status < 400, status, data: data as T, error });
  // A dummy base address only splits the path from its ?query values. Nothing is fetched.
  const url = new URL(path, "http://preview.local");
  if (url.pathname === "/services") return result(sampleServices);
  if (url.pathname === "/slots")
    return result(
      sampleSlots(
        url.searchParams.get("service_id") ?? "",
        url.searchParams.get("date") ?? "",
      ),
    );
  // POST /requests: book the chosen time and return a receipt with a new access key.
  if (path === "/requests" && init?.method === "POST") {
    const body = init.body as {
      service_id: string;
      alias: string;
      intake_note: string;
      manual_urgency: string;
      requested_slot_start: string;
    };
    // A known Idempotency-Key means the same form was sent again (double click or lost answer).
    // Return the first receipt again, so a retry never books twice and the key is not lost.
    const submission = init.headers?.["Idempotency-Key"] ?? "";
    if (receipts.has(submission)) return result(receipts.get(submission));
    const date = body.requested_slot_start.slice(0, 10);
    const slot = sampleSlots(body.service_id, date).find(
      (s) => s.slot_start === body.requested_slot_start,
    );
    // Taken, past or unknown time: answer 409 slot_unavailable with that day's fresh slots.
    if (!slot?.is_available)
      return result(
        { slots: sampleSlots(body.service_id, date) },
        409,
        "slot_unavailable",
      );
    // Key format WB-XXXX-XXXX-XXXX: 12 random hex characters from a UUID, in 3 groups of 4.
    const key = `WB-${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase().match(/.{4}/g)!.join("-")}`;
    const receipt: Receipt = {
      ...sampleGuidance(body.manual_urgency === "URGENT"),
      id: crypto.randomUUID(),
      access_key: key,
      status: "PENDING",
      requested_slot_start: slot.slot_start,
      requested_slot_end: slot.slot_end,
      // 900000 ms = 15 minutes: the privacy buffer after the session ends.
      privacy_buffer_end: new Date(
        new Date(slot.slot_end).getTime() + 900000,
      ).toISOString(),
    };
    // Save the full request under its key (for status lookup) and the receipt under the
    // Idempotency-Key (for safe retries). 201 = created.
    records.set(key, {
      ...receipt,
      service_id: body.service_id,
      alias: body.alias || null,
      intake_note: body.intake_note,
    });
    receipts.set(submission, receipt);
    return result(receipt, 201);
  }
  // GET /requests/me: the key arrives in the X-Access-Key header. An unknown key gets 404.
  if (path === "/requests/me") {
    const row = records.get(init?.headers?.["X-Access-Key"] ?? "");
    return row ? result(row) : result(null, 404, "not_found");
  }
  // POST /requests/{id}/cancel: the key in the body must belong to this request id, otherwise 404.
  if (/^\/requests\/[^/]+\/cancel$/.test(path)) {
    const row = records.get((init?.body as { access_key: string }).access_key);
    if (!row || !path.includes(row.id)) return result(null, 404, "not_found");
    // sampleSlots() only counts PENDING and CONFIRMED, so cancelling frees the time and its buffer.
    row.status = "CANCELLED";
    return result({ id: row.id, status: row.status });
  }
  // Any other path is not part of the preview.
  return result(null, 404, "not_found");
}
/** Picks the API for student screens: the fake previewApi in preview mode, otherwise the real api(). */
export function studentApi(preview: boolean): typeof api {
  return preview ? previewApi : api;
}
