import { z } from "zod";
import { HttpError, route } from "@/lib/http";
import { db } from "@/lib/supabase/admin";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

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

function overlaps(windows: z.infer<typeof week>["windows"]): boolean {
  const sorted = [...windows].sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time));
  return sorted.some((w, i) => i > 0 && sorted[i - 1].weekday === w.weekday && w.start_time < sorted[i - 1].end_time);
}

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
    if (overlaps(body.windows)) throw new HttpError(400, { error: "validation_failed", fields: ["windows"] });
    const { error } = await db().rpc("set_availability", { p_windows: body.windows });
    if (error) throw new Error("update_failed");
    return { json: { windows: await readWeek() } };
  },
});
