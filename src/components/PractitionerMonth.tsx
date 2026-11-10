"use client";

import { campusDate, type AppointmentRequest } from "@/lib/client/contracts";
import { scheduleMonth, shiftScheduleMonth } from "@/lib/client/schedule-month";

export function PractitionerMonth({ date, today, schedule, busy, onSelect }: {
  date: string;
  today: string;
  schedule: AppointmentRequest[];
  busy: boolean;
  onSelect: (date: string) => void;
}) {
  const month = scheduleMonth(date);
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
      <h3 id="schedule-month-title" aria-live="polite">{month.label}</h3>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn" disabled={busy} aria-label="Previous month" onClick={() => onSelect(shiftScheduleMonth(date, -1))}>Previous</button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onSelect(today)}>Today</button>
        <button type="button" className="btn" disabled={busy} aria-label="Next month" onClick={() => onSelect(shiftScheduleMonth(date, 1))}>Next</button>
      </div>
    </div>
    <p className="schedule-month-help">Select a day to see appointments and their privacy buffers below.</p>
    <div className="schedule-month-grid" role="group" aria-labelledby="schedule-month-title">
      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(day => <span key={day} className="schedule-month-weekday" aria-hidden="true">{day}</span>)}
      {month.cells.map((day, index) => {
        if (!day) return <span key={`blank-${index}`} className="schedule-month-blank" aria-hidden="true" />;
        const count = counts.get(day);
        const total = count?.total ?? 0;
        const label = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
        return <button key={day} type="button" className="schedule-month-day" disabled={busy} aria-pressed={day === date} aria-current={day === today ? "date" : undefined} aria-label={`${label}${day === today ? ", today" : ""}, ${total} ${total === 1 ? "appointment" : "appointments"}${count?.pending ? `, ${count.pending} pending` : ""}`} onClick={() => onSelect(day)}>
          <span className="schedule-month-date">{Number(day.slice(-2))}{day === today && <span className="schedule-month-today">Today</span>}</span>
          {total > 0 && <span className="schedule-month-count">{total}<span className="schedule-month-count-label"> {total === 1 ? "visit" : "visits"}</span></span>}
          {!!count?.pending && <span className="schedule-month-pending">{count.pending} pending</span>}
        </button>;
      })}
    </div>
  </div>;
}
