import { api, type ApiInit, type ApiResult } from "./api";
import type {
  AppointmentRequest,
  Assessment,
  Receipt,
  Service,
  Slot,
} from "./contracts";
import { EMERGENCY_CONTACTS, CANNOT_HELP_NOW } from "@/lib/emergency";
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
const records = new Map<string, AppointmentRequest>();
const receipts = new Map<string, Receipt>();
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
export function sampleSlots(serviceId: string, date: string): Slot[] {
  const duration =
    sampleServices.find((s) => s.id === serviceId)?.duration_minutes ?? 45;
  return [9, 10, 11, 13, 14, 15].map((hour, i) => {
    const start = new Date(
      `${date}T${String(hour).padStart(2, "0")}:00:00+07:00`,
    );
    return {
      slot_start: start.toISOString(),
      slot_end: new Date(start.getTime() + duration * 60000).toISOString(),
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
export async function previewApi<T>(
  path: string,
  init?: ApiInit,
): Promise<ApiResult<T>> {
  const result = (
    data: unknown,
    status = 200,
    error: string | null = null,
  ): ApiResult<T> => ({ ok: status < 400, status, data: data as T, error });
  const url = new URL(path, "http://preview.local");
  if (url.pathname === "/services") return result(sampleServices);
  if (url.pathname === "/slots")
    return result(
      sampleSlots(
        url.searchParams.get("service_id") ?? "",
        url.searchParams.get("date") ?? "",
      ),
    );
  if (path === "/requests" && init?.method === "POST") {
    const body = init.body as {
      service_id: string;
      alias: string;
      intake_note: string;
      manual_urgency: string;
      requested_slot_start: string;
    };
    const submission = init.headers?.["Idempotency-Key"] ?? "";
    if (receipts.has(submission)) return result(receipts.get(submission));
    const date = body.requested_slot_start.slice(0, 10);
    const slot = sampleSlots(body.service_id, date).find(
      (s) => s.slot_start === body.requested_slot_start,
    );
    if (!slot?.is_available)
      return result(
        { slots: sampleSlots(body.service_id, date) },
        409,
        "slot_unavailable",
      );
    const key = `WB-${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase().match(/.{4}/g)!.join("-")}`;
    const receipt: Receipt = {
      ...sampleGuidance(body.manual_urgency === "URGENT"),
      id: crypto.randomUUID(),
      access_key: key,
      status: "PENDING",
      requested_slot_start: slot.slot_start,
      requested_slot_end: slot.slot_end,
      privacy_buffer_end: new Date(
        new Date(slot.slot_end).getTime() + 900000,
      ).toISOString(),
    };
    records.set(key, {
      ...receipt,
      service_id: body.service_id,
      alias: body.alias || null,
      intake_note: body.intake_note,
    });
    receipts.set(submission, receipt);
    return result(receipt, 201);
  }
  if (path === "/requests/me") {
    const row = records.get(init?.headers?.["X-Access-Key"] ?? "");
    return row ? result(row) : result(null, 404, "not_found");
  }
  if (/^\/requests\/[^/]+\/cancel$/.test(path)) {
    const row = records.get((init?.body as { access_key: string }).access_key);
    if (!row || !path.includes(row.id)) return result(null, 404, "not_found");
    row.status = "CANCELLED";
    return result({ id: row.id, status: row.status });
  }
  return result(null, 404, "not_found");
}
export function studentApi(preview: boolean): typeof api {
  return preview ? previewApi : api;
}
