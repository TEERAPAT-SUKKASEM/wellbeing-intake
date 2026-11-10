// GET /api/v1/slots?service_id=...&date=YYYY-MM-DD: list one service's slots on one campus date.
// Who can call it: public (no sign-in, no key).
// What it does: Checks both query values and finds the active service. Then it builds the day's slots
//   from the opening hours and marks each one available or not. A slot is unavailable if it is past,
//   too far ahead, or if it plus its 15-minute buffer would touch a live request or that request's buffer.
// Returns: 200 with an array of { slot_start, slot_end, is_available } (empty if closed that day);
//   400 validation_failed; 404 not_found for an unknown or switched-off service.
import { HttpError, notFound, route } from "@/lib/http";
import { listSlots, readActiveService } from "@/lib/slots/calendar";
import { isCalendarDate } from "@/lib/slots/grid";

// PRD 2: slots of one service on one campus date. Public users see Available or Unavailable and
// nothing else: no counts, no aliases, and no way to tell a booked slot from a buffer or a past time.
export const GET = route({
  access: "public",
  handler: async ({ req }) => {
    const query = new URL(req.url).searchParams;
    const serviceId = query.get("service_id") ?? "";
    const date = query.get("date") ?? "";

    // Collect every bad field at once, so the page can show all problems together. Only field names
    // are returned, never the values. isCalendarDate() also refuses impossible dates like 2026-02-30.
    const fields = [...(serviceId ? [] : ["service_id"]), ...(isCalendarDate(date) ? [] : ["date"])];
    if (fields.length) throw new HttpError(400, { error: "validation_failed", fields });

    // An unknown or switched-off service gives the same 404 as any other missing resource.
    const service = await readActiveService(serviceId);
    if (!service) throw notFound();

    // listSlots() reads only the start and buffer end of live (PENDING or CONFIRMED) requests, never who
    // booked or why. Slots are calculated on every call, never stored, so they always match the calendar.
    // Slots step by session length + 15 minutes, so the gap between two slots IS the privacy buffer.
    return { json: await listSlots(service, date) };
  },
});
