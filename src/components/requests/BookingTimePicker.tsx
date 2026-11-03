"use client";

import { useId, useState } from "react";
import type { BookingSlot } from "./types";
import { bookingDateLabel as dateLabel, bookingTimeLabel as timeLabel } from "@/lib/client/booking-dates";

const dateKey = (value: string) => new Date(value).toLocaleDateString("en-CA");

export function BookingTimePicker({ slots, busy, onConfirm }: { slots: BookingSlot[]; busy: boolean; onConfirm: (slotId: string) => void }) {
  const hintId = useId();
  const [day, setDay] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const ordered = [...slots].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  const days = [...new Map(ordered.map(slot => [dateKey(slot.startAt), slot])).values()];
  const activeDay = days.find(slot => dateKey(slot.startAt) === day) ?? days[0];
  const selected = slots.find(slot => slot.id === selectedId && dateKey(slot.startAt) === dateKey(activeDay?.startAt ?? ""));
  const available = activeDay ? ordered.filter(slot => dateKey(slot.startAt) === dateKey(activeDay.startAt)) : [];
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  if (!slots.length) return <p role="status" className="rounded-field bg-base-200 p-4 text-sm">No appointments are available right now. Please check back later.</p>;
  return <div className="space-y-5">
    <div><h3 className="font-semibold">Choose a date and time</h3><p className="mt-1 text-sm text-base-content/70">Times are shown in {timezone}. Select a start time, then confirm.</p></div>
    <div role="group" aria-label="Available dates" className="flex max-w-full gap-2 overflow-x-auto pb-2">
      {days.map(slot => <button key={dateKey(slot.startAt)} type="button" disabled={busy} aria-pressed={activeDay.id === slot.id} className={`btn h-auto shrink-0 whitespace-normal py-3 ${activeDay.id === slot.id ? "btn-neutral" : ""}`} onClick={() => { setDay(dateKey(slot.startAt)); setSelectedId(""); }}>{new Date(slot.startAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</button>)}
    </div>
    <fieldset className="fieldset min-w-0 text-base" aria-describedby={hintId} disabled={busy}>
      <legend className="fieldset-legend whitespace-normal">{dateLabel(activeDay.startAt)}</legend>
      <p id={hintId} className="text-sm text-base-content/70">Choose one available start time.</p>
      <div className="mt-3 grid gap-5 sm:grid-cols-2">
        {[{ label: "Morning", morning: true }, { label: "Afternoon & evening", morning: false }].map(group => {
          const groupSlots = available.filter(slot => (new Date(slot.startAt).getHours() < 12) === group.morning);
          return groupSlots.length ? <div key={group.label} role="group" aria-label={group.label}><p className="mb-2 text-sm font-medium">{group.label}</p><div className="grid grid-cols-2 gap-3">{groupSlots.map(slot => <label key={slot.id} className="time-choice flex cursor-pointer items-center justify-between gap-2 rounded-field border border-base-300 p-3"><span className="font-semibold tabular-nums">{timeLabel(slot.startAt)}</span><input className="radio radio-sm shrink-0" type="radio" name={hintId} aria-label={timeLabel(slot.startAt)} checked={selectedId === slot.id} onChange={() => setSelectedId(slot.id)} /></label>)}</div></div> : null;
        })}
      </div>
    </fieldset>
    <div className="rounded-field border border-base-300 bg-base-200 p-4" role="status" aria-live="polite" aria-atomic="true">{selected ? <><p className="text-sm text-base-content/70">Your selection</p><p className="mt-1 font-semibold">{dateLabel(selected.startAt)}</p><p className="mt-1 text-lg tabular-nums">{timeLabel(selected.startAt)}</p><p className="mt-2 text-sm text-base-content/70">Not booked yet. Confirm your appointment below.</p></> : <p className="text-sm text-base-content/70">No time selected. Choose a start time to continue.</p>}</div>
    <button type="button" className="booking-confirm btn btn-primary w-full sm:w-auto" disabled={!selected || busy} aria-busy={busy} onClick={() => selected && onConfirm(selected.id)}>{busy && <span aria-hidden="true" className="loading loading-spinner loading-sm" />}<span>{busy ? "Booking your appointment…" : selected ? `Book ${timeLabel(selected.startAt)} appointment` : "Choose a time to continue"}</span></button>
  </div>;
}
