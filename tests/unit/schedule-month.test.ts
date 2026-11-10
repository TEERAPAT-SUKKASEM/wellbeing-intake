import { describe, expect, it } from "vitest";
import { scheduleMonth, shiftScheduleMonth } from "../../src/lib/client/schedule-month";

describe("practitioner schedule month", () => {
  it("includes every leap-year day in a Monday-first calendar", () => {
    const month = scheduleMonth("2028-02-29");
    expect(month.start).toBe("2028-02-01");
    expect(month.end).toBe("2028-02-29");
    expect(month.cells[0]).toBeNull();
    expect(month.cells[1]).toBe("2028-02-01");
    expect(month.cells.filter(Boolean)).toHaveLength(29);
    expect(month.cells.length % 7).toBe(0);
  });
  it("fits a six-week month without exceeding the API's 31-day range", () => {
    const month = scheduleMonth("2026-11-10");
    expect(month.cells).toHaveLength(42);
    expect(month.cells[6]).toBe("2026-11-01");
    expect(month.start).toBe("2026-11-01");
    expect(month.end).toBe("2026-11-30");
  });
  it("navigates from month-end across year boundaries without skipping a month", () => {
    expect(shiftScheduleMonth("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftScheduleMonth("2027-01-31", -1)).toBe("2026-12-01");
    expect(shiftScheduleMonth("2026-03-31", -1)).toBe("2026-02-01");
  });
});
