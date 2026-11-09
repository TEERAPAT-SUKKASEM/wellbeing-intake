"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { UiIcon } from "./UiIcon";

const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const minutes = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

function TimeWheel({ label, values, value, onChange }: { label: string; values: string[]; value: string; onChange: (value: string) => void }) {
  const scroll = useRef<HTMLDivElement>(null);
  const initial = useRef(Number(value));
  const selected = useRef(Number(value));
  const change = useRef(onChange);
  useLayoutEffect(() => { change.current = onChange; }, [onChange]);
  useLayoutEffect(() => {
    if (scroll.current) scroll.current.scrollTop = initial.current * 44;
  }, []);
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    let accumulated = 0;
    let lastWheel = 0;
    function wheel(event: WheelEvent) {
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY) || !event.deltaY) return;
      event.preventDefault();
      event.stopPropagation();
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
  function choose(index: number) {
    const next = Math.max(0, Math.min(values.length - 1, index));
    selected.current = next;
    scroll.current?.scrollTo({ top: next * 44, behavior: "instant" });
    onChange(values[next]);
  }
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
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const hour = value.slice(0, 2);
  const minute = value.slice(3, 5);
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
