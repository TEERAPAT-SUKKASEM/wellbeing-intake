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
  const serviceId = useSearchParams().get("service") ?? "";
  const [services, setServices] = useState<Service[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [slot, setSlot] = useState("");
  const [slotRefresh, setSlotRefresh] = useState(0);
  const [alias, setAlias] = useState("");
  const [note, setNote] = useState("");
  const [urgency, setUrgency] = useState<Urgency>("ROUTINE");
  const [consent, setConsent] = useState(false);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [assessing, setAssessing] = useState(false);
  const [aiError, setAiError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<string[]>([]);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const submission = useRef<{ key: string; body: unknown } | null>(null);
  const locked = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const assessmentVersion = useRef(0);
  const urgentDialog = useRef<HTMLDialogElement>(null);
  const urgentTrigger = useRef<HTMLElement | null>(null);
  function showUrgentGuidance(trigger: HTMLElement) {
    urgentTrigger.current = trigger;
    urgentDialog.current?.showModal();
  }
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
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  const service = services?.find((s) => s.id === serviceId);
  async function assess() {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const version = ++assessmentVersion.current;
    setAssessing(true);
    setAiError(false);
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
    if (r.ok && r.data?.urgency_level === "URGENT" && trigger) showUrgentGuidance(trigger);
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (locked.current || receipt) return;
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
    if (r.ok && r.data) {
      setUncertain(false);
      setReceipt(r.data);
      return;
    }
    // Unknown outcomes retry the identical body and key before allowing edits.
    const unknown = r.status === 0 || r.status >= 500 || r.ok;
    setUncertain(unknown);
    if (!unknown) submission.current = null;
    if (r.error === "slot_unavailable") {
      setSlot("");
      setSlotRefresh((n) => n + 1);
    }
    setFields(r.fields ?? []);
    setError(
      unknown
        ? "We could not confirm whether your request was received. Retry the same request below to recover its access key safely."
        : errorMessage(r.error),
    );
  }
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
          <dialog ref={urgentDialog} className="modal urgent-guidance-dialog" aria-labelledby="urgent-guidance-title" onClick={(event) => { if (event.target === event.currentTarget) urgentDialog.current?.close(); }} onClose={() => urgentTrigger.current?.focus({ preventScroll: true })}>
            <div className="modal-box urgent-guidance-panel">
              <div className="urgent-guidance-heading"><h2 id="urgent-guidance-title">Urgent support</h2><button type="button" className="btn btn-ghost btn-square" aria-label="Close urgent support" onClick={() => urgentDialog.current?.close()}><UiIcon name="close" /></button></div>
              <SafetyGuidance result={assessment?.urgency_level === "URGENT" ? assessment : sampleGuidance(true)} />
            </div>
          </dialog>
    </div>
  );
}
