// What this file does: date maths for the practitioner's Month view: the first and last day of a month,
// how its days sit in a Monday-first grid, and moving to the month before or after.
// Used by: PractitionerMonth (the month grid) and PractitionerDesk (the date range it asks the API for).
// Talks to: no API calls.
// Note: every date here is a campus date string (YYYY-MM-DD in Bangkok, UTC+7). It is already the Bangkok
// date, so nothing adds 7 hours here. The code reads each date at 12:00 UTC (19:00 in Bangkok) and uses
// only the UTC methods, so the viewer's own time zone can never move a date by one day.
import { addDays } from "./contracts";

/** Builds the month that holds "date": its first and last day, its title and its grid cells. */
export function scheduleMonth(date: string) {
  // The 1st of the month: keep "YYYY-MM" and add "-01".
  const start = `${date.slice(0, 7)}-01`;
  const month = new Date(`${start}T12:00:00Z`);
  // Day 0 of the next month is the last day of this month, so this gives the number of days (28 to 31).
  const count = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
  // How many empty cells come before the 1st. getUTCDay() gives Sunday 0 ... Saturday 6;
  // adding 6 and taking % 7 turns that into Monday 0 ... Sunday 6.
  const offset = (month.getUTCDay() + 6) % 7;
  return {
    start,
    // The last day of the month. start to end is at most 31 days, the most the schedule API allows.
    end: addDays(start, count - 1),
    // The title, e.g. "November 2026". It is read in UTC, like "month", so it names the right month.
    label: month.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }),
    // Whole weeks only (4 to 6 rows of 7 cells). A cell is null before the 1st and after the last day.
    cells: Array.from({ length: Math.ceil((offset + count) / 7) * 7 }, (_, index) => {
      const day = index - offset;
      return day < 0 || day >= count ? null : addDays(start, day);
    }),
  };
}

/** Moves "date" by "delta" months (-1 = month before, 1 = month after) and returns the 1st of that month. */
export function shiftScheduleMonth(date: string, delta: number) {
  // Start from the 1st, not from the given day. From 31 March, one month back would be "31 February",
  // which JavaScript turns into early March, so February would be skipped.
  const month = new Date(`${date.slice(0, 7)}-01T12:00:00Z`);
  // setUTCMonth also changes the year when needed: December + 1 is January of the next year.
  month.setUTCMonth(month.getUTCMonth() + delta);
  return month.toISOString().slice(0, 10);
}
