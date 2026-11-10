// What this component shows: the practitioner "Schedule & triage desk" with two tabs (three when Helpdesk referrals are on).
// Schedule: day, week, and month calendars of pending and confirmed sessions, each followed by its privacy buffer.
// Review requests: pending requests, urgent first. Opening one shows its note and the decision buttons.
// Helpdesk referrals: the HelpdeskReferrals list, shown only when the referrals feature is switched on.
// Used on: /practitioner (signed-in practitioners only).
// Talks to: GET /api/v1/practitioner/queue, GET /api/v1/practitioner/schedule?from=...&to=...,
// PATCH /api/v1/requests/{id}/status, and GET /api/v1/slots (through SlotSelector) when rescheduling.
// GET /api/v1/practitioner/referrals is asked once on load, to decide whether to show the referrals tab.
// Note: staff never see a student's access key. A student appears only by alias or "Anonymous student".
//
// How this component is organised:
// 1. State, then effects for the booking popup, loading the queue and the schedule together,
//    and the one-time referrals check.
// 2. Helpers: selectDate() picks a day, reload() data, open() a request, confirm() asks first,
//    decide() sends the decision, switchTab() changes tab.
// 3. Markup: the tabs, the date and view controls, the tab panels, the booking popup
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
  type Referral,
  type RequestStatus,
} from "@/lib/client/contracts";
import { HelpdeskReferrals } from "./HelpdeskReferrals";
import { SlotSelector } from "./SlotSelector";
import { useCampusToday } from "@/lib/client/use-campus-today";
import { scheduleMonth } from "@/lib/client/schedule-month";
import { PractitionerMonth } from "./PractitionerMonth";
import { UiIcon } from "./UiIcon";
// The desk's tabs. "referrals" (Helpdesk referrals) exists only when that feature is switched on.
type DeskTab = "schedule" | "reviews" | "referrals";

