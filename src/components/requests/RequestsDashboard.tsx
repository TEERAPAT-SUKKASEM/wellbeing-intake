// What this component shows: the "Track your private request" page. The student types their
// Private Access Key to see the service, status, date and time, and can cancel the request.
// Used on: /requests, and /preview/requests in the development preview.
// Talks to: GET /api/v1/services (for the service name), GET /api/v1/requests/me with the
// X-Access-Key header, and POST /api/v1/requests/{id}/cancel with { access_key }.
// Preview mode uses fictional in-memory data instead.
// Note: the key is sent in a header, not in the URL, so it does not appear in web server logs.
// The student's note is never shown here.
// Auto-refresh: while a Pending or Confirmed request is on screen, it is checked again every 30 seconds
// (useAutoRefresh), so an approval, a new time or a cancellation shows up without pressing the button.
"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { studentApi } from "@/lib/client/booking-preview";
import { STUDENT_REFRESH_MS, useAutoRefresh } from "@/lib/client/auto-refresh";
import {
  campusTime,
  errorMessage,
  getNavigationKey,
  setNavigationKey,
  STATUS_LABELS,
  type AppointmentRequest,
  type Service,
} from "@/lib/client/contracts";
import { EmergencyBanner } from "../EmergencyBanner";
import { UiIcon } from "../UiIcon";

