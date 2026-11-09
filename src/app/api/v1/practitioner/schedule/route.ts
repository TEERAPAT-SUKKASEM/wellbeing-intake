import { HttpError, route } from "@/lib/http";
import { REQUEST_COLUMNS, toAppointmentRequest, type RequestRow } from "@/lib/requests";
import { campusDateOf, campusDayBounds, isCalendarDate } from "@/lib/slots/grid";
import { db } from "@/lib/supabase/admin";

const MAX_RANGE_DAYS = 31;
const DAY_MS = 86_400_000;

// Added to the PRD: Screen 3's daily and weekly timeline needs confirmed appointments too, which the
// queue does not carry. Every item has privacy_buffer_end, so the buffer block can be drawn after it.
export const GET = route({
  access: ["practitioner"],
  handler: async ({ req }) => {
    const query = new URL(req.url).searchParams;
    const from = query.get("from") ?? campusDateOf(new Date());
    if (!isCalendarDate(from)) throw new HttpError(400, { error: "validation_failed", fields: ["from"] });

    const start = campusDayBounds(from).start;
    const to = query.get("to") ?? campusDateOf(new Date(start.getTime() + 6 * DAY_MS));
    if (!isCalendarDate(to)) throw new HttpError(400, { error: "validation_failed", fields: ["to"] });

    const end = campusDayBounds(to).end;
    if (end <= start || end.getTime() - start.getTime() > MAX_RANGE_DAYS * DAY_MS) {
      throw new HttpError(400, { error: "validation_failed", fields: ["to"] });
    }

    const { data, error } = await db()
      .from("appointment_request")
      .select(REQUEST_COLUMNS)
      .in("status", ["PENDING", "CONFIRMED"])
      .lt("slot_start", end.toISOString())
      .gt("buffer_end", start.toISOString())
      .order("slot_start", { ascending: true });
    if (error) throw new Error("read_failed");
    return { json: ((data ?? []) as unknown as RequestRow[]).map((row) => toAppointmentRequest(row)) };
  },
});
