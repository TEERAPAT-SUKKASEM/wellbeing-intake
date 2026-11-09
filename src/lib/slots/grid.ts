// The shared calendar's slot rules, as pure functions. Slots are calculated, never stored.
// Each service's slots step by (duration + buffer) from the window's opening time, so a 45-minute
// service gives 10:00-10:45, then 11:00-11:45: the gap between them is the privacy buffer.
// Services with different durations can overlap on the grid, so availability is always decided by
// comparing time ranges, buffer included. The database constraint repeats this rule as the final say.

export const BUFFER_MINUTES = 15;

// Campus time. Thailand has no daylight saving, so the offset is constant.
export const CAMPUS_OFFSET = "+07:00";
const CAMPUS_OFFSET_MS = 7 * 3_600_000;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export type AvailabilityWindow = { weekday: number; startTime: string; endTime: string };
export type BusyRange = { start: number; end: number };
export type GridSlot = { start: Date; end: Date };
export type Slot = { slot_start: string; slot_end: string; is_available: boolean };

/** 2026-11-10T03:00:00Z, without milliseconds. */
export const toIso = (value: Date | string): string => new Date(value).toISOString().replace(/\.\d{3}Z$/, "Z");

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** The campus calendar date an instant falls on. */
export const campusDateOf = (instant: Date): string =>
  new Date(instant.getTime() + CAMPUS_OFFSET_MS).toISOString().slice(0, 10);

export function campusDayBounds(date: string): { start: Date; end: Date } {
  const start = new Date(`${date}T00:00:00${CAMPUS_OFFSET}`);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

const atCampusTime = (date: string, time: string) => new Date(`${date}T${time.slice(0, 5)}:00${CAMPUS_OFFSET}`);

/** Every possible slot of one service on one date. A session and its buffer must both fit in the window. */
export function buildGrid(date: string, durationMinutes: number, windows: readonly AvailabilityWindow[]): GridSlot[] {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const durationMs = durationMinutes * MINUTE_MS;
  const stepMs = durationMs + BUFFER_MINUTES * MINUTE_MS;

  const slots: GridSlot[] = [];
  const today = windows.filter((w) => w.weekday === weekday).sort((a, b) => a.startTime.localeCompare(b.startTime));
  for (const window of today) {
    const closes = atCampusTime(date, window.endTime).getTime();
    for (let t = atCampusTime(date, window.startTime).getTime(); t + stepMs <= closes; t += stepMs) {
      slots.push({ start: new Date(t), end: new Date(t + durationMs) });
    }
  }
  return slots;
}

export function isOnGrid(start: Date, durationMinutes: number, windows: readonly AvailabilityWindow[]): boolean {
  return buildGrid(campusDateOf(start), durationMinutes, windows).some((s) => s.start.getTime() === start.getTime());
}

/** True if a session here, with its buffer, would touch a live request and that request's buffer. */
function overlapsBusy(slot: GridSlot, busy: readonly BusyRange[]): boolean {
  const blockedEnd = slot.end.getTime() + BUFFER_MINUTES * MINUTE_MS;
  return busy.some((range) => slot.start.getTime() < range.end && blockedEnd > range.start);
}

export function isWithinHorizon(start: Date, now: Date, horizonDays: number): boolean {
  return start.getTime() > now.getTime() && start.getTime() <= now.getTime() + horizonDays * DAY_MS;
}

/** Available or unavailable, and nothing more: the reason a slot is taken is never revealed. */
export function slotsForDate(input: {
  date: string;
  durationMinutes: number;
  windows: readonly AvailabilityWindow[];
  busy: readonly BusyRange[];
  now: Date;
  horizonDays: number;
}): Slot[] {
  const { date, durationMinutes, windows, busy, now, horizonDays } = input;
  return buildGrid(date, durationMinutes, windows).map((slot) => ({
    slot_start: toIso(slot.start),
    slot_end: toIso(slot.end),
    is_available: isWithinHorizon(slot.start, now, horizonDays) && !overlapsBusy(slot, busy),
  }));
}
