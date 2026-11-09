"use client";
import { useEffect, useState } from "react";
import { studentApi } from "@/lib/client/booking-preview";
import { campusTime, type Slot } from "@/lib/client/contracts";
import { AppointmentDatePicker } from "./AppointmentDatePicker";
import { useCampusToday } from "@/lib/client/use-campus-today";
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
  const today = useCampusToday();
  const [chosenDate, setDate] = useState(initialDate ?? "");
  const date = chosenDate || today;
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  function changeDate(next: string) {
    if (!next || next === date || next < today) return;
    setDate(next);
    setSlots(null);
    setError(false);
    onChange("");
  }
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
