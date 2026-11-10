// What this file does: reads services, opening hours and live bookings from the database, and hands
// them to the pure slot rules in grid.ts.
// Why it exists: GET /slots, POST /requests and the practitioner's Reschedule all need real data, but
// the rules stay in grid.ts so they can be tested without a database.
// Key idea: only the times of live requests (PENDING or CONFIRMED) are read, never who booked or why.
//
// "server-only" makes the build fail if browser code ever imports this file.
import "server-only";
import { env } from "@/lib/env";
import { db } from "@/lib/supabase/admin";
import {
  campusDayBounds,
  isOnGrid,
  isWithinHorizon,
  slotsForDate,
  type AvailabilityWindow,
  type Slot,
} from "@/lib/slots/grid";

// One row of the service table.
export type ServiceRow = {
  id: string;
  name: string;
  description: string;
  duration_minutes: number;
  is_active: boolean;
};

// The columns are named one by one (not "*"), so only these fields are ever read and returned.
export const SERVICE_COLUMNS = "id, name, description, duration_minutes, is_active";

// An inactive (hidden) service is treated as missing, so it cannot be booked.
// db() is the server's Supabase client, which uses the secret service-role key.
export async function readActiveService(id: string): Promise<ServiceRow | null> {
  const { data, error } = await db().from("service").select(SERVICE_COLUMNS).eq("id", id).eq("is_active", true).maybeSingle();
  if (error) throw new Error("read_failed");
  return data as ServiceRow | null;
}

// The weekly opening hours, renamed from database column names to the names grid.ts uses.
export async function readWindows(): Promise<AvailabilityWindow[]> {
  const { data, error } = await db().from("availability_window").select("weekday, start_time, end_time");
  if (error) throw new Error("read_failed");
  return (data ?? []).map((w) => ({
    weekday: w.weekday as number,
    startTime: w.start_time as string,
    endTime: w.end_time as string,
  }));
}

/** Only the times of live requests are read: who, why and which service are irrelevant here. */
async function readBusy(from: Date, to: Date) {
  // Live requests only: CANCELLED and REJECTED rows no longer hold any time.
  // A row overlaps [from, to) when it starts before "to" and its buffer ends after "from".
  const { data, error } = await db()
    .from("appointment_request")
    .select("slot_start, buffer_end")
    .in("status", ["PENDING", "CONFIRMED"])
    .lt("slot_start", to.toISOString())
    .gt("buffer_end", from.toISOString());
  if (error) throw new Error("read_failed");
  return (data ?? []).map((r) => ({
    start: new Date(r.slot_start as string).getTime(),
    end: new Date(r.buffer_end as string).getTime(),
  }));
}

// The slot list for GET /slots: every slot of this service on this date, available or not.
export async function listSlots(service: Pick<ServiceRow, "duration_minutes">, date: string): Promise<Slot[]> {
  const { start, end } = campusDayBounds(date);
  // Generous enough to catch any session and buffer that crosses midnight (at most 135 minutes).
  const margin = 3 * 3_600_000;
  // Both reads run at the same time to save a round trip to the database.
  const [windows, busy] = await Promise.all([
    readWindows(),
    readBusy(new Date(start.getTime() - margin), new Date(end.getTime() + margin)),
  ]);
  // "now" is the server clock, never a time sent by the browser.
  return slotsForDate({
    date,
    durationMinutes: service.duration_minutes,
    windows,
    busy,
    now: new Date(),
    horizonDays: env.bookingHorizonDays,
  });
}

// off_grid: not a real slot time of this service (the routes answer 400).
// out_of_range: a real slot, but in the past or beyond the booking horizon (the routes answer 409).
export type SlotCheck = "ok" | "off_grid" | "out_of_range";

/** A time must be a real slot of this service, in the future and inside the booking horizon. */
export async function checkRequestedSlot(service: Pick<ServiceRow, "duration_minutes">, start: Date): Promise<SlotCheck> {
  // This does not check for overlaps. The database constraint does that when the row is saved, so
  // two students racing for the same slot cannot both win.
  const windows = await readWindows();
  if (!isOnGrid(start, service.duration_minutes, windows)) return "off_grid";
  return isWithinHorizon(start, new Date(), env.bookingHorizonDays) ? "ok" : "out_of_range";
}