export function PractitionerDesk() {
  const router = useRouter();
  // queue: pending requests (Review tab). schedule: sessions in the shown dates (Schedule tab).
  const [queue, setQueue] = useState<AppointmentRequest[]>([]);
  // activeTab: the open tab. The desk always starts on Schedule.
  const [activeTab, setActiveTab] = useState<DeskTab>("schedule");
  // referralsOn: GET /practitioner/referrals answered 200, so the Helpdesk referrals tab is shown.
  // pendingReferrals: how many referrals wait for review, for that tab's badge.
  const [referralsOn, setReferralsOn] = useState(false);
  const [pendingReferrals, setPendingReferrals] = useState(0);
  const [schedule, setSchedule] = useState<AppointmentRequest[]>([]);
  // today: today's date in Bangkok. It is "" until the page runs in the browser.
  // date: the first day shown (in the Month view, the selected day). It is today in Bangkok until the
  // practitioner picks another date (chosenDate).
  const today = useCampusToday();
  const [chosenDate, setDate] = useState("");
  const date = chosenDate || today;
  // view: "day", "week" or "month". days: 1 for the Day view, 7 for the Week view (Month does not use it).
  // rangeStart and rangeEnd: the dates sent to GET /practitioner/schedule. Day and Week: from date for
  // "days" days. Month: the 1st to the last day of date's month. Both are "" until the date is known.
  const [view, setView] = useState("day");
  const days = view === "day" ? 1 : 7;
  const rangeStart = date ? view === "month" ? scheduleMonth(date).start : date : "";
  const rangeEnd = date ? view === "month" ? scheduleMonth(date).end : addDays(date, days - 1) : "";
  // loading and error: status of the data load. refresh: a counter; adding 1 loads the data again.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  // selected: the request open in the booking popup. rescheduling and slot: the replacement time picker.
  // busy: a decision is being saved. message: the result shown after a decision.
  const [selected, setSelected] = useState<AppointmentRequest | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [slot, setSlot] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // messageTone: shows that message as a success or as a problem ("danger").
  const [messageTone, setMessageTone] = useState<"success" | "danger">("success");
  // decision: what the confirmation dialog will send: a new status, plus a new time when rescheduling.
  const [decision, setDecision] = useState<{
    status: RequestStatus;
    slot?: string;
  } | null>(null);
  // dialog: the confirmation dialog. detail: the booking popup, which gets focus when a request opens.
  // opener: the element that opened the booking popup. Focus goes back to it when the popup closes.
  // locked: stops a double click from sending the same decision twice.
  const dialog = useRef<HTMLDialogElement>(null);
  const detail = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const locked = useRef(false);
  // Open the booking popup as a modal when a request is selected (only if it is not open yet),
  // and close it when "selected" is cleared.
  useEffect(() => {
    if (selected) {
      if (!detail.current?.open) detail.current?.showModal();
    } else {
      detail.current?.close();
    }
  }, [selected]);
  // Load the queue and the schedule at the same time.
  // It waits until the date is known (rangeStart is "" before that), and runs again when the range
  // changes or reload() adds 1 to refresh.
  // 401 = not signed in: go to the sign-in page, then come back here (next=/practitioner).
  // 404 = signed in, but not a practitioner (the server hides staff data from other roles).
  // Any other failure shows one error for both, and the Review and Schedule panels stay hidden.
  // "alive" ignores an old answer when the date or the view changes quickly.
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
  }, [rangeStart, rangeEnd, refresh, router]);
  // Ask once, alongside the loads above, whether Helpdesk referrals are on. Only a 200 answer shows the
  // third tab; 404 (feature off) or any other answer keeps it hidden. The answer also fills its badge.
  useEffect(() => {
    let alive = true;
    api<Referral[]>("/practitioner/referrals").then((r) => {
      if (!alive || r.status !== 200 || !Array.isArray(r.data)) return;
      setReferralsOn(true);
      setPendingReferrals(r.data.filter((row) => row.status === "received").length);
    });
    return () => {
      alive = false;
    };
  }, []);
  // Pick another date (from the date field or the month grid) and close the booking popup.
  // In the Month view, a day in the same month keeps the same range, so no new load and no skeleton.
  function selectDate(next: string) {
    if (next === date) return;
    const changesRange = view !== "month" || next.slice(0, 7) !== date.slice(0, 7);
    setDate(next);
    setSelected(null);
    if (changesRange) setLoading(true);
  }
  // Close the booking popup and load fresh data. The skeleton shows until the new answer arrives.
  function reload() {
    setSelected(null);
    setLoading(true);
    setRefresh((n) => n + 1);
  }
  // Show one request in the booking popup and move keyboard focus to it (after the panel is drawn).
  // It remembers the focused element (opener), and clears the reschedule picker and the old message.
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
  // Day view: 1 date. Week view: 7 dates. Month view: only the selected day, listed under the month grid.
  const calendarDays = date
    ? Array.from({ length: view === "month" ? 1 : days }, (_, i) => addDays(date, i))
    : [];
  // Changing tabs also closes the booking popup and the reschedule picker.
  function switchTab(tab: DeskTab) {
    setActiveTab(tab);
    setSelected(null);
    setRescheduling(false);
    setSlot("");
  }
  // The tabs follow the ARIA tabs pattern: Left and Right arrows switch tabs, Home and End jump to the
  // first and last tab, and only the active tab is in the Tab key order (tabIndex 0 or -1).
  // The "Review requests" tab shows how many requests are waiting, in a badge and in its spoken label.
  // Switching tabs does not remove a panel; the hidden attribute shows only the active one.
  // The Review and Schedule panels wait for the queue and schedule load; the referrals panel does not.
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
        // The tabs in order (the referrals tab only when it is shown). Arrows move one tab and wrap around.
        const tabs: DeskTab[] = referralsOn ? ["schedule", "reviews", "referrals"] : ["schedule", "reviews"];
        const step = event.key === "ArrowRight" ? 1 : tabs.length - 1;
        const tab = event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[tabs.length - 1] : tabs[(tabs.indexOf(activeTab) + step) % tabs.length];
        switchTab(tab);
        event.currentTarget.querySelector<HTMLButtonElement>(`#practitioner-${tab}-tab`)?.focus();
      }}>
        <button type="button" role="tab" id="practitioner-schedule-tab" aria-controls="practitioner-schedule-panel" aria-selected={activeTab === "schedule"} tabIndex={activeTab === "schedule" ? 0 : -1} disabled={busy} className="tab" onClick={() => switchTab("schedule")}>Schedule</button>
        <button type="button" role="tab" id="practitioner-reviews-tab" aria-controls="practitioner-reviews-panel" aria-selected={activeTab === "reviews"} aria-label={`Review requests${!loading && !error ? `, ${queue.length} awaiting review` : ""}`} tabIndex={activeTab === "reviews" ? 0 : -1} disabled={busy} className="tab" onClick={() => switchTab("reviews")}>Review requests <span className="request-count-badge" aria-hidden="true">{loading ? "…" : error ? "—" : queue.length}</span></button>
        {/* Third tab, only when the referrals feature is on. Its badge counts referrals waiting for review. */}
        {referralsOn && <button type="button" role="tab" id="practitioner-referrals-tab" aria-controls="practitioner-referrals-panel" aria-selected={activeTab === "referrals"} aria-label={`Helpdesk referrals, ${pendingReferrals} waiting for review`} tabIndex={activeTab === "referrals" ? 0 : -1} disabled={busy} className="tab" onClick={() => switchTab("referrals")}>Helpdesk referrals <span className="request-count-badge" aria-hidden="true">{pendingReferrals}</span></button>}
      </div>
      <div className="flex flex-wrap items-end gap-4 rounded-box bg-base-100 p-5">
        {/* The date field and the Day / Week / Month choice show only on the Schedule tab. */}
        {/* Refresh shows on every tab, but it reloads only the queue and the schedule. */}
        {activeTab === "schedule" && <>
        {/* In the Month view the date is the selected day; otherwise it is the first day shown. */}
        {/* An empty date field gives "", which is ignored. */}
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
        {/* A new view always gives a new date range, so the skeleton shows until it has loaded. */}
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
      {/* The result of the last decision, once the booking popup has closed. */}
      {message && !selected && (
        <p role="status" className="booking-feedback" data-tone={messageTone}>
          {message}
        </p>
      )}
      {/* The queue or schedule load failed. This shows on every tab, with a way to try again. */}
      {error && (
        <div role="alert" className="card gap-3 p-5">
          <p>{error}</p>
          <button className="btn self-start" onClick={reload}>
            Retry loading
          </button>
        </div>
      )}
      {/* While the queue and the schedule load, a skeleton takes the place of the Review and Schedule */}
      {/* panels. After an error those two panels stay hidden until a later load succeeds. */}
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
              {/* Month view: the month grid comes first. Picking a day there calls selectDate(), */}
              {/* and that day's sessions show in the list below. */}
              {view === "month" && date && <PractitionerMonth date={date} today={today} schedule={schedule} busy={busy} onSelect={selectDate} />}
              {/* One block per date in calendarDays. aria-live reads out the new list after a change. */}
              <div className="schedule-days" aria-live="polite">
                {calendarDays.map((day) => {
                  // Put each session under its Bangkok date. campusDate() adds 7 hours to the UTC time,
                  // so an early-morning Bangkok session is not shown on the day before.
                  const rows = schedule.filter(
                    (r) => campusDate(new Date(r.requested_slot_start)) === day,
                  );
                  // Each session is a button (it opens the booking popup). Under it, a separate grey block
                  // shows the 15-minute privacy buffer: from the session end to privacy_buffer_end.
                  return (
                    <section key={day} className="min-w-0">
                      {/* The day's name, e.g. "Tue 10 Nov". 12:00 UTC is 19:00 in Bangkok, the same date. */}
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
                              {/* The session: time, status, urgency and alias. Its text is also its spoken name. */}
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
                              {/* The buffer is plain text, not a button: it is time kept free, not a booking. */}
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
      {/* Helpdesk referrals panel, only when the feature is on. HelpdeskReferrals loads its own list */}
      {/* and shows its own loading and error states. It sits outside the queue and schedule wrapper */}
      {/* above, so a slow or failed queue or schedule load never hides it. */}
      {referralsOn && (
        <section
          id="practitioner-referrals-panel"
          role="tabpanel"
          aria-labelledby="practitioner-referrals-tab"
          hidden={activeTab !== "referrals"}
          className="card card-border gap-4 p-5 sm:p-6"
        >
          {/* key={refresh}: the desk's Refresh button (and every desk reload) also reloads the referrals. */}
          <HelpdeskReferrals key={refresh} onPendingChange={setPendingReferrals} />
        </section>
      )}
      {/* Booking popup (detail panel) for the chosen request. Escape or a click on the dark backdrop */}
      {/* closes it, but not while a decision is saving. On close it clears the request and the picker, */}
      {/* then puts focus back on the button that opened it, or on the active tab if that button is gone. */}
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
          {/* The heading gets focus when the popup opens (autoFocus). The close button sits in a */}
          {/* form with method="dialog", so the browser closes the dialog without extra code. */}
          <div className="booking-dialog-heading">
          <h2 id="detail-title" className="text-2xl font-semibold" tabIndex={-1} autoFocus>
            {selected.alias || "Anonymous request"}
          </h2>
          <form method="dialog"><button className="btn btn-ghost btn-square" aria-label="Close booking details" disabled={busy}><UiIcon name="close" /></button></form>
          </div>
          <div className="booking-status-line">
            <span className="booking-status" data-status={selected.status}>{STATUS_LABELS[selected.status]}</span>
            <span className={selected.urgency_level === "URGENT" ? "text-error font-semibold" : "text-base-content/70"}>{selected.urgency_level === "URGENT" ? "Urgent" : "Routine"}</span>
          </div>
          {/* Date, session time and privacy buffer, all in Bangkok time. */}
          <dl className="booking-time-details">
            <div><dt>Appointment date</dt><dd>{new Date(selected.requested_slot_start).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Bangkok" })}</dd></div>
            <div><dt>Session time · Bangkok (UTC+7)</dt><dd>{campusTime(selected.requested_slot_start)}–{campusTime(selected.requested_slot_end)}</dd></div>
            <div className="booking-buffer"><dt>Privacy buffer</dt><dd>{campusTime(selected.requested_slot_end)}–{campusTime(selected.privacy_buffer_end)}</dd></div>
          </dl>
          {/* Here only a failed decision shows. After a success or a 409 the reload closes the popup, */}
          {/* and the message shows on the page instead. */}
          {message && <p role="status" className="booking-feedback" data-tone={messageTone}>{message}</p>}
          <section className="booking-note" aria-labelledby="booking-note-title"><h3 id="booking-note-title">Student note</h3><p className="whitespace-pre-wrap break-words">{selected.intake_note || "No note provided."}</p></section>
          {selected.urgency_level === "URGENT" && (
            <p className="rounded-field border border-error p-4 text-sm">
              Urgent concern. Follow your service’s crisis pathway. This student
              is anonymous and cannot be contacted through this app.
            </p>
          )}
          {/* Approve only for a PENDING request. Reschedule for both pending and confirmed ones. */}
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
          {/* Reject only for a PENDING request. Cancel for both pending and confirmed ones. */}
          <div className="booking-danger-actions">
            <p>Rejection or cancellation releases the reserved time.</p>
            <div className="flex flex-wrap gap-3">
              {selected.status === "PENDING" && <button className="btn btn-error btn-outline" disabled={busy} onClick={() => confirm("REJECTED")}>Reject request</button>}
              <button className="btn btn-error btn-outline" disabled={busy} onClick={() => confirm("CANCELLED")}>Cancel appointment</button>
            </div>
          </div>
        </div>}
      </dialog>
      {/* Confirmation dialog. Its title, text and main button follow "decision". "Go back" gets focus */}
      {/* first, so Enter never sends a decision by mistake. Escape cannot close it while saving. */}
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
