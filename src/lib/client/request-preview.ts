import type { api, ApiResult } from "./api";
import type { BookingSlot, StudentRequest } from "@/components/requests/types";
import { previewServices } from "./preview-services";

// Local UI fixtures only. No storage, request content, identity, or network access.
export function createRequestPreviewApi(serviceId?: string): typeof api {
  const service = previewServices.find(item => item.id === serviceId) ?? previewServices[3];
  const slots: BookingSlot[] = ["2026-11-19T09:00:00", "2026-11-19T10:30:00", "2026-11-19T13:00:00", "2026-11-19T14:30:00", "2026-11-20T09:00:00", "2026-11-20T13:00:00"].map((startAt, index) => ({ id: `b16e0000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, startAt }));
  const request: StudentRequest = {
    id: "a16e0001-0000-4000-8000-000000000001", serviceName: service.name, triageLevelId: 1,
    status: "in_review", submittedAt: "2026-11-18T09:00:00", bookable: true, appointment: null,
  };
  return async function send<T>(path: string, init?: { method?: string; body?: unknown }): Promise<ApiResult<T>> {
    const response = (data: unknown, status = 200, error: string | null = null): ApiResult<T> => ({ ok: status < 400, status, data: data as T, error });
    if (path === "/requests/me") return response({ requests: [{ ...request, appointment: request.appointment ? { ...request.appointment } : null }] });
    if (path === `/requests/${request.id}/slots`) return response({ slots: request.bookable ? slots : [] });
    if (path === "/appointments" && init?.method === "POST") {
      const body = init.body as { slotId?: string; requestId?: string } | undefined;
      const slot = slots.find(item => item.id === body?.slotId);
      if (!request.bookable || body?.requestId !== request.id) return response(null, 409, "request_not_bookable");
      if (!slot) return response({ slots }, 409, "slot_taken");
      request.appointment = { id: "c16e0001-0000-4000-8000-000000000001", startAt: slot.startAt };
      request.bookable = false;
      request.status = "handled";
      return response({ id: request.appointment.id, startAt: slot.startAt, status: "confirmed" }, 201);
    }
    if (path === "/appointments/c16e0001-0000-4000-8000-000000000001/cancel" && init?.method === "POST") {
      if (!request.appointment) return response(null, 404, "not_found");
      request.appointment = null;
      // Cancellation releases the appointment, but does not reopen the handled request.
      request.bookable = false;
      request.status = "handled";
      return response({ id: "c16e0001-0000-4000-8000-000000000001", status: "cancelled" });
    }
    return response(null, 404, "not_found");
  };
}
