"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { studentApi } from "@/lib/client/booking-preview";
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

export function RequestsDashboard({
  preview = false,
}: {
  preview?: boolean;
  previewServiceId?: string;
  justSent?: boolean;
}) {
  const [key, setKey] = useState(getNavigationKey);
  const [activeKey, setActiveKey] = useState("");
  const [request, setRequest] = useState<AppointmentRequest | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  useEffect(() => {
    let alive = true;
    studentApi(preview)<Service[]>("/services").then(result => {
      if (alive && result.ok) setServices(result.data ?? []);
    });
    return () => { alive = false; };
  }, [preview]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  const keyInput = useRef<HTMLInputElement>(null);
  const version = useRef(0);
  async function lookup() {
    const attempt = ++version.current;
    setBusy(true);
    setMessage("");
    setRequest(null);
    const normalized = key.trim().toUpperCase();
    const r = await studentApi(preview)<AppointmentRequest>("/requests/me", {
      headers: { "X-Access-Key": normalized },
    });
    if (attempt !== version.current) return;
    setBusy(false);
    setError(!r.ok);
    if (r.ok && r.data) {
      setRequest(r.data);
      setActiveKey(normalized);
      requestAnimationFrame(() => resultRef.current?.focus());
    } else
      setMessage(
        r.status === 404
          ? "We couldn’t find a request with that key. Check your saved key and try again."
          : errorMessage(r.error),
      );
  }
  async function cancel() {
    if (!request || busy) return;
    setBusy(true);
    setMessage("");
    const r = await studentApi(preview)(
      `/requests/${encodeURIComponent(request.id)}/cancel`,
      { method: "POST", body: { access_key: activeKey } },
    );
    setBusy(false);
    setError(!r.ok);
    if (r.ok) {
      setRequest({ ...request, status: "CANCELLED" });
      dialog.current?.close();
      requestAnimationFrame(() => resultRef.current?.focus());
      setMessage(
        "Your request is cancelled. The appointment time and privacy buffer have been released.",
      );
    } else setMessage(errorMessage(r.error));
  }
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
