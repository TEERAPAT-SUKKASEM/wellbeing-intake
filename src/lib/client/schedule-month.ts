import { addDays } from "./contracts";

export function scheduleMonth(date: string) {
  const start = `${date.slice(0, 7)}-01`;
  const month = new Date(`${start}T12:00:00Z`);
  const count = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
  const offset = (month.getUTCDay() + 6) % 7;
  return {
    start,
    end: addDays(start, count - 1),
    label: month.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }),
    cells: Array.from({ length: Math.ceil((offset + count) / 7) * 7 }, (_, index) => {
      const day = index - offset;
      return day < 0 || day >= count ? null : addDays(start, day);
    }),
  };
}

export function shiftScheduleMonth(date: string, delta: number) {
  const month = new Date(`${date.slice(0, 7)}-01T12:00:00Z`);
  month.setUTCMonth(month.getUTCMonth() + delta);
  return month.toISOString().slice(0, 10);
}
