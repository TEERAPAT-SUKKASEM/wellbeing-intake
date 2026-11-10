// GET /api/v1/practitioner/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD: sessions for the timeline screen.
// Who can call it: practitioners only (signed in). No sign-in gets 401; admins and other staff get 404.
// What it does: Reads "from" and "to" as campus dates. By default it shows 7 days starting today, and
//   the range may be at most 31 days. It returns PENDING and CONFIRMED requests that touch the range,
//   in time order.
// Returns: 200 with an array of requests (never with an access key); 400 validation_failed for a bad
//   date or range; 401 unauthenticated; 404 not_found.
import { HttpError, route } from "@/lib/http";
import { REQUEST_COLUMNS, toAppointmentRequest, type RequestRow } from "@/lib/requests";
import { campusDateOf, campusDayBounds, isCalendarDate } from "@/lib/slots/grid";
import { db } from "@/lib/supabase/admin";

// The range limit stops one call from reading the whole table at once.
const MAX_RANGE_DAYS = 31;
// One day in milliseconds (24 x 60 x 60 x 1000).
const DAY_MS = 86_400_000;

// Added to the PRD: Screen 3's daily and weekly timeline needs confirmed appointments too, which the
// queue does not carry. Every item has privacy_buffer_end, so the buffer block can be drawn after it.
export const GET = route({
  access: ["practitioner"],
  handler: async ({ req }) => {
    const query = new URL(req.url).searchParams;
    // Dates are campus dates (Thailand time, UTC+7), so "today" means today on campus, not in UTC.
    // isCalendarDate() also refuses impossible dates such as 2026-02-30.
    const from = query.get("from") ?? campusDateOf(new Date());
    if (!isCalendarDate(from)) throw new HttpError(400, { error: "validation_failed", fields: ["from"] });

    // campusDayBounds() gives the campus midnight that starts the day and the midnight that ends it.
    // The default "to" is 6 days after "from", so the default view is a full 7-day week.
    const start = campusDayBounds(from).start;
    const to = query.get("to") ?? campusDateOf(new Date(start.getTime() + 6 * DAY_MS));
    if (!isCalendarDate(to)) throw new HttpError(400, { error: "validation_failed", fields: ["to"] });

    // "to" must not be before "from", and the whole range must be at most 31 days.
    const end = campusDayBounds(to).end;
    if (end <= start || end.getTime() - start.getTime() > MAX_RANGE_DAYS * DAY_MS) {
      throw new HttpError(400, { error: "validation_failed", fields: ["to"] });
    }

    // Only live requests (PENDING or CONFIRMED) hold time on the calendar. A session is in range if it
    // starts before the range ends and its buffer ends after the range starts, so a session (or buffer)
    // that crosses midnight into the range is still shown.
    const { data, error } = await db()
      .from("appointment_request")
      .select(REQUEST_COLUMNS)
      .in("status", ["PENDING", "CONFIRMED"])
      .lt("slot_start", end.toISOString())
      .gt("buffer_end", start.toISOString())
      .order("slot_start", { ascending: true });
    // A plain Error becomes a content-free 500 in route(); the message is never sent to the caller.
    if (error) throw new Error("read_failed");
    // Same shape as the queue, and again without any access key.
    return { json: ((data ?? []) as unknown as RequestRow[]).map((row) => toAppointmentRequest(row)) };
  },
});