// Only "preview" is used. previewServiceId and justSent are accepted but ignored.
export function RequestsDashboard({
  preview = false,
}: {
  preview?: boolean;
  previewServiceId?: string;
  justSent?: boolean;
}) {
  // key: the text in the key box. It starts with the key handed over in memory by the receipt
  // ("Track this request"), or "" if the student came here directly.
  // activeKey: the key that last found a request; cancel uses it. request: the request found.
  const [key, setKey] = useState(getNavigationKey);
  const [activeKey, setActiveKey] = useState("");
  const [request, setRequest] = useState<AppointmentRequest | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  // Load the service names, to show a name instead of an ID. If it fails, a general title is used.
  useEffect(() => {
    let alive = true;
    studentApi(preview)<Service[]>("/services").then(result => {
      if (alive && result.ok) setServices(result.data ?? []);
    });
    return () => { alive = false; };
  }, [preview]);
  // busy: a lookup or a cancel is running. message: text shown to the student.
  // error: true makes the message an alert (read at once) instead of a polite status.
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  // dialog: the cancel confirmation. resultRef: the result card, which gets focus after a lookup.
  // keyInput: the key box, which gets focus after "Clear". version: goes up on every lookup, clear,
  // cancel and change of the key box, so an older lookup or background check answer is ignored.
  const dialog = useRef<HTMLDialogElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  const keyInput = useRef<HTMLInputElement>(null);
  const version = useRef(0);
  // autoCheck: false after a background check got 404 or 429; the next manual check turns it on again.
  const [autoCheck, setAutoCheck] = useState(true);
  async function lookup() {
    const attempt = ++version.current;
    setBusy(true);
    setMessage("");
    setRequest(null);
    // Remove spaces and use capitals, so a key typed in small letters still matches.
    const normalized = key.trim().toUpperCase();
    // The key goes in the X-Access-Key header, never in the URL.
    const r = await studentApi(preview)<AppointmentRequest>("/requests/me", {
      headers: { "X-Access-Key": normalized },
    });
    // Ignore this answer if a newer lookup started or the student pressed "Clear".
    if (attempt !== version.current) return;
    setBusy(false);
    setError(!r.ok);
    // Found: show the request, remember the key for cancelling, and move focus to the result.
    // 404: no request has this key. The message is neutral and gives no other detail.
    // Other errors, such as 429 (too many tries), use the shared errorMessage() text.
    if (r.ok && r.data) {
      setRequest(r.data);
      setActiveKey(normalized);
      setAutoCheck(true);
      requestAnimationFrame(() => resultRef.current?.focus());
    } else
      setMessage(
        r.status === 404
          ? "We couldn’t find a request with that key. Check your saved key and try again."
          : errorMessage(r.error),
      );
  }
  // Runs when "Confirm cancellation" is pressed in the dialog.
  // busy stops a second click while the first cancel is running.
  async function cancel() {
    if (!request || busy) return;
    // Ignore any background check that is still running, so it cannot put back the old status.
    version.current++;
    setBusy(true);
    setMessage("");
    // The server checks the access key again before it cancels.
    const r = await studentApi(preview)(
      `/requests/${encodeURIComponent(request.id)}/cancel`,
      { method: "POST", body: { access_key: activeKey } },
    );
    setBusy(false);
    setError(!r.ok);
    // Success: show Cancelled, close the dialog and move focus back to the result card.
    // The server has released the time and its privacy buffer for other students.
    if (r.ok) {
      setRequest({ ...request, status: "CANCELLED" });
      dialog.current?.close();
      requestAnimationFrame(() => resultRef.current?.focus());
      setMessage(
        "Your request is cancelled. The appointment time and privacy buffer have been released.",
      );
    } else setMessage(errorMessage(r.error));
  }
  // "Clear key and details": forget the key everywhere (the box, the in-memory hand-over and the result).
  // version++ makes any lookup that is still running be ignored.
  function clear() {
    version.current++;
    setBusy(false);
    setKey("");
    setActiveKey("");
    setRequest(null);
    setNavigationKey("");
    setMessage("");
    keyInput.current?.focus();
  }
  // Auto-refresh: check the request on screen again in the background with the same key. It shows no
  // "Checking status…" and moves no focus. Only when something changed does the card update, with a
  // polite message that says what changed (screen readers read it out). It is skipped while the cancel
  // dialog is open. An answer is dropped if the student checked again, cleared, typed or cancelled meanwhile.
  // 404 (the request no longer exists) or 429 (too many tries) stops the checks until the next manual
  // check, so background checks never keep adding to the failed-key counter that blocks key guessing.
  async function checkForChanges() {
    if (!request || dialog.current?.open) return;
    const attempt = version.current;
    const r = await studentApi(preview)<AppointmentRequest>("/requests/me", {
      headers: { "X-Access-Key": activeKey },
    });
    if (attempt !== version.current) return;
    if (!r.ok || !r.data) {
      if (r.status === 404 || r.status === 429) setAutoCheck(false);
      return;
    }
    const fresh = r.data;
    const statusChanged = fresh.status !== request.status;
    const timeChanged = fresh.requested_slot_start !== request.requested_slot_start;
    if (!statusChanged && !timeChanged) return;
    setRequest(fresh);
    setError(false);
    setMessage(
      statusChanged
        ? `Update: your request is now “${STATUS_LABELS[fresh.status]}”.${timeChanged ? " The time has changed too, so check the new date and time below." : ""}`
        : "Update: a practitioner changed your appointment time. Check the new date and time below.",
    );
  }
  // Checks run only for a request that can still change (Pending or Confirmed), not in the
  // development preview, and not while a lookup or a cancel is running.
  const autoChecking =
    !preview &&
    autoCheck &&
    request !== null &&
    (request.status === "PENDING" || request.status === "CONFIRMED");
  useAutoRefresh(checkForChanges, STUDENT_REFRESH_MS, autoChecking && !busy);
  // Layout: title, emergency contacts, the key form, a message line, the result card, and the cancel dialog.
  // The key box has autoComplete="off" and spellCheck={false}: the browser does not save or check the key.
  // Cancel is offered only for Pending or Confirmed requests, and always asks for confirmation first.
  return (
    <div className="requests-page mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="display-heading text-4xl sm:text-5xl">
          Track your private request
        </h1>
        <p className="mt-3 text-base-content/70">
          Your access key is all you need. No student account or sign-in.
        </p>
      </div>
      <EmergencyBanner />
      <form
        className="card card-border gap-4 p-5 sm:p-8"
        onSubmit={(e) => {
          e.preventDefault();
          void lookup();
        }}
      >
        <label className="block">
          <span className="mb-2 block font-medium">Private Access Key</span>
          <input
            ref={keyInput}
            className="input w-full font-mono uppercase"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="characters"
            placeholder="WB-XXXX-XXXX-XXXX"
            required
            maxLength={64}
            aria-describedby="access-key-help"
            value={key}
            disabled={busy}
            onChange={(e) => {
              version.current++;
              setKey(e.target.value);
              setRequest(null);
              setMessage("");
            }}
          />
        </label>
        <p id="access-key-help" className="text-sm text-base-content/70">
          Enter the key you saved when sending your request. It is not saved automatically, and a lost key cannot be recovered.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            className="btn btn-primary"
            disabled={busy || !key.trim()}
            aria-busy={busy}
          >
            {busy ? "Checking status…" : request ? "Refresh status" : "Check status"}
          </button>
          {(key || request) && <button className="btn" type="button" onClick={clear}>Clear key and details</button>}
        </div>
      </form>
      {message && (
        <p role={error ? "alert" : "status"} className="card p-5">
          {message}
        </p>
      )}
      {request && (
        <section
          ref={resultRef}
          tabIndex={-1}
          className="card tracked-request-card"
          aria-labelledby="tracked-service-name"
        >
          <div className="tracked-request-header">
            <h2 id="tracked-service-name">{services.find(service => service.id === request.service_id)?.name ?? "Counselling appointment"}</h2>
            <span className="tracked-request-status" data-status={request.status}><UiIcon name="status" className="size-4" />{STATUS_LABELS[request.status]}</span>
          </div>
          {/* Date and time are shown in Bangkok time (Asia/Bangkok), whatever the device's time zone. */}
          <div className="tracked-request-schedule">
            <span className="tracked-calendar-icon"><UiIcon name="calendar" className="size-6" /></span>
            <dl><div><dt>{request.status === "PENDING" ? "Requested date" : "Appointment date"}</dt><dd>{new Date(request.requested_slot_start).toLocaleDateString("en-GB", { timeZone: "Asia/Bangkok", weekday: "long", day: "numeric", month: "long", year: "numeric" })}</dd></div><div><dt>Time</dt><dd>{campusTime(request.requested_slot_start)}–{campusTime(request.requested_slot_end)}<span className="tracked-timezone">Bangkok · UTC+7</span></dd></div></dl>
          </div>
          <div className="tracked-status-explanation">
          {request.status === "PENDING" && (
            <p>
              Your chosen time is reserved while a practitioner reviews your
              request. It is not confirmed yet.
            </p>
          )}
          {request.status === "CONFIRMED" && (
            <p>
              Your appointment is confirmed. Check this page again before your
              visit: a practitioner may change the time, and we cannot contact
              you anonymously.
            </p>
          )}
          {request.status === "REJECTED" && (
            <p>
              This request was declined. You can browse services to send a new
              request.
            </p>
          )}
          {request.status === "CANCELLED" && (
            <p>
              This request is cancelled. To request another appointment, start
              again from services.
            </p>
          )}
          {/* Tells the student that this card keeps itself up to date while the page stays open. */}
          {autoChecking && (
            <p className="text-sm text-base-content/70">
              This page checks for updates every {STUDENT_REFRESH_MS / 1000} seconds while it is open.
            </p>
          )}
          </div>
          {request.urgency_level === "URGENT" && (
            <div className="rounded-field border border-error p-4">
              <p className="font-semibold">Urgent concern</p>
              <p className="mt-2">
                Staff cannot contact an anonymous student. Use the emergency
                contacts above if you need help now; do not wait for an
                appointment.
              </p>
            </div>
          )}
          <div className="tracked-request-footer"><p>Your note stays private. Keep your access key safe.</p>
          {["PENDING", "CONFIRMED"].includes(request.status) && (
            <button
              type="button"
              className="tracked-cancel-link"
              disabled={busy}
              onClick={() => dialog.current?.showModal()}
            >
              Cancel request
            </button>
          )}
          {["REJECTED", "CANCELLED"].includes(request.status) && <Link href="/" className="tracking-status-link">Choose another appointment <UiIcon name="arrow" className="size-4" /></Link>}
          </div>
        </section>
      )}
      {/* Cancel confirmation dialog. While a cancel is running, Escape cannot close it (onCancel). */}
      <dialog
        ref={dialog}
        className="modal"
        aria-labelledby="cancel-title"
        onCancel={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <div className="modal-box">
          <h2 id="cancel-title" className="text-xl font-semibold">
            Cancel this request?
          </h2>
          <p className="mt-3">
            Your reserved time will be released. This cannot be undone.
          </p>
          {message && error && (
            <p role="alert" className="mt-3">
              {message}
            </p>
          )}
          <div className="modal-action">
            <button
              className="btn"
              disabled={busy}
              onClick={() => dialog.current?.close()}
            >
              Keep request
            </button>
            <button
              className="btn btn-error"
              disabled={busy}
              onClick={() => void cancel()}
            >
              {busy ? "Cancelling…" : "Confirm cancellation"}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
