// What this component shows: the Month view of the practitioner's schedule. It is a Monday-first grid
// of one month, where each day is a button with its number of sessions and how many are still pending.
// Used on: /practitioner, at the top of the Schedule tab of PractitionerDesk when the view is "Month".
// Talks to: no API calls. PractitionerDesk loads the whole month's sessions and passes them in as "schedule".
// Note: a day button, Previous, Today and Next all call onSelect(date). The desk then lists that day's
// sessions and privacy buffers under this grid. The desk loads data again only when the month changes.
"use client";

import { campusDate, type AppointmentRequest } from "@/lib/client/contracts";
import { scheduleMonth, shiftScheduleMonth } from "@/lib/client/schedule-month";

// date: the selected day (YYYY-MM-DD). today: today's date in Bangkok.
// busy: a decision is being saved, so every button is disabled.
export function PractitionerMonth({ date, today, schedule, busy, onSelect }: {
  date: string;
  today: string;
  schedule: AppointmentRequest[];
  busy: boolean;
  onSelect: (date: string) => void;
}) {
  // The month that holds "date": its first and last day, its title and its grid cells.
  const month = scheduleMonth(date);
  // Count the sessions on each Bangkok date (campusDate() turns the UTC start time into the campus date).
  // total: every session that day. The schedule API sends only PENDING and CONFIRMED ones, so cancelled
  // and rejected requests are never counted. pending: the sessions still waiting for a decision.
  const counts = new Map<string, { total: number; pending: number }>();
  for (const row of schedule) {
    const key = campusDate(new Date(row.requested_slot_start));
    const count = counts.get(key) ?? { total: 0, pending: 0 };
    count.total++;
    if (row.status === "PENDING") count.pending++;
    counts.set(key, count);
  }
  return <div className="practitioner-month">
    <div className="schedule-month-toolbar">
      {/* The month title, e.g. "November 2026". aria-live reads out the new month when it changes. */}
      <h3 id="schedule-month-title" aria-live="polite">{month.label}</h3>
      {/* Previous and Next select the 1st of the month before or after. Today selects today's date. */}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn" disabled={busy} aria-label="Previous month" onClick={() => onSelect(shiftScheduleMonth(date, -1))}>Previous</button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onSelect(today)}>Today</button>
        <button type="button" className="btn" disabled={busy} aria-label="Next month" onClick={() => onSelect(shiftScheduleMonth(date, 1))}>Next</button>
      </div>
    </div>
    <p className="schedule-month-help">Select a day to see appointments and their privacy buffers below.</p>
    {/* The grid has 7 columns (CSS). First a row of weekday names, then one cell per entry in */}
    {/* month.cells, row by row. The weekday names are hidden from screen readers because */}
    {/* each day button already says its full date. */}
    <div className="schedule-month-grid" role="group" aria-labelledby="schedule-month-title">
      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(day => <span key={day} className="schedule-month-weekday" aria-hidden="true">{day}</span>)}
      {month.cells.map((day, index) => {
        // null = an empty cell before the 1st or after the last day of the month.
        if (!day) return <span key={`blank-${index}`} className="schedule-month-blank" aria-hidden="true" />;
        // This day's counts. A day with no sessions is not in the map, so it counts as 0.
        const count = counts.get(day);
        const total = count?.total ?? 0;
        // The full date, e.g. "Tuesday 10 November 2026". "day" is already a Bangkok date, so it is read
        // at 12:00 in UTC (not Bangkok) to keep the same date.
        const label = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
        // aria-pressed marks the selected day and aria-current marks today. The spoken name (aria-label)
        // says the date, "today" (only on today), the number of appointments and, if any, how many are pending.
        // On small screens CSS hides the word "visits" and the pending count, so this label keeps the full details.
        return <button key={day} type="button" className="schedule-month-day" disabled={busy} aria-pressed={day === date} aria-current={day === today ? "date" : undefined} aria-label={`${label}${day === today ? ", today" : ""}, ${total} ${total === 1 ? "appointment" : "appointments"}${count?.pending ? `, ${count.pending} pending` : ""}`} onClick={() => onSelect(day)}>
          {/* Visible text: the day number (without a leading 0), a "Today" tag, the number of visits */}
          {/* (only above 0) and the number pending (only above 0). */}
          <span className="schedule-month-date">{Number(day.slice(-2))}{day === today && <span className="schedule-month-today">Today</span>}</span>
          {total > 0 && <span className="schedule-month-count">{total}<span className="schedule-month-count-label"> {total === 1 ? "visit" : "visits"}</span></span>}
          {!!count?.pending && <span className="schedule-month-pending">{count.pending} pending</span>}
        </button>;
      })}
    </div>
  </div>;
}
