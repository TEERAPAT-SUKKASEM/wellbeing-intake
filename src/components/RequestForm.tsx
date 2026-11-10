// What this component shows: the anonymous booking form for one service: choose a date and time,
// an optional alias, a note, Routine or Urgent, and an optional AI urgency check. After sending,
// it shows the receipt with the Private Access Key.
// Used on: the booking page (/request/new?service=<service ID>).
// Talks to: GET /api/v1/services, GET /api/v1/slots (through SlotSelector),
// POST /api/v1/triage/assess (only after AI consent) and POST /api/v1/requests (with an Idempotency-Key).
// Preview mode uses fictional in-memory data instead.
// Note: no name, email or student ID is asked for. The note goes to the AI only if the student agrees.
//
// How this component is organised:
// 1. State: the loaded services, the form fields, the AI check, and the submit status.
// 2. An effect that loads the services, and one that moves focus to a new error message.
// 3. assess(): the optional AI urgency check. submit(): sends the request safely (no double submit,
//    same Idempotency-Key on retry).
// 4. Early returns for load error, loading, unknown service, and the receipt after success.
// 5. The form markup, then the "Urgent support" dialog.
"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { sampleGuidance, studentApi } from "@/lib/client/booking-preview";
import {
  campusDateTime,
  errorMessage,
  type Assessment,
  type Receipt,
  type Service,
  type Urgency,
} from "@/lib/client/contracts";
import { SlotSelector } from "./SlotSelector";
import { SafetyGuidance } from "./SafetyGuidance";
import { RequestReceipt } from "./RequestReceipt";
import { UiIcon } from "./UiIcon";

// When the server rejects some fields (400 validation_failed), it returns their names.
// This maps each name to plain words for the "Check: ..." line under the error.
const fieldLabels: Record<string, string> = {
  service_id: "service",
  alias: "alias",
  intake_note: "your note",
  manual_urgency: "urgency",
  requested_slot_start: "appointment time",
  ai_opt_in: "AI consent",
  "Idempotency-Key": "submission — refresh before trying again",
};

