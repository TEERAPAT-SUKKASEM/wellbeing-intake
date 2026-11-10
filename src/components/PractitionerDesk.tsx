// What this component shows: the practitioner "Schedule & triage desk" with two tabs.
// Schedule: a day or week calendar of pending and confirmed sessions, each followed by its privacy buffer.
// Review requests: pending requests, urgent first. Opening one shows its note and the decision buttons.
// Used on: /practitioner (signed-in practitioners only).
// Talks to: GET /api/v1/practitioner/queue, GET /api/v1/practitioner/schedule?from=...&to=...,
// PATCH /api/v1/requests/{id}/status, and GET /api/v1/slots (through SlotSelector) when rescheduling.
// Note: staff never see a student's access key. A student appears only by alias or "Anonymous student".
//
// How this component is organised:
// 1. State, then one effect that loads the queue and the schedule together.
// 2. Helpers: reload() data, open() a request, confirm() asks first, decide() sends the decision.
// 3. Markup: the tabs, the date and view controls, the two tab panels, the detail panel
//    of the chosen request, and the confirmation dialog.
"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import {
  addDays,
  campusDate,
  campusDateTime,
  campusTime,
  errorMessage,
  STATUS_LABELS,
  type AppointmentRequest,
  type RequestStatus,
} from "@/lib/client/contracts";
import { SlotSelector } from "./SlotSelector";
import { useCampusToday } from "@/lib/client/use-campus-today";
import { scheduleMonth } from "@/lib/client/schedule-month";
import { PractitionerMonth } from "./PractitionerMonth";
import { UiIcon } from "./UiIcon";

export function PractitionerDesk() {
  const router = useRouter();
  // queue: pending requests (Review tab). schedule: sessions in the shown dates (Schedule tab).
  const [queue, setQueue] = useState<AppointmentRequest[]>([]);
  const [activeTab, setActiveTab] = useState<"schedule" | "reviews">("schedule");
  const [schedule, setSchedule] = useState<AppointmentRequest[]>([]);
  // date: the first day shown. It is today in Bangkok until the practitioner picks another date.
  // days: 1 for the Day view, 7 for the Week view.
  const today = useCampusToday();
  const [chosenDate, setDate] = useState("");
  const date = chosenDate || today;
<<<<<<< HEAD
  const [view, setView] = useState("day");
  const days = view === "day" ? 1 : 7;
  const rangeStart = date ? view === "month" ? scheduleMonth(date).start : date : "";
  const rangeEnd = date ? view === "month" ? scheduleMonth(date).end : addDays(date, days - 1) : "";
=======
  const [days, setDays] = useState(7);
  // loading and error: status of the data load. refresh: a counter; adding 1 loads the data again.
>>>>>>> origin/main
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  // selected: the request open in the detail panel. rescheduling and slot: the replacement time picker.
  // busy: a decision is being saved. message: the result shown after a decision.
  const [selected, setSelected] = useState<AppointmentRequest | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [slot, setSlot] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
<<<<<<< HEAD
  const [messageTone, setMessageTone] = useState<"success" | "danger">("success");
=======
  // decision: what the confirmation dialog will send: a new status, plus a new time when rescheduling.
>>>>>>> origin/main
  const [decision, setDecision] = useState<{
    status: RequestStatus;
    slot?: string;
  } | null>(null);
  // dialog: the confirmation dialog. detail: the detail panel, which gets focus when a request opens.
  // locked: stops a double click from sending the same decision twice.
  const dialog = useRef<HTMLDialogElement>(null);
  const detail = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const locked = useRef(false);
  // Load the queue and the schedule at the same time.
  // 401 = not signed in: go to the sign-in page, then come back here (next=/practitioner).
  // 404 = signed in, but not a practitioner (the server hides staff data from other roles).
  // "alive" ignores an old answer when the date or the view changes quickly.
  useEffect(() => {
    if (selected) {
      if (!detail.current?.open) detail.current?.showModal();
    } else {
      detail.current?.close();
    }
  }, [selected]);
  useEffect(() => {
    if (!rangeStart) return;
    let alive = true;
    Promise.all([
      api<AppointmentRequest[]>("/practitioner/queue"),
      api<AppointmentRequest[]>(
        `/practitioner/schedule?from=${rangeStart}&to=${rangeEnd}`,
      ),
    ]).then(([q, s]) => {
      if (!alive) return;
      if (q.status === 401 || s.status === 401) {
        router.replace("/sign-in?next=/practitioner");
        return;
      }
      setLoading(false);
      if (!q.ok || !s.ok) {
        setError(
          q.status === 404 || s.status === 404
            ? "This workspace is available to practitioners only."
            : "We could not load the queue and schedule. Please retry.",
        );
        return;
      }
      setQueue(q.data ?? []);
      setSchedule(s.data ?? []);
      setError("");
    });
    return () => {
      alive = false;
    };
<<<<<<< HEAD
  }, [rangeStart, rangeEnd, refresh, router]);
  function selectDate(next: string) {
    if (next === date) return;
    const changesRange = view !== "month" || next.slice(0, 7) !== date.slice(0, 7);
    setDate(next);
    setSelected(null);
    if (changesRange) setLoading(true);
  }
=======
  }, [date, days, refresh, router]);
  // Close the detail panel and load fresh data.
