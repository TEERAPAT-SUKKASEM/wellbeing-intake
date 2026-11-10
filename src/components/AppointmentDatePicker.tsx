// What this component shows: a strip with one week of dates, plus a "Full calendar" dialog
// with a month grid, for choosing an appointment date.
// Used on: inside SlotSelector, so on the booking page (/request/new)
// and on the practitioner desk (/practitioner) when rescheduling.
// Talks to: no API calls. It tells the parent the chosen date through onChange.
// Note: past dates are disabled. When the dialog closes, focus returns to the "Full calendar" button.
"use client";

import { useRef, useState } from "react";
import { addDays } from "@/lib/client/contracts";
import { UiIcon } from "./UiIcon";

// Weeks start on Monday.
// Dates are plain "YYYY-MM-DD" strings (Bangkok dates). asDate() makes a Date at 12:00 UTC,
// so the day never moves when it is formatted, whatever time zone the computer uses.
// label() formats a date for display. monday() finds the Monday of that week.
// shiftMonth() moves a month forward or back.
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const asDate = (date: string) => new Date(`${date}T12:00:00Z`);
const label = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(asDate(date));
const monday = (date: string) => addDays(date, -((asDate(date).getUTCDay() + 6) % 7));
const shiftMonth = (month: string, by: number) => {
  const date = asDate(month);
  date.setUTCMonth(date.getUTCMonth() + by);
  return date.toISOString().slice(0, 10);
};

export function AppointmentDatePicker({ value, today, onChange }: {
  value: string; today: string; onChange: (date: string) => void;
}) {
  // visibleWeek: the Monday of the week shown in the strip ("" means the week of the chosen date).
  // month: the month shown in the dialog. open: whether the dialog is open (used for aria-expanded).
  // opener is the "Full calendar" button, so focus can go back to it.
  const [visibleWeek, setVisibleWeek] = useState("");
  const [month, setMonth] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // Until "today" is known (the first render), show a loading placeholder.
  if (!value || !today) return <div role="status" className="skeleton h-24" aria-label="Loading appointment dates" />;
  // Work out the 7 days in the strip, and how many cells the month grid needs
  // (whole weeks, from the Monday before the 1st up to the end of the month).
  const week = visibleWeek || monday(value);
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const shownMonth = month || `${value.slice(0, 7)}-01`;
  const gridStart = monday(shownMonth);
  const nextMonth = shiftMonth(shownMonth, 1);
  const count = Math.ceil(((asDate(nextMonth).getTime() - asDate(gridStart).getTime()) / 86400000) / 7) * 7;
  // Choosing a date tells the parent, moves the strip to that week, and closes the dialog.
  function select(date: string) {
    onChange(date);
    setVisibleWeek(monday(date));
    dialog.current?.close();
  }
  // Accessibility: aria-pressed marks the chosen date, and each date button has a full spoken label.
  // Opening the dialog moves focus to the chosen date. onClose sends focus back to the opener.
  // aria-live="polite" reads out the new week, month or date. Clicking the backdrop closes the dialog.
  // "Previous" is disabled when it would only show past dates.
  return <div className="appointment-date-picker">
    <div className="appointment-date-heading"><h3>Appointment date</h3><button ref={opener} type="button" className="btn btn-ghost calendar-opener" aria-haspopup="dialog" aria-expanded={open} aria-controls="appointment-calendar" onClick={() => {
      setMonth(`${value.slice(0, 7)}-01`);
      dialog.current?.showModal();
      setOpen(true);
      dialog.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
    }}><UiIcon name="calendar" />Full calendar</button></div>
    <div className="week-navigation"><button type="button" className="btn btn-ghost btn-square" aria-label="Previous week" disabled={addDays(week, 6) < today || week <= monday(today)} onClick={() => setVisibleWeek(addDays(week, -7))}><UiIcon name="arrow" className="size-5 rotate-180" /></button><p aria-live="polite">{label(week, { day: "numeric", month: "short" })} – {label(addDays(week, 6), { day: "numeric", month: "short", year: "numeric" })}</p><button type="button" className="btn btn-ghost btn-square" aria-label="Next week" onClick={() => setVisibleWeek(addDays(week, 7))}><UiIcon name="arrow" /></button></div>
    <div className="week-date-grid" role="group" aria-label="Dates in this week">{days.map((date, i) => <button key={date} type="button" className="week-date" disabled={date < today} aria-pressed={date === value} aria-label={`${label(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}${date === today ? ", today" : ""}`} onClick={() => select(date)}><span>{DAYS[i]}</span><strong>{asDate(date).getUTCDate()}</strong><span className="week-today">{date === today ? "Today" : ""}</span></button>)}</div>
    <p className="selected-date-label" aria-live="polite">Selected: {label(value, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
    <dialog ref={dialog} id="appointment-calendar" className="modal appointment-calendar" aria-labelledby="appointment-calendar-title" onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }} onClose={() => { setOpen(false); opener.current?.focus(); }}>
      <div className="modal-box calendar-panel"><div className="appointment-date-heading"><h2 id="appointment-calendar-title">Choose appointment date</h2><button type="button" className="btn btn-ghost btn-square" aria-label="Close calendar" onClick={() => dialog.current?.close()}><UiIcon name="close" /></button></div>
        <div className="week-navigation"><button type="button" className="btn btn-ghost btn-square" aria-label="Previous month" disabled={shownMonth <= `${today.slice(0, 7)}-01`} onClick={() => setMonth(shiftMonth(shownMonth, -1))}><UiIcon name="arrow" className="size-5 rotate-180" /></button><p aria-live="polite">{label(shownMonth, { month: "long", year: "numeric" })}</p><button type="button" className="btn btn-ghost btn-square" aria-label="Next month" onClick={() => setMonth(nextMonth)}><UiIcon name="arrow" /></button></div>
        <div className="month-date-grid" role="group" aria-label={label(shownMonth, { month: "long", year: "numeric" })}>{DAYS.map(day => <span key={day} className="calendar-weekday" aria-hidden="true">{day}</span>)}{Array.from({ length: count }, (_, i) => {
          const date = addDays(gridStart, i);
          // Days from the month before or after stay as empty cells, so dates line up under their weekday.
          if (date.slice(0, 7) !== shownMonth.slice(0, 7)) return <span key={date} />;
          return <button key={date} type="button" disabled={date < today} aria-pressed={date === value} aria-current={date === today ? "date" : undefined} aria-label={label(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} onClick={() => select(date)}>{asDate(date).getUTCDate()}</button>;
        })}</div><p className="calendar-help">Dates are in Bangkok time. Select a date to see available appointment times.</p>
      </div>
    </dialog>
  </div>;
}