export function RequestForm({ preview = false }: { preview?: boolean }) {
  // The service ID comes from the URL, for example /request/new?service=srv_academic_stress.
  const serviceId = useSearchParams().get("service") ?? "";
  // Services list: null while loading. reload is a counter for the "Retry" button.
  const [services, setServices] = useState<Service[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  // slot: the chosen start time (ISO text) or "". slotRefresh: increased to make SlotSelector reload.
  const [slot, setSlot] = useState("");
  const [slotRefresh, setSlotRefresh] = useState(0);
  // The form fields. Urgency starts as Routine; the student's own choice is always sent.
  const [alias, setAlias] = useState("");
  const [note, setNote] = useState("");
  const [urgency, setUrgency] = useState<Urgency>("ROUTINE");
  // The optional AI check: consent checkbox, its result, "checking" status, and AI failure.
  const [consent, setConsent] = useState(false);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [assessing, setAssessing] = useState(false);
  const [aiError, setAiError] = useState(false);
  // Submit status: busy while sending, the error text, the fields the server rejected,
  // and the receipt (with the access key) after success.
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<string[]>([]);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  // submission keeps the Idempotency-Key and the exact body of the current request,
  // so a retry sends the same thing and the server returns the same request, not a second one.
  // locked stops a double click from sending twice (a ref changes at once, before React re-renders).
  // uncertain is true when we do not know if the server saved the request (network error or 5xx).
  const submission = useRef<{ key: string; body: unknown } | null>(null);
  const locked = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  // errorRef: the error message gets focus. assessmentVersion: ignores an old AI answer.
  // urgentDialog and urgentTrigger: the "Urgent support" dialog and the element to focus after it closes.
  const errorRef = useRef<HTMLParagraphElement>(null);
  const assessmentVersion = useRef(0);
  const urgentDialog = useRef<HTMLDialogElement>(null);
  const urgentTrigger = useRef<HTMLElement | null>(null);
  // Open the "Urgent support" dialog and remember what opened it, so focus can go back there.
  function showUrgentGuidance(trigger: HTMLElement) {
    urgentTrigger.current = trigger;
    urgentDialog.current?.showModal();
  }
  // Load the services to find the one in the URL. "alive" ignores a late answer after unmount.
  useEffect(() => {
    let alive = true;
    studentApi(preview)<Service[]>("/services").then((r) => {
      if (alive) {
        setLoadError(!r.ok);
        if (r.ok) setServices(r.data ?? []);
      }
    });
    return () => {
      alive = false;
    };
  }, [preview, reload]);
  // When a new error appears, move keyboard focus to it, so screen reader users hear it at once.
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  // Only active services are returned, so an inactive or wrong ID gives undefined here.
  const service = services?.find((s) => s.id === serviceId);
  // Optional AI urgency check. It runs only after the student ticks the consent box.
  async function assess() {
    // Remember the button that was pressed, so focus can go back to it after the urgent dialog.
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Each check gets a number. If the note or consent changes while we wait, the number changes
    // and this answer is ignored.
    const version = ++assessmentVersion.current;
    setAssessing(true);
    setAiError(false);
    // Preview mode does not call the server; it shows the fixed fallback guidance.
    const r = preview
      ? { ok: true, data: sampleGuidance(urgency === "URGENT") }
      : await api<Assessment>("/triage/assess", {
          method: "POST",
          body: { intake_note: note.trim() },
        });
    if (version !== assessmentVersion.current) return;
    setAssessing(false);
    setAssessment(r.ok ? r.data : null);
    setAiError(!r.ok);
    // If the AI suggests Urgent, open the "Urgent support" dialog with emergency numbers right away.
    // An AI failure never blocks sending: the student's manual choice is still used.
    if (r.ok && r.data?.urgency_level === "URGENT" && trigger) showUrgentGuidance(trigger);
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Double-submit lock: ignore the click if a send is running or the request was already received.
    if (locked.current || receipt) return;
    // A time and a note are required. (On an uncertain retry the saved body is sent as it is.)
    if (!uncertain && (!slot || !note.trim())) {
      setError(
        "Choose an available time and tell us what you would like help with.",
      );
      return;
    }
    locked.current = true;
    setBusy(true);
    setError("");
    setFields([]);
    // Make a new Idempotency-Key (a random UUID) and freeze the body only for a new submission.
    // On a retry after an unknown outcome, the old key and body are reused.
    // Only an optional alias is sent: no name, email or student ID.
    if (!submission.current)
      submission.current = {
        key: crypto.randomUUID(),
        body: {
          service_id: serviceId,
          alias: alias.trim() || null,
          intake_note: note.trim(),
          manual_urgency: urgency,
          requested_slot_start: slot,
          ai_opt_in: consent,
        },
      };
    const r = await studentApi(preview)<Receipt>("/requests", {
      method: "POST",
      body: submission.current.body,
      headers: { "Idempotency-Key": submission.current.key },
    });
    locked.current = false;
    setBusy(false);
    // Success (201, or 200 for a retry with the same key): show the receipt with the access key.
    if (r.ok && r.data) {
      setUncertain(false);
      setReceipt(r.data);
      return;
    }
    // Unknown outcomes retry the identical body and key before allowing edits.
    // Status 0 = network error, 5xx = server error, or a success with no data: it may or may not be saved.
    // While "uncertain", the form fields are locked and the button says "Retry the same request".
    // A clear rejection (400, 409, 429) forgets the saved body, so the student can edit and try again.
    const unknown = r.status === 0 || r.status >= 500 || r.ok;
    setUncertain(unknown);
    if (!unknown) submission.current = null;
    // 409 slot_unavailable: someone else took this time. Clear the choice and reload the slots.
    if (r.error === "slot_unavailable") {
      setSlot("");
      setSlotRefresh((n) => n + 1);
    }
    // errorMessage() turns codes like too_many_requests (429) into plain words.
    setFields(r.fields ?? []);
    setError(
      unknown
        ? "We could not confirm whether your request was received. Retry the same request below to recover its access key safely."
        : errorMessage(r.error),
    );
  }
  // Early returns: a load error with Retry, a loading skeleton, a "service not available" message,
  // and the receipt after a successful send.
  if (loadError)
    return (
      <div className="card gap-3 p-6" role="alert">
        <p>We could not load the service.</p>
        <button
          className="btn self-start"
          onClick={() => {
            setLoadError(false);
            setReload((n) => n + 1);
          }}
        >
          Retry
        </button>
      </div>
    );
  if (!services)
    return (
      <div
        className="skeleton h-40 w-full"
        role="status"
        aria-label="Loading service"
      />
    );
  if (!service)
    return (
      <div className="card gap-3 p-6">
        <p>This service is not available. Please choose an active service.</p>
        <Link href="/" className="btn self-start">
          Browse services
        </Link>
      </div>
    );
  if (receipt) return <RequestReceipt receipt={receipt} />;
  // The form. The inner <fieldset> is disabled while sending or while a retry is uncertain,
  // so the student cannot change the request that may already be saved.
  // Changing the note or the AI consent clears the old AI result, because it no longer matches.
  // Choosing Urgent opens the "Urgent support" dialog with emergency numbers.
  return (
    <div className="intake-layout">
      <form
        onSubmit={submit}
        className="intake-form card card-border min-w-0 gap-6"
      >
        <h2 className="text-2xl font-semibold">{service.name}</h2>
        <p className="text-sm text-base-content/70">Save the access key after submitting to check or cancel your request. Staff cannot contact you anonymously.</p>
        {error && (
          <p ref={errorRef} tabIndex={-1} role="alert" className="alert block">
            {error}
            {fields.length > 0 && (
              <span className="mt-2 block">
                Check:{" "}
                {fields
                  .map((field) => fieldLabels[field] ?? "form details")
                  .join(", ")}
              </span>
            )}
          </p>
        )}
        <fieldset disabled={busy || uncertain} className="min-w-0 space-y-6">
          <SlotSelector
            key={serviceId}
            serviceId={serviceId}
            value={slot}
            onChange={setSlot}
            preview={preview}
            refresh={slotRefresh}
          />
          <label className="block">
            <span className="mb-2 block font-medium">
              Alias or nickname{" "}
              <span className="font-normal text-base-content/70">
                (optional)
              </span>
            </span>
            <input
              className="input w-full"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              maxLength={40}
              autoComplete="off"
            />
          </label>
          <label className="block">
            <span className="mb-2 block font-medium">
              What would you like help with? <span className="font-normal text-base-content/70">(required)</span>
            </span>
            <textarea
              className="textarea min-h-32 w-full"
              required
              maxLength={2000}
              value={note}
              aria-invalid={fields.includes("intake_note")}
              onChange={(e) => {
                setNote(e.target.value);
                setAssessment(null);
                setAiError(false);
                assessmentVersion.current++;
                setAssessing(false);
              }}
            />
            <span className="mt-2 block text-sm text-base-content/70">
              {note.length}/2000 characters. Avoid names, emails, or student ID
              numbers.
            </span>
          </label>
          <fieldset>
            <legend className="mb-3 font-medium">
              How urgent does this feel?
            </legend>
            <div className="flex flex-wrap gap-5">
              {/* Choosing Urgent opens the urgent dialog. Clicking Urgent again reopens it. */}
              {(["ROUTINE", "URGENT"] as const).map((value) => (
                <label
                  className="flex min-h-11 cursor-pointer items-center gap-3"
                  key={value}
                >
                  <input
                    type="radio"
                    name="urgency"
                    className="radio"
                    checked={urgency === value}
                    onChange={(event) => {
                      setUrgency(value);
                      if (value === "URGENT") showUrgentGuidance(event.currentTarget);
                    }}
                    onClick={(event) => {
                      if (value === "URGENT" && urgency === "URGENT") showUrgentGuidance(event.currentTarget);
                    }}
                  />
                  {value === "URGENT" ? "Urgent" : "Routine"}
                </label>
              ))}
            </div>
            <p className="mt-2 text-sm text-base-content/70">
              Your Urgent choice is always respected. An appointment is not
              immediate crisis support.
            </p>
          </fieldset>

          <details className="optional-assessment">
            <summary>Optional AI urgency check{consent ? " · Enabled" : ""}</summary>
            <div className="space-y-3 pt-4">
            <p className="text-sm text-base-content/70">
              With your permission, your note is sent to an external AI provider
              to suggest Routine or Urgent. You can submit without AI. This is
              not a diagnosis.
            </p>
            <label className="flex min-h-11 items-start gap-3">
              <input
                className="checkbox mt-1"
                type="checkbox"
                checked={consent}
                onChange={(e) => {
                  setConsent(e.target.checked);
                  setAssessment(null);
                  assessmentVersion.current++;
                  setAssessing(false);
                }}
              />
              <span>I agree to send my note for AI assessment.</span>
            </label>
            <button
              className="btn"
              type="button"
              disabled={!consent || !note.trim() || assessing}
              onClick={() => void assess()}
            >
              {assessing ? "Checking urgency…" : "Check with AI"}
            </button>
            {aiError && (
              <p role="status" className="text-sm">
                AI is unavailable. Your manual choice and the automatic safety
                checks still work; you can submit now.
              </p>
            )}
            {/* An Urgent AI result is shown in the urgent dialog, so here only Routine guidance shows. */}
            {assessment && (
              <>
                <p className="text-sm">
                  {assessment.triage_mode === "DETERMINISTIC_FALLBACK"
                    ? "AI was not used. The safety fallback was applied."
                    : "AI suggestion only. Your final urgency is checked on submission."}
                </p>
                {assessment.urgency_level !== "URGENT" && <SafetyGuidance result={assessment} />}
              </>
            )}
            </div>
          </details>
        </fieldset>
        {slot && (
          <p className="rounded-field bg-base-200 p-4 text-sm">
            Requesting <strong>{campusDateTime(slot)}</strong> (Bangkok), for{" "}
            {service.duration_minutes} minutes. A practitioner will review this
            time.
          </p>
        )}
        {/* Disabled while sending, or until a time and a note are given. */}
        {/* After an unknown result it says "Retry the same request": same body, same Idempotency-Key. */}
        <button
          type="submit"
          disabled={busy || (!uncertain && (!slot || !note.trim()))}
          aria-busy={busy}
          className="btn btn-primary w-full"
        >
          {busy
            ? "Sending private request…"
            : uncertain
              ? "Retry the same request"
              : "Send private request"}
        </button>
        {!busy && !uncertain && (!slot || !note.trim()) && <p role="status" className="form-next-action">{!slot ? "Choose an available appointment time to continue." : "Add a short note above to send your request."}</p>}
      </form>
          {/* "Urgent support" dialog: the AI's urgent guidance, or fixed guidance for a manual Urgent. */}
          {/* Clicking the backdrop closes it. On close, focus goes back to what opened it. */}
          <dialog ref={urgentDialog} className="modal urgent-guidance-dialog" aria-labelledby="urgent-guidance-title" onClick={(event) => { if (event.target === event.currentTarget) urgentDialog.current?.close(); }} onClose={() => urgentTrigger.current?.focus({ preventScroll: true })}>
            <div className="modal-box urgent-guidance-panel">
              <div className="urgent-guidance-heading"><h2 id="urgent-guidance-title">Urgent support</h2><button type="button" className="btn btn-ghost btn-square" aria-label="Close urgent support" onClick={() => urgentDialog.current?.close()}><UiIcon name="close" /></button></div>
              <SafetyGuidance result={assessment?.urgency_level === "URGENT" ? assessment : sampleGuidance(true)} />
            </div>
          </dialog>
    </div>
  );
}
