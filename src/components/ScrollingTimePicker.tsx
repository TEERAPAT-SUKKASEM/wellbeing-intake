// What this component shows: a button with a time such as 09:30. It opens a dialog with two
// scrolling wheels (hour and minute) to change that time.
// Used on: the admin page (/admin), for the "Opens" and "Closes" time of each opening window.
// Talks to: no API calls. It tells the parent the new "HH:MM" value through onChange.
// Note: each wheel works with the keyboard as an ARIA spinbutton:
// Arrow Up/Down, Page Up/Down, Home and End change the value.
"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { UiIcon } from "./UiIcon";

// The values the wheels can show: 00-23 for hours and 00-59 for minutes (24-hour clock).
const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const minutes = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

// One scrolling column of values. Every row is 44px tall, so "row number x 44" is its scroll position.
function TimeWheel({ label, values, value, onChange }: { label: string; values: string[]; value: string; onChange: (value: string) => void }) {
  // initial: the start value, used once to scroll to it. selected: the row shown now.
  // change: always the latest onChange. Refs are used so the wheel listener below sees fresh values.
  const scroll = useRef<HTMLDivElement>(null);
  const initial = useRef(Number(value));
  const selected = useRef(Number(value));
  const change = useRef(onChange);
  useLayoutEffect(() => { change.current = onChange; }, [onChange]);
  // Before the first paint, scroll so the current value sits in the middle line.
  useLayoutEffect(() => {
    if (scroll.current) scroll.current.scrollTop = initial.current * 44;
  }, []);
  // Mouse wheel: move exactly one row per step instead of free scrolling.
  // The listener is added by hand with passive: false, so preventDefault() can stop the page from scrolling.
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    let accumulated = 0;
    let lastWheel = 0;
    function wheel(event: WheelEvent) {
      // Leave Ctrl+wheel (zoom) and sideways scrolling to the browser.
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY) || !event.deltaY) return;
      event.preventDefault();
      event.stopPropagation();
      // Add up small trackpad movements. Start again after a short pause or a change of direction.
      // deltaMode 1 means lines and 2 means pages, so convert them to pixels first.
      // Move one row only when the total reaches 40px.
      const now = performance.now();
      if (now - lastWheel > 180 || Math.sign(accumulated) !== Math.sign(event.deltaY)) accumulated = 0;
      lastWheel = now;
      const delta = event.deltaMode === 1 ? event.deltaY * 40 : event.deltaMode === 2 ? event.deltaY * 220 : event.deltaY;
      accumulated += delta;
      if (Math.abs(accumulated) < 40) return;
      const next = Math.max(0, Math.min(values.length - 1, selected.current + Math.sign(accumulated)));
      accumulated = 0;
      selected.current = next;
      element!.scrollTo({ top: next * 44, behavior: "instant" });
      change.current(values[next]);
    }
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [values]);
  // Select a row by its index (kept inside the list), scroll to it and report the new value.
  function choose(index: number) {
    const next = Math.max(0, Math.min(values.length - 1, index));
    selected.current = next;
    scroll.current?.scrollTo({ top: next * 44, behavior: "instant" });
    onChange(values[next]);
  }
  // onScroll handles touch and scrollbar scrolling: the row nearest the middle becomes the value.
  // onKeyDown gives keyboard control. The rows are aria-hidden; screen readers hear the spinbutton's
  // aria-valuetext instead. Clicking a row selects it.
  return <div className="time-wheel-frame"><div ref={scroll} className="time-wheel" role="spinbutton" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={values.length - 1} aria-valuenow={Number(value)} aria-valuetext={value} onScroll={event => {
    const index = Math.max(0, Math.min(values.length - 1, Math.round(event.currentTarget.scrollTop / 44)));
    if (index !== selected.current) { selected.current = index; onChange(values[index]); }
  }} onKeyDown={event => {
    const moves: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 };
    if (event.key in moves || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      choose(event.key === "Home" ? 0 : event.key === "End" ? values.length - 1 : Number(value) + moves[event.key]);
    }
  }}>{values.map((time, index) => <div key={time} className="time-wheel-option" data-selected={time === value} aria-hidden="true" onClick={() => { scroll.current?.focus({ preventScroll: true }); choose(index); }}>{time}</div>)}</div></div>;
}

export function ScrollingTimePicker({ label, value, onChange }: {
  label: string; value: string; onChange: (value: string) => void;
}) {
  // useId gives a unique id, because the admin page shows many pickers at once.
  // trigger is the button that opens the dialog, so focus can go back to it.
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // value is "HH:MM". Split it so each wheel changes only its own part.
  const hour = value.slice(0, 2);
  const minute = value.slice(3, 5);
  // The wheels are only rendered while the dialog is open, so they start at the current value each time.
  // Clicking the backdrop closes the dialog. On close, focus returns to the button that opened it.
  return <div className="scrolling-time-picker">
    <label htmlFor={id} className="mb-2 block text-sm">{label}</label>
    <button ref={trigger} id={id} type="button" className="input time-picker-trigger" aria-haspopup="dialog" aria-label={`${label}: ${value}`} onClick={() => { dialog.current?.showModal(); setOpen(true); }}><span>{value}</span><UiIcon name="arrow" className="size-4 rotate-90" /></button>
    <dialog ref={dialog} className="modal time-picker-dialog" aria-labelledby={`${id}-title`} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }} onClose={() => { setOpen(false); trigger.current?.focus({ preventScroll: true }); }}>
      <div className="modal-box time-picker-panel">
        <div className="appointment-date-heading"><h2 id={`${id}-title`}>{label} at</h2><button type="button" className="btn btn-ghost btn-square" aria-label="Close time picker" onClick={() => dialog.current?.close()}><UiIcon name="close" /></button></div>
        <p className="time-picker-help">Scroll to select the time in the middle. Bangkok · 24-hour clock.</p>
        <div className="time-picker-wheels">
          <div className="time-picker-column"><span>Hour</span>{open && <TimeWheel label={`${label} hour`} values={hours} value={hour} onChange={time => onChange(`${time}:${minute}`)} />}</div>
          <span className="time-picker-colon" aria-hidden="true">:</span>
          <div className="time-picker-column"><span>Minute</span>{open && <TimeWheel label={`${label} minute`} values={minutes} value={minute} onChange={time => onChange(`${hour}:${time}`)} />}</div>
        </div>
        <button type="button" className="btn btn-primary w-full mt-5" onClick={() => dialog.current?.close()}>Done · {value}</button>
      </div>
    </dialog>
  </div>;
}
