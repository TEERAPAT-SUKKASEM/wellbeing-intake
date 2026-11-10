// What this file does: works out every possible time slot of one service on one day, and marks each
// slot as Available or Unavailable.
// Why it exists: PRD 3.A.3 says every session is followed by a 15-minute privacy buffer, and GET /slots
// (TEST-02) must hide any time that would touch another booking or its buffer.
// Key idea: a slot is free only if the session AND its 15-minute buffer fit inside opening hours and
// do not touch another live request's session or buffer.
//
// A pure function (it uses only its inputs, never the database or the clock) is easy to unit-test,
// so all the slot rules live here and calendar.ts only fetches the data.
//
// The shared calendar's slot rules, as pure functions. Slots are calculated, never stored.
// Each service's slots step by (duration + buffer) from the window's opening time, so a 45-minute
// service gives 10:00-10:45, then 11:00-11:45: the gap between them is the privacy buffer.
// Services with different durations can overlap on the grid, so availability is always decided by
// comparing time ranges, buffer included. The database constraint repeats this rule as the final say.

// The privacy buffer from PRD 3.A.3. The database checks the same 15 minutes on every row.
export const BUFFER_MINUTES = 15;

// Campus time. Thailand has no daylight saving, so the offset is constant.
export const CAMPUS_OFFSET = "+07:00";
const CAMPUS_OFFSET_MS = 7 * 3_600_000;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

// AvailabilityWindow: one block of opening hours on one weekday (0 = Sunday), e.g. 09:00 to 12:00.
// BusyRange: a live request's blocked time, from session start to buffer end, in milliseconds.
// GridSlot: one possible session, start to end. The buffer is not included here.
// Slot: the public shape from the PRD. It says "available or not" and nothing more.
export type AvailabilityWindow = { weekday: number; startTime: string; endTime: string };
export type BusyRange = { start: number; end: number };
export type GridSlot = { start: Date; end: Date };
export type Slot = { slot_start: string; slot_end: string; is_available: boolean };

/** 2026-11-10T03:00:00Z, without milliseconds. */
export const toIso = (value: Date | string): string => new Date(value).toISOString().replace(/\.\d{3}Z$/, "Z");

// True only for a real YYYY-MM-DD date. JavaScript turns 2026-02-31 into March 3, so we parse the
// date and check that it prints back the same.
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** The campus calendar date an instant falls on. */
export const campusDateOf = (instant: Date): string =>
  new Date(instant.getTime() + CAMPUS_OFFSET_MS).toISOString().slice(0, 10);

// Campus midnight to the next campus midnight, as real instants. Used to read one day's bookings.
export function campusDayBounds(date: string): { start: Date; end: Date } {
  const start = new Date(`${date}T00:00:00${CAMPUS_OFFSET}`);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

// A date plus a database time such as "09:00:00" becomes a real instant in campus time.
const atCampusTime = (date: string, time: string) => new Date(`${date}T${time.slice(0, 5)}:00${CAMPUS_OFFSET}`);

/** Every possible slot of one service on one date. A session and its buffer must both fit in the window. */
export function buildGrid(date: string, durationMinutes: number, windows: readonly AvailabilityWindow[]): GridSlot[] {
  // The weekday of the date itself (0 = Sunday), the same numbering as availability_window.weekday.
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const durationMs = durationMinutes * MINUTE_MS;
  // Step = duration + buffer. The next slot starts only when this slot's buffer has ended, so two
  // slots of the same service never sit too close together.
  const stepMs = durationMs + BUFFER_MINUTES * MINUTE_MS;

  const slots: GridSlot[] = [];
  // Only this weekday's opening hours, earliest first, so the slots come out in time order.
  const today = windows.filter((w) => w.weekday === weekday).sort((a, b) => a.startTime.localeCompare(b.startTime));
  for (const window of today) {
    const closes = atCampusTime(date, window.endTime).getTime();
    // Keep adding slots while the session AND its buffer still end by closing time.
    // Example: window 10:00-12:00, 45-minute service: 10:00-10:45 and 11:00-11:45 (buffer to 12:00).
    for (let t = atCampusTime(date, window.startTime).getTime(); t + stepMs <= closes; t += stepMs) {
      // The slot ends when the session ends. The buffer is added back when checking for overlaps.
      slots.push({ start: new Date(t), end: new Date(t + durationMs) });
    }
  }
  return slots;
}

// True only if this start time is one of the slots buildGrid offers for that day. It stops a client
// from booking an odd time such as 10:07 that would leave useless gaps in the calendar.
export function isOnGrid(start: Date, durationMinutes: number, windows: readonly AvailabilityWindow[]): boolean {
  return buildGrid(campusDateOf(start), durationMinutes, windows).some((s) => s.start.getTime() === start.getTime());
}

/** True if a session here, with its buffer, would touch a live request and that request's buffer. */
function overlapsBusy(slot: GridSlot, busy: readonly BusyRange[]): boolean {
  // A new session blocks the calendar from its start until its own buffer ends.
  const blockedEnd = slot.end.getTime() + BUFFER_MINUTES * MINUTE_MS;
  // Two ranges overlap when each one starts before the other ends. Ranges that only touch do not
  // overlap, the same as the database's '[)' range: a slot may start exactly when a buffer ends.
  return busy.some((range) => slot.start.getTime() < range.end && blockedEnd > range.start);
}

// The booking horizon is how far ahead students may book (horizonDays, set in env).
// A slot counts only if it is strictly in the future and no further ahead than that.
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
  // Every grid slot is returned. It is Available only if it is inside the horizon and does not
  // touch any busy range. Past and taken slots both just say "unavailable".
  return buildGrid(date, durationMinutes, windows).map((slot) => ({
    slot_start: toIso(slot.start),
    slot_end: toIso(slot.end),
    is_available: isWithinHorizon(slot.start, now, horizonDays) && !overlapsBusy(slot, busy),
  }));
}
