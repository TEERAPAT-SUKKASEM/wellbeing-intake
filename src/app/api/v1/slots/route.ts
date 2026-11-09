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

    const fields = [...(serviceId ? [] : ["service_id"]), ...(isCalendarDate(date) ? [] : ["date"])];
    if (fields.length) throw new HttpError(400, { error: "validation_failed", fields });

    const service = await readActiveService(serviceId);
    if (!service) throw notFound();

    return { json: await listSlots(service, date) };
  },
});