>>>>>>> origin/main
  function reload() {
    setSelected(null);
    setLoading(true);
    setRefresh((n) => n + 1);
  }
  // Show one request in the detail panel and move keyboard focus to it (after the panel is drawn).
  function open(row: AppointmentRequest) {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelected(row);
    setRescheduling(false);
    setSlot("");
    setMessage("");
  }
  // Every decision first opens a confirmation dialog. Nothing is sent yet.
  function confirm(status: RequestStatus, newSlot?: string) {
    setDecision({ status, slot: newSlot });
    dialog.current?.showModal();
  }
  // Send the confirmed decision. Approve = CONFIRMED, Reject = REJECTED, Cancel = CANCELLED.
  // A reschedule sends CONFIRMED plus the new requested_slot_start, so it also approves the request.
  async function decide() {
    if (!selected || !decision || locked.current) return;
    locked.current = true;
    setBusy(true);
    setMessage("");
    const r = await api<AppointmentRequest>(
      `/requests/${encodeURIComponent(selected.id)}/status`,
      {
        method: "PATCH",
        body: {
          status: decision.status,
          ...(decision.slot ? { requested_slot_start: decision.slot } : {}),
        },
      },
    );
    locked.current = false;
    setBusy(false);
    dialog.current?.close();
    // On success, show a message and reload. The student is anonymous, so they only see
    // the change when they check their access key.
    // 409 means the request changed meanwhile or the new time was taken, so reload to show the latest state.
    if (r.ok) {
      setMessageTone(decision.status === "REJECTED" || decision.status === "CANCELLED" ? "danger" : "success");
      setMessage(
        decision.slot
          ? "Appointment rescheduled. The student will see the new time when they check their access key."
          : decision.status === "CONFIRMED"
            ? "Appointment approved."
            : decision.status === "REJECTED"
              ? "Request declined."
              : "Appointment cancelled.",
      );
      reload();
    } else {
      setMessageTone("danger");
      setMessage(errorMessage(r.error));
      if (r.status === 409) reload();
    }
  }
  // The list of dates (YYYY-MM-DD) shown in the calendar, starting from "date".
  const calendarDays = date
    ? Array.from({ length: view === "month" ? 1 : days }, (_, i) => addDays(date, i))
    : [];
  // Changing tabs also closes the detail panel and the reschedule picker.
  function switchTab(tab: "schedule" | "reviews") {
    setActiveTab(tab);
    setSelected(null);
    setRescheduling(false);
    setSlot("");
  }
  // The tabs follow the ARIA tabs pattern: Left and Right arrows switch tabs, Home and End jump to the
  // first and last tab, and only the active tab is in the Tab key order (tabIndex 0 or -1).
  // The "Review requests" tab shows how many requests are waiting, in a badge and in its spoken label.
  // Both panels stay in the page; the hidden attribute shows only the active one.
  return (
    <div className="space-y-6">
      <header className="route-intro">
        <h1 className="text-3xl font-semibold sm:text-4xl">
          Schedule & triage desk
        </h1>
        <p>
          Review anonymous requests, approve appointments, and protect the space
          between visits.
        </p>
      </header>
      <div role="tablist" aria-label="Practitioner workspace" className="tabs practitioner-tabs" onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || busy) return;
        event.preventDefault();
        const tab = event.key === "Home" ? "schedule" : event.key === "End" ? "reviews" : activeTab === "schedule" ? "reviews" : "schedule";
        switchTab(tab);
        event.currentTarget.querySelector<HTMLButtonElement>(`#practitioner-${tab}-tab`)?.focus();
      }}>
        <button type="button" role="tab" id="practitioner-schedule-tab" aria-controls="practitioner-schedule-panel" aria-selected={activeTab === "schedule"} tabIndex={activeTab === "schedule" ? 0 : -1} disabled={busy} className="tab" onClick={() => switchTab("schedule")}>Schedule</button>
        <button type="button" role="tab" id="practitioner-reviews-tab" aria-controls="practitioner-reviews-panel" aria-selected={activeTab === "reviews"} aria-label={`Review requests${!loading && !error ? `, ${queue.length} awaiting review` : ""}`} tabIndex={activeTab === "reviews" ? 0 : -1} disabled={busy} className="tab" onClick={() => switchTab("reviews")}>Review requests <span className="request-count-badge" aria-hidden="true">{loading ? "…" : error ? "—" : queue.length}</span></button>
      </div>
      <div className="flex flex-wrap items-end gap-4 rounded-box bg-base-100 p-5">
        {activeTab === "schedule" && <>
        <label>
          <span className="mb-2 block font-medium">{view === "month" ? "Selected date" : "Starting date"}</span>
          <input
            className="input"
            type="date"
            value={date}
            disabled={busy}
            onChange={(e) => {
              if (e.target.value) {
                selectDate(e.target.value);
              }
            }}
          />
        </label>
        <label>
          <span className="mb-2 block font-medium">View</span>
          <select
            className="select"
            value={view}
            disabled={busy}
            onChange={(e) => {
              setView(e.target.value);
              setSelected(null);
              setLoading(true);
            }}
          >
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
        </label>
        </>}
        <button className="btn" disabled={busy || loading} onClick={reload}>
          Refresh
        </button>
        <p className="text-sm text-base-content/70">
          Campus time · Bangkok (UTC+7)
        </p>
      </div>
      {message && !selected && (
        <p role="status" className="booking-feedback" data-tone={messageTone}>
          {message}
        </p>
      )}
      {error && (
        <div role="alert" className="card gap-3 p-5">
          <p>{error}</p>
          <button className="btn self-start" onClick={reload}>
            Retry loading
          </button>
        </div>
      )}
      {loading ? (
        <div
          className="skeleton h-60 w-full"
          role="status"
          aria-label="Loading practitioner workspace"
        />
      ) : (
        !error && (
          <>
            <section
              id="practitioner-reviews-panel"
              role="tabpanel"
              aria-labelledby="practitioner-reviews-tab"
              hidden={activeTab !== "reviews"}
              className="card card-border gap-4 p-5 sm:p-6"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="queue-heading" className="text-2xl font-semibold">
                  Awaiting a decision
                </h2>
                <p className="text-sm">
                  {queue.length} pending ·{" "}
                  {queue.filter((r) => r.urgency_level === "URGENT").length}{" "}
                  urgent
                </p>
              </div>
              <p className="text-sm text-base-content/70">
                Urgent requests first, then the soonest requested time. Student
                access keys are never available to staff.
              </p>
              {/* The server already sorts the queue: urgent first, then the soonest time. */}
              {/* A hidden request ID gives each "Review request" button a unique spoken name. */}
              {queue.length === 0 ? (
                <p>No requests are awaiting a decision.</p>
              ) : (
                <ul className="divide-y divide-base-300">
                  {queue.map((row) => (
                    <li
                      key={row.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-4"
                    >
                      <div>
                        <p className="font-semibold">
                          {row.urgency_level === "URGENT"
                            ? "Urgent"
                            : "Routine"}{" "}
                          · {row.alias || "Anonymous student"}
                        </p>
                        <p className="mt-1 text-sm">
                          {campusDateTime(row.requested_slot_start)}
                        </p>
                      </div>
                      <button
                        className="btn"
                        aria-haspopup="dialog"
                        aria-controls="practitioner-booking"
                        disabled={busy}
                        onClick={() => open(row)}
                      >
                        Review request<span className="sr-only"> {row.id}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section
              id="practitioner-schedule-panel"
              role="tabpanel"
              aria-labelledby="practitioner-schedule-tab"
              hidden={activeTab !== "schedule"}
              className="card card-border gap-5 p-5 sm:p-6"
            >
              <h2 id="calendar-heading" className="text-2xl font-semibold">
                {view === "month" ? "Monthly" : days === 1 ? "Daily" : "Weekly"} schedule
              </h2>
              <p className="text-sm text-base-content/70">
                Pending and confirmed appointments share one calendar. Every
                session includes a separate 15-minute privacy buffer.
              </p>
              {view === "month" && date && <PractitionerMonth date={date} today={today} schedule={schedule} busy={busy} onSelect={selectDate} />}
              <div className="schedule-days" aria-live="polite">
                {calendarDays.map((day) => {
                  // Put each session under its Bangkok date. campusDate() adds 7 hours to the UTC time,
                  // so an early-morning Bangkok session is not shown on the day before.
                  const rows = schedule.filter(
                    (r) => campusDate(new Date(r.requested_slot_start)) === day,
                  );
                  // Each session is a button (it opens the detail panel). Under it, a separate grey block
                  // shows the 15-minute privacy buffer: from the session end to privacy_buffer_end.
                  return (
                    <section key={day} className="min-w-0">
                      <h3 className="border-b border-base-300 pb-3 font-semibold">
                        {new Date(`${day}T12:00:00Z`).toLocaleDateString(
                          "en-GB",
                          {
                            weekday: "short",
                            day: "numeric",
                            month: "short",
                            timeZone: "Asia/Bangkok",
                          },
                        )}
                      </h3>
                      {rows.length === 0 ? (
                        <p className="py-5 text-sm text-base-content/70">
                          No appointments.
                        </p>
                      ) : (
                        <ol className="space-y-4 pt-4">
                          {rows.map((row) => (
                            <li key={row.id}>
                              <button
                                aria-haspopup="dialog"
                                aria-controls="practitioner-booking"
                                disabled={busy}
                                onClick={() => open(row)}
                                className="schedule-session w-full rounded-field border border-base-300 bg-secondary p-3 text-left"
                              >
                                <span className="block font-semibold tabular-nums">
                                  {campusTime(row.requested_slot_start)}–
                                  {campusTime(row.requested_slot_end)}
                                </span>
                                <span className="mt-1 block text-sm">
                                  {STATUS_LABELS[row.status]} ·{" "}
                                  {row.urgency_level === "URGENT"
                                    ? "Urgent"
                                    : "Routine"}
                                </span>
                                <span className="mt-1 block text-sm">
                                  {row.alias || "Anonymous student"}
                                </span>
                              </button>
                              <div className="privacy-buffer rounded-b-field border border-t-0 border-base-300 bg-base-200 p-3 text-xs">
                                <span className="block font-semibold">
                                  Privacy buffer
                                </span>
                                {campusTime(row.requested_slot_end)}–
                                {campusTime(row.privacy_buffer_end)}
                              </div>
                            </li>
                          ))}
                        </ol>
                      )}
                    </section>
                  );
                })}
              </div>
            </section>
          </>
        )
      )}
<<<<<<< HEAD
      <dialog
        ref={detail}
        id="practitioner-booking"
        className="modal practitioner-booking-dialog"
        aria-labelledby="detail-title"
        onCancel={event => { if (busy) event.preventDefault(); }}
        onClick={event => { if (event.target === event.currentTarget && !busy) detail.current?.close(); }}
        onClose={() => {
          setSelected(null);
          setRescheduling(false);
          setSlot("");
          if (opener.current?.isConnected) opener.current.focus();
          else document.getElementById(`practitioner-${activeTab}-tab`)?.focus();
        }}
      >
        {selected && <div className="modal-box practitioner-booking-panel space-y-5">
          <div className="booking-dialog-heading">
          <h2 id="detail-title" className="text-2xl font-semibold" tabIndex={-1} autoFocus>
=======
      {/* Detail panel of the chosen request. It shows the private note; "Hide private note" closes it. */}
      {/* Approve and Reject appear only for Pending requests. Reschedule and Cancel are always shown. */}
      {selected && (
        <section
          ref={detail}
          tabIndex={-1}
          className="card card-border gap-4 p-5 sm:p-6"
          aria-labelledby="detail-title"
        >
          <h2 id="detail-title" className="text-2xl font-semibold">
>>>>>>> origin/main
            {selected.alias || "Anonymous request"}
          </h2>
          <form method="dialog"><button className="btn btn-ghost btn-square" aria-label="Close booking details" disabled={busy}><UiIcon name="close" /></button></form>
          </div>
          <div className="booking-status-line">
            <span className="booking-status" data-status={selected.status}>{STATUS_LABELS[selected.status]}</span>
            <span className={selected.urgency_level === "URGENT" ? "text-error font-semibold" : "text-base-content/70"}>{selected.urgency_level === "URGENT" ? "Urgent" : "Routine"}</span>
          </div>
          <dl className="booking-time-details">
            <div><dt>Appointment date</dt><dd>{new Date(selected.requested_slot_start).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Bangkok" })}</dd></div>
            <div><dt>Session time · Bangkok (UTC+7)</dt><dd>{campusTime(selected.requested_slot_start)}–{campusTime(selected.requested_slot_end)}</dd></div>
            <div className="booking-buffer"><dt>Privacy buffer</dt><dd>{campusTime(selected.requested_slot_end)}–{campusTime(selected.privacy_buffer_end)}</dd></div>
          </dl>
          {message && <p role="status" className="booking-feedback" data-tone={messageTone}>{message}</p>}
          <section className="booking-note" aria-labelledby="booking-note-title"><h3 id="booking-note-title">Student note</h3><p className="whitespace-pre-wrap break-words">{selected.intake_note || "No note provided."}</p></section>
          {selected.urgency_level === "URGENT" && (
            <p className="rounded-field border border-error p-4 text-sm">
              Urgent concern. Follow your service’s crisis pathway. This student
              is anonymous and cannot be contacted through this app.
            </p>
          )}
          <div className="booking-main-actions">
            {selected.status === "PENDING" && (
              <>
                <button
                  className="btn btn-neutral"
                  disabled={busy}
                  onClick={() => confirm("CONFIRMED")}
                >
                  Approve appointment
                </button>
              </>
            )}
            <button
              className="btn btn-outline"
              disabled={busy}
              aria-expanded={rescheduling}
              aria-controls="booking-reschedule"
              onClick={() => {
                setRescheduling((v) => !v);
                setSlot("");
              }}
            >
              {rescheduling ? "Hide rescheduling" : "Reschedule"}
            </button>
          </div>
          {/* Reschedule: the same slot picker students use, starting on the request's current date. */}
          {/* It only shows free times, so the new time already respects the privacy buffers. */}
          {rescheduling && (
            <div id="booking-reschedule" className="space-y-4 border-t border-base-300 pt-5">
              <h3 className="font-semibold">Choose a replacement time</h3>
              <SlotSelector
                key={selected.id}
                serviceId={selected.service_id}
                value={slot}
                onChange={setSlot}
                initialDate={campusDate(
                  new Date(selected.requested_slot_start),
                )}
              />
              <p className="text-sm">
                Rescheduling also confirms this request. The student must check
                their access key to see the change.
              </p>
              <button
                className="btn btn-neutral"
                disabled={!slot || busy}
                onClick={() => confirm("CONFIRMED", slot)}
              >
                Confirm replacement time
              </button>
            </div>
          )}
<<<<<<< HEAD
          <div className="booking-danger-actions">
            <p>Rejection or cancellation releases the reserved time.</p>
            <div className="flex flex-wrap gap-3">
              {selected.status === "PENDING" && <button className="btn btn-error btn-outline" disabled={busy} onClick={() => confirm("REJECTED")}>Reject request</button>}
              <button className="btn btn-error btn-outline" disabled={busy} onClick={() => confirm("CANCELLED")}>Cancel appointment</button>
            </div>
          </div>
        </div>}
      </dialog>
=======
        </section>
      )}
      {/* Confirmation dialog for every decision. Its title and text depend on the decision. */}
      {/* While saving, the buttons are disabled and Escape cannot close it (onCancel). */}
>>>>>>> origin/main
      <dialog
        ref={dialog}
        className="modal"
        aria-labelledby="decision-title"
        onCancel={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <div className="modal-box">
          <h2 id="decision-title" className="text-xl font-semibold">
            {decision?.slot
              ? "Reschedule and confirm appointment?"
              : decision?.status === "CONFIRMED"
                ? "Approve this appointment?"
                : decision?.status === "REJECTED"
                  ? "Reject this request?"
                  : "Cancel this appointment?"}
          </h2>
          <p className="mt-3">
            {decision?.slot
              ? `${campusDateTime(decision.slot)} (Bangkok). The student will need to check their status to see this change.`
              : decision?.status === "CONFIRMED"
                ? "This confirms the appointment. The student will see the approval when they check their access key."
                : decision?.status === "REJECTED"
                  ? "This declines the request and releases the reserved time. The student will see the decision when they check their access key."
                  : "This cancels the appointment and releases the reserved time. The student will see the cancellation when they check their access key."}
          </p>
          <div className="modal-action">
            <button
              className="btn btn-ghost"
              disabled={busy}
              autoFocus
              onClick={() => dialog.current?.close()}
            >
              Go back
            </button>
            <button
              className={`btn ${decision?.status === "REJECTED" || decision?.status === "CANCELLED" ? "btn-error" : "btn-neutral"}`}
              disabled={busy}
              onClick={() => void decide()}
            >
              {busy ? "Saving…" : decision?.slot ? "Confirm replacement time" : decision?.status === "CONFIRMED" ? "Approve appointment" : decision?.status === "REJECTED" ? "Reject request" : "Cancel appointment"}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
