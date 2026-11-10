// What this component shows: a date picker and a grid of time slots for one service.
// Each slot is marked Available, Unavailable or Selected.
// Used on: the booking page (/request/new, inside RequestForm) and the practitioner desk
// (/practitioner, when choosing a replacement time to reschedule).
// Talks to: GET /api/v1/slots?service_id=...&date=YYYY-MM-DD. Preview mode uses fictional slots instead.
// Note: the server decides which slots are free, including the 15-minute privacy buffer after each
// session. This component does not calculate booking rules; it only shows what the server returns.
"use client";
import { useEffect, useState } from "react";
import { studentApi } from "@/lib/client/booking-preview";
import { campusTime, type Slot } from "@/lib/client/contracts";
import { AppointmentDatePicker } from "./AppointmentDatePicker";
import { useCampusToday } from "@/lib/client/use-campus-today";
// Props: value is the chosen slot start time (or ""). onChange tells the parent about a new choice.
// refresh is a counter from the parent: when it changes, the slots are loaded again.
export function SlotSelector({
  serviceId,
  value,
  onChange,
  preview = false,
  initialDate,
  refresh = 0,
}: {
  serviceId: string;
  value: string;
  onChange: (value: string) => void;
  preview?: boolean;
  initialDate?: string;
  refresh?: number;
}) {
  // today is the current date in Bangkok (UTC+7). It is "" during the first render
  // and is filled in once the page runs in the browser.
  const today = useCampusToday();
  // chosenDate is "" until the user picks a date, so the date shown falls back to today.
  const [chosenDate, setDate] = useState(initialDate ?? "");
  const date = chosenDate || today;
  // slots is null while loading. error is true when loading failed.
  // retry is a counter that the "Retry loading times" button increases.
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  // Ignore an empty date, the same date, or a date in the past.
  // A new date clears the old slots and the chosen time, because that time belonged to the old date.
  function changeDate(next: string) {
    if (!next || next === date || next < today) return;
    setDate(next);
    setSlots(null);
    setError(false);
    onChange("");
  }
  // Load the slots when the service, date, retry counter or parent "refresh" changes.
  // RequestForm increases "refresh" after a 409 slot_unavailable error, so the grid shows fresh data.
  // "alive" becomes false on cleanup, so a late answer for an older date is ignored.
  useEffect(() => {
    if (!date) return;
    let alive = true;
    studentApi(preview)<Slot[]>(
      `/slots?service_id=${encodeURIComponent(serviceId)}&date=${date}`,
    ).then((r) => {
      if (alive) {
        setError(!r.ok);
        setSlots(r.ok ? (r.data ?? []) : null);
      }
    });
    return () => {
      alive = false;
    };
  }, [serviceId, date, preview, retry, refresh]);
  // Each slot is a radio button inside a <fieldset>, so keyboard and screen reader users can choose it.
  // Times are shown in Bangkok time with campusTime(). Unavailable slots are disabled radios.
  // Students only see "Available" or "Unavailable": never who booked or how many bookings exist.
  // An empty list means the centre is closed that day.
  return (
    <section className="space-y-4" aria-label="Choose appointment time">
      <AppointmentDatePicker value={date} today={today} onChange={changeDate} />
      <p className="text-sm text-base-content/70">
        All times are Bangkok (UTC+7). Each session includes a 15-minute privacy buffer afterwards.
      </p>
      {error ? (
        <div role="alert">
          <p>We could not load times for this date.</p>
          <button
            type="button"
            className="btn mt-3"
            onClick={() => {
              setError(false);
              setRetry((n) => n + 1);
            }}
          >
            Retry loading times
          </button>
        </div>
      ) : !slots ? (
        <div
          role="status"
          aria-label="Loading available times"
          className="skeleton h-24 w-full"
        />
      ) : slots.length === 0 ? (
        <p role="status">
          The centre is closed on this date. Choose another date.
        </p>
      ) : (
        <fieldset>
          <legend className="mb-3 font-medium">Choose an available time</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {slots.map((slot) => (
              <label
                key={slot.slot_start}
                className={`slot-option flex min-h-16 items-center gap-3 rounded-field border p-3 ${value === slot.slot_start ? "slot-selected border-primary bg-secondary" : "bg-base-100"} ${slot.is_available ? "cursor-pointer" : "slot-unavailable"}`}
              >
                <input
                  className="radio radio-sm shrink-0"
                  type="radio"
                  name={`slot-${serviceId}`}
                  required
                  disabled={!slot.is_available}
                  checked={value === slot.slot_start}
                  onChange={() => onChange(slot.slot_start)}
                />
                <span>
                  <span className="block text-sm tabular-nums">
                    {campusTime(slot.slot_start)}–{campusTime(slot.slot_end)}
                  </span>
                  <span className="text-xs">
                    {value === slot.slot_start ? "Selected" : slot.is_available ? "Available" : "Unavailable"}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {!slots.some((s) => s.is_available) && (
            <p role="status" className="mt-3">
              No times are available on this date. Try another date.
            </p>
          )}
        </fieldset>
      )}
    </section>
  );
}
