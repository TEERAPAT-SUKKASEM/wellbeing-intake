// What this test file does: it checks the slot calculator: how a day is cut into bookable times, and
// which times become unavailable around a booking. No database is used.
// Why it matters: it is the unit-level proof of the 15-minute privacy buffer (PRD 3A.3, TEST-02) and of
// showing only "available or not" to the public (PRD 3A.4).
// How to run it: `pnpm test`.
import { describe, expect, it } from "vitest";
import {
  buildGrid,
  campusDateOf,
  isCalendarDate,
  isOnGrid,
  isWithinHorizon,
  slotsForDate,
  toIso,
  type AvailabilityWindow,
} from "@/lib/slots/grid";

// Tuesday 10 November 2026, open 09:00-12:00 campus time.
const DATE = "2026-11-10";
const WINDOWS: AvailabilityWindow[] = [{ weekday: 2, startTime: "09:00", endTime: "12:00" }];
const at = (time: string) => new Date(`${DATE}T${time}:00+07:00`);
const iso = (time: string) => toIso(at(time));
const NOW = new Date("2026-11-01T00:00:00Z");

const slots = (durationMinutes: number, busy: { start: number; end: number }[] = []) =>
  slotsForDate({ date: DATE, durationMinutes, windows: WINDOWS, busy, now: NOW, horizonDays: 30 });

// The day's slot start times: each session is followed by its 15-minute buffer, inside opening hours.
describe("buildGrid", () => {
  it("steps a 45-minute service by session plus buffer, so the gap is the privacy buffer", () => {
    const grid = buildGrid(DATE, 45, WINDOWS);
    expect(grid.map((s) => toIso(s.start))).toEqual([iso("09:00"), iso("10:00"), iso("11:00")]);
    expect(toIso(grid[1].end)).toBe(iso("10:45"));
  });

  it("requires the session and its buffer to fit before closing", () => {
    const grid = buildGrid(DATE, 30, WINDOWS); // 09:00 09:45 10:30 11:15; 11:15-11:45 + buffer ends exactly 12:00
    expect(grid.map((s) => toIso(s.start))).toEqual([iso("09:00"), iso("09:45"), iso("10:30"), iso("11:15")]);
    const tight = buildGrid(DATE, 50, WINDOWS); // 09:00 10:05; 11:10 would end 12:00 with no room for the buffer
    expect(tight.map((s) => toIso(s.start))).toEqual([iso("09:00"), iso("10:05")]);
  });

  it("returns nothing on a closed day", () => {
    expect(buildGrid("2026-11-08", 45, WINDOWS)).toEqual([]); // a Sunday
  });

  it("handles a split day", () => {
    const split = [...WINDOWS, { weekday: 2, startTime: "13:00", endTime: "14:00" }];
    expect(buildGrid(DATE, 45, split).map((s) => toIso(s.start))).toEqual([iso("09:00"), iso("10:00"), iso("11:00"), iso("13:00")]);
  });

  it("accepts the HH:MM:SS format the database returns", () => {
    const fromDb = [{ weekday: 2, startTime: "09:00:00", endTime: "12:00:00" }];
    expect(buildGrid(DATE, 45, fromDb)).toEqual(buildGrid(DATE, 45, WINDOWS));
  });
});

// A booking blocks its own slot, and also any slot whose session or buffer would overlap that booking.
describe("slotsForDate: the 15-minute privacy buffer", () => {
  const booked = { start: at("10:00").getTime(), end: at("11:00").getTime() }; // 10:00-10:45 plus its buffer

  it("blocks the booked slot and leaves its neighbours", () => {
    const result = slots(45, [booked]);
    expect(result.map((s) => s.is_available)).toEqual([true, false, true]);
  });

  it("a session whose own buffer would run into a booking is unavailable too", () => {
    const result = slots(30, [booked]);
    expect(result.find((s) => s.slot_start === iso("09:00"))?.is_available).toBe(true); // buffer ends 09:45
    expect(result.find((s) => s.slot_start === iso("09:45"))?.is_available).toBe(false); // buffer ends 10:30
    expect(result.find((s) => s.slot_start === iso("10:30"))?.is_available).toBe(false); // inside
    expect(result.find((s) => s.slot_start === iso("11:15"))?.is_available).toBe(true);
  });

  it("touching exactly at the edge is not an overlap", () => {
    const beforeNine = { start: at("08:00").getTime(), end: at("09:00").getTime() };
    expect(slots(45, [beforeNine])[0].is_available).toBe(true);
  });

  it("reports only time and availability", () => {
    expect(Object.keys(slots(45)[0]).sort()).toEqual(["is_available", "slot_end", "slot_start"]);
  });

  it("shows past times and times beyond the horizon as unavailable", () => {
    const after = slotsForDate({ date: DATE, durationMinutes: 45, windows: WINDOWS, busy: [], now: at("10:30"), horizonDays: 30 });
    expect(after.map((s) => s.is_available)).toEqual([false, false, true]);
    const tooFar = slotsForDate({ date: DATE, durationMinutes: 45, windows: WINDOWS, busy: [], now: new Date("2026-01-01T00:00:00Z"), horizonDays: 30 });
    expect(tooFar.every((s) => !s.is_available)).toBe(true);
  });
});

// Small date and time helpers. Dates follow campus time (UTC+7), not UTC.
describe("helpers", () => {
  it("isOnGrid accepts only real slot starts", () => {
    expect(isOnGrid(at("10:00"), 45, WINDOWS)).toBe(true);
    expect(isOnGrid(at("10:15"), 45, WINDOWS)).toBe(false);
    expect(isOnGrid(at("10:45"), 45, WINDOWS)).toBe(false); // the buffer itself
    expect(isOnGrid(at("09:45"), 30, WINDOWS)).toBe(true);
  });

  it("isOnGrid follows campus dates, not UTC ones", () => {
    // Monday 23:30 campus time is 16:30 UTC; 00:30 Tuesday campus time is still Monday in UTC.
    const windows = [{ weekday: 2, startTime: "00:30", endTime: "02:00" }];
    expect(isOnGrid(new Date("2026-11-09T17:30:00Z"), 45, windows)).toBe(true);
  });

  it("campusDateOf rolls over at campus midnight", () => {
    expect(campusDateOf(new Date("2026-11-09T16:59:00Z"))).toBe("2026-11-09");
    expect(campusDateOf(new Date("2026-11-09T17:00:00Z"))).toBe("2026-11-10");
  });

  it("isCalendarDate refuses impossible dates", () => {
    expect(isCalendarDate("2026-11-10")).toBe(true);
    expect(isCalendarDate("2026-02-31")).toBe(false);
    expect(isCalendarDate("10/11/2026")).toBe(false);
    expect(isCalendarDate("")).toBe(false);
  });

  it("isWithinHorizon needs the future and the horizon", () => {
    expect(isWithinHorizon(at("10:00"), at("09:00"), 1)).toBe(true);
    expect(isWithinHorizon(at("08:00"), at("09:00"), 1)).toBe(false);
    expect(isWithinHorizon(new Date("2027-01-01T00:00:00Z"), at("09:00"), 1)).toBe(false);
  });

  it("toIso drops milliseconds", () => {
    expect(toIso("2026-11-10T03:00:00.000+00:00")).toBe("2026-11-10T03:00:00Z");
  });
});
