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

export type ServiceRow = {
  id: string;
  name: string;
  description: string;
  duration_minutes: number;
  is_active: boolean;
};

export const SERVICE_COLUMNS = "id, name, description, duration_minutes, is_active";

export async function readActiveService(id: string): Promise<ServiceRow | null> {
  const { data, error } = await db().from("service").select(SERVICE_COLUMNS).eq("id", id).eq("is_active", true).maybeSingle();
  if (error) throw new Error("read_failed");
  return data as ServiceRow | null;
}

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

export async function listSlots(service: Pick<ServiceRow, "duration_minutes">, date: string): Promise<Slot[]> {
  const { start, end } = campusDayBounds(date);
  // Generous enough to catch any session and buffer that crosses midnight (at most 135 minutes).
  const margin = 3 * 3_600_000;
  const [windows, busy] = await Promise.all([
    readWindows(),
    readBusy(new Date(start.getTime() - margin), new Date(end.getTime() + margin)),
  ]);
  return slotsForDate({
    date,
    durationMinutes: service.duration_minutes,
    windows,
    busy,
    now: new Date(),
    horizonDays: env.bookingHorizonDays,
  });
}

export type SlotCheck = "ok" | "off_grid" | "out_of_range";

/** A time must be a real slot of this service, in the future and inside the booking horizon. */
export async function checkRequestedSlot(service: Pick<ServiceRow, "duration_minutes">, start: Date): Promise<SlotCheck> {
  const windows = await readWindows();
  if (!isOnGrid(start, service.duration_minutes, windows)) return "off_grid";
  return isWithinHorizon(start, new Date(), env.bookingHorizonDays) ? "ok" : "out_of_range";
}
