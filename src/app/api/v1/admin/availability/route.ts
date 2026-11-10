// GET /api/v1/admin/availability: read the weekly opening hours of the one shared calendar.
// PUT /api/v1/admin/availability: replace the whole week of opening hours in one step.
// Who can call it: admins only (signed-in staff with the admin role). No sign-in gets 401, other staff 404.
// What it does: GET reads every opening window (weekday, start time, end time) in order.
//   PUT checks the new week, refuses windows that overlap on the same day, then asks the database to
//   swap the old week for the new one in one transaction. GET /slots is calculated from these windows,
//   so students see the new hours straight away.
// Returns: 200 { windows } (the week as saved). PUT can also return 400 validation_failed, and 403
//   cross_origin_rejected if a cookie-signed write comes from another website.
import { z } from "zod";
import { HttpError, route } from "@/lib/http";
import { db } from "@/lib/supabase/admin";

// A time is "HH:MM" in 24-hour form, e.g. 09:00 or 16:30. The leading zero matters: it lets us
// compare two times as plain strings ("09:00" < "16:30") later in this file.
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// zod schema (a rule list that checks the JSON body before the handler runs). .strict() refuses any
// unknown field, .refine() makes each window start before it ends, and .max(50) stops huge bodies.
const week = z
  .object({
    windows: z
      .array(
        z
          .object({
            weekday: z.number().int().min(0).max(6),
            start_time: z.string().regex(TIME),
            end_time: z.string().regex(TIME),
          })
          .strict()
          .refine((w) => w.start_time < w.end_time),
      )
      .max(50),
  })
  .strict();

// True if two windows on the same weekday overlap. After sorting by day and start time, comparing each
// window with the one just before it is enough to find any overlap. Windows that only touch
// (09:00-12:00 and 12:00-13:00) are allowed.
function overlaps(windows: z.infer<typeof week>["windows"]): boolean {
  const sorted = [...windows].sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time));
  return sorted.some((w, i) => i > 0 && sorted[i - 1].weekday === w.weekday && w.start_time < sorted[i - 1].end_time);
}

// db() is the server's own database client; the browser can never reach the tables directly.
// The database stores times as "09:00:00", so .slice(0, 5) trims them to "09:00", the PUT format.
async function readWeek() {
  const { data, error } = await db()
    .from("availability_window")
    .select("weekday, start_time, end_time")
    .order("weekday")
    .order("start_time");
  if (error) throw new Error("read_failed");
  return (data ?? []).map((w) => ({
    weekday: w.weekday as number,
    start_time: String(w.start_time).slice(0, 5),
    end_time: String(w.end_time).slice(0, 5),
  }));
}

// Added to the PRD: the Administrator role sets the system's time-slot availability. Times are campus
// time and weekday 0 is Sunday. Requests already made keep their times.
export const GET = route({
  access: ["admin"],
  handler: async () => ({ json: { windows: await readWeek() } }),
});

export const PUT = route({
  access: ["admin"],
  body: week,
  handler: async ({ body }) => {
    // zod checks one window at a time; overlap needs the whole list, so it is checked here instead.
    if (overlaps(body.windows)) throw new HttpError(400, { error: "validation_failed", fields: ["windows"] });
    // rpc() calls a SQL function in the database. set_availability deletes the old week and inserts the
    // new one in a single transaction, so nobody ever sees a half-saved week. Existing bookings stay.
    const { error } = await db().rpc("set_availability", { p_windows: body.windows });
    // A plain Error becomes a content-free 500 in route(); the message is never sent to the caller.
    if (error) throw new Error("update_failed");
    // Read the week back, so the admin screen shows exactly what the database now holds.
    return { json: { windows: await readWeek() } };
  },
});
