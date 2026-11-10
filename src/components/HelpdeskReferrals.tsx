// What this component shows: the "Helpdesk referrals" list. Each referral from Team 14's Helpdesk shows
// the service, when the student consented, when it arrived, its status and a shortened reference.
// Referrals waiting for review have Accept and Decline buttons, each confirmed in a dialog first.
// Used on: /practitioner, in the "Helpdesk referrals" tab of PractitionerDesk (only when the feature is on).
// Talks to: GET /api/v1/practitioner/referrals, GET /api/v1/services (for the service names) and
// PATCH /api/v1/practitioner/referrals/{ref} with { status: "approved" | "declined" }.
// Note: a referral holds no name, email, student ID or ticket text, and it is never linked to a booking.
// Accepting only tells Helpdesk "accepted"; the student still books anonymously on this site.
// Auto-refresh: while the tab is visible, the list is checked again every 15 seconds (useAutoRefresh),
// so a new referral from Helpdesk appears, and the tab's badge goes up, without pressing Refresh.
"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { STAFF_REFRESH_MS, useAutoRefresh } from "@/lib/client/auto-refresh";
import {
  campusDateTime,
  errorMessage,
  REFERRAL_STATUS_LABELS,
  type Referral,
  type ReferralStatus,
  type Service,
} from "@/lib/client/contracts";

// Badge style for each status. The badge always says the status in words, so colour is not the only cue.
const BADGE_CLASSES: Record<ReferralStatus, string> = {
  received: "badge badge-outline badge-warning",
  approved: "badge badge-outline badge-success",
  declined: "badge badge-ghost",
};

// Shows only the end of a reference: "…" plus its last 6 characters. That is enough to tell
// referrals apart, so the full reference is never shown.
const shortRef = (ref: string): string => `…${ref.slice(-6)}`;

export function HelpdeskReferrals({
  onPendingChange,
}: {
  onPendingChange?: (n: number) => void;
}) {
  const router = useRouter();
  // referrals: null until a load succeeds. services: gives each service_id its name.
  // loading: a load is running. error: the load failed. refresh: a counter; adding 1 loads again.
  const [referrals, setReferrals] = useState<Referral[] | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  // busy: a decision is being saved. message and messageTone: the result shown after a decision.
  // decision: what the confirmation dialog will send, and for which referral.
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "danger">("success");
  const [decision, setDecision] = useState<{
    ref: string;
    status: "approved" | "declined";
  } | null>(null);
  // dialog: the confirmation dialog. heading: gets focus after a decision, because the row's buttons go away.
  // locked: stops a double click from sending the same decision twice.
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const locked = useRef(false);
  // loadVersion: goes up by 1 each time an ordinary load starts, so an older background answer is dropped.
  const loadVersion = useRef(0);
  // Load the referrals and the service names at the same time.
  // 401 = not signed in: go to the sign-in page, then come back here (next=/practitioner).
  // 404 = the feature was switched off. If only the service names fail, the list still shows.
  // "alive" ignores an old answer when a newer load has started.
  useEffect(() => {
    let alive = true;
    loadVersion.current += 1;
    Promise.all([
      api<Referral[]>("/practitioner/referrals"),
      api<Service[]>("/services"),
    ]).then(([r, s]) => {
      if (!alive) return;
      if (r.status === 401) {
        router.replace("/sign-in?next=/practitioner");
        return;
      }
      setLoading(false);
      if (s.ok) setServices(s.data ?? []);
      if (!r.ok) {
        setReferrals(null);
        setError(
          r.status === 404
            ? "Helpdesk referrals are switched off at the moment."
            : "We could not load Helpdesk referrals. Please retry.",
        );
        return;
      }
      setReferrals(r.data ?? []);
      setError("");
    });
    return () => {
      alive = false;
    };
  }, [refresh, router]);
  // How many referrals wait for review. The desk shows this number in the badge on its tab.
  const pending = referrals
    ? referrals.filter((row) => row.status === "received").length
    : null;
  useEffect(() => {
    if (pending !== null) onPendingChange?.(pending);
  }, [pending, onPendingChange]);
  // Auto-refresh: load the list again in the background. No skeleton, no disabled buttons and no error:
  // if a check fails, the last good list stays and the next check tries again. The service names are not
  // asked again, because they rarely change. It is skipped while the confirmation dialog is open, so a
  // row never changes behind a decision, and an answer older than an ordinary load is dropped.
  async function checkForChanges() {
    if (dialog.current?.open) return;
    const version = loadVersion.current;
    const r = await api<Referral[]>("/practitioner/referrals");
    if (version !== loadVersion.current) return;
    // The sign-in ended meanwhile: leave the page, as an ordinary load would.
    if (r.status === 401) {
      router.replace("/sign-in?next=/practitioner");
      return;
    }
    if (r.ok) setReferrals(r.data ?? []);
  }
  // Every 15 seconds while the tab is visible, once the list has loaded. Paused during an ordinary load,
  // after a load error (the Retry button handles that) and while a decision is saving.
  useAutoRefresh(
    checkForChanges,
    STAFF_REFRESH_MS,
    referrals !== null && !loading && !error && !busy,
  );
  // Load again. The list stays on screen meanwhile, with its buttons disabled.
  function reload() {
    setLoading(true);
    setRefresh((n) => n + 1);
  }
  // The service's name from GET /services. null means Helpdesk did not choose a service.
  // A switched-off service is not in that list, so it gets a general text instead.
  function serviceName(id: string | null) {
    if (id === null) return "Not specified";
    return services.find((s) => s.id === id)?.name ?? "Service name unavailable";
  }
  // Accept and Decline first open a confirmation dialog. Nothing is sent yet.
  function confirm(ref: string, status: "approved" | "declined") {
    setDecision({ ref, status });
    dialog.current?.showModal();
  }
  // Send the confirmed decision. The server then tells Helpdesk only the reference and the new status.
  async function decide() {
    if (!decision || locked.current) return;
    locked.current = true;
    setBusy(true);
    setMessage("");
    const r = await api<Referral>(
      `/practitioner/referrals/${encodeURIComponent(decision.ref)}`,
      { method: "PATCH", body: { status: decision.status } },
    );
    locked.current = false;
    setBusy(false);
    dialog.current?.close();
    if (r.status === 401) {
      router.replace("/sign-in?next=/practitioner");
      return;
    }
    const short = shortRef(decision.ref);
    // Any other error leaves the row as it was. Closing the dialog puts focus back on the button
    // that opened it, so the staff member can simply try again.
    if (!r.ok && r.status !== 409 && r.status !== 404) {
      setMessageTone("danger");
      setMessage(errorMessage(r.error));
      return;
    }
    // Success, 409 (someone already decided it) or 404 (the student withdrew it): the row changes
    // or goes away, so move focus to the list heading and load the list again.
    setMessageTone(r.ok && decision.status === "approved" ? "success" : "danger");
    setMessage(
      r.ok
        ? decision.status === "approved"
          ? `Referral ${short} accepted. Helpdesk will be told that it is accepted.`
          : `Referral ${short} declined. Helpdesk will be told that it is declined.`
        : r.status === 409
          ? `Referral ${short} was already decided. The list is refreshed to show its latest status.`
          : `Referral ${short} is no longer available. The student may have withdrawn it.`,
    );
    heading.current?.focus();
    reload();
  }
  // Layout: heading with counts, the privacy note, one live message area, then the list
  // (or its loading, error or empty state), and the confirmation dialog.
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          ref={heading}
          id="referrals-heading"
          tabIndex={-1}
          className="text-2xl font-semibold"
        >
          Referrals from Helpdesk
        </h2>
        {referrals && (
          <p className="text-sm">
            {pending} waiting for review · {referrals.length} in total
          </p>
        )}
      </div>
      <p className="mt-4 text-sm text-base-content/70">
        With the student’s consent, Helpdesk sends only a random reference, the
        chosen service and the time the student consented. Accepting tells
        Helpdesk that the referral is accepted. The student still books
        anonymously on this site, and staff cannot contact them.
      </p>
      {/* Always in the page, so screen readers announce each new message. */}
      <div role="status" aria-live="polite">
        {message && (
          <p className="booking-feedback mt-4" data-tone={messageTone}>
            {message}
          </p>
        )}
      </div>
      {error ? (
        <div role="alert" className="mt-4 space-y-3">
          <p>{error}</p>
          <button
            className="btn"
            onClick={() => {
              setError("");
              reload();
            }}
          >
            Retry loading
          </button>
        </div>
      ) : !referrals ? (
        <div
          className="skeleton mt-4 h-40 w-full"
          role="status"
          aria-label="Loading Helpdesk referrals"
        />
      ) : referrals.length === 0 ? (
        <p className="mt-4">
          No referrals from Helpdesk. Referrals are removed 30 days after they
          arrive.
        </p>
      ) : (
        // The server already sorts the list: waiting for review first, then the newest.
        // A hidden reference gives each Accept and Decline button a unique spoken name.
        <ul
          className="mt-2 divide-y divide-base-300"
          aria-labelledby="referrals-heading"
          aria-busy={loading}
        >
          {referrals.map((row) => (
            <li
              key={row.ref}
              className="flex flex-wrap items-center justify-between gap-3 py-4"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{serviceName(row.service_id)}</h3>
                  <span className={BADGE_CLASSES[row.status]}>
                    {REFERRAL_STATUS_LABELS[row.status]}
                  </span>
                </div>
                <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  <div>
                    <dt className="text-base-content/70">Student consented</dt>
                    <dd>
                      <time dateTime={row.consent_at}>
                        {campusDateTime(row.consent_at)}
                      </time>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-base-content/70">Received</dt>
                    <dd>
                      <time dateTime={row.received_at}>
                        {campusDateTime(row.received_at)}
                      </time>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-base-content/70">Reference</dt>
                    <dd className="font-mono">{shortRef(row.ref)}</dd>
                  </div>
                </dl>
              </div>
              {row.status === "received" && (
                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn btn-neutral"
                    aria-haspopup="dialog"
                    disabled={busy || loading}
                    onClick={() => confirm(row.ref, "approved")}
                  >
                    Accept
                    <span className="sr-only"> referral {shortRef(row.ref)}</span>
                  </button>
                  <button
                    className="btn btn-error btn-outline"
                    aria-haspopup="dialog"
                    disabled={busy || loading}
                    onClick={() => confirm(row.ref, "declined")}
                  >
                    Decline
                    <span className="sr-only"> referral {shortRef(row.ref)}</span>
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {/* Confirmation dialog. While a decision is saving, Escape cannot close it (onCancel). */}
      <dialog
        ref={dialog}
        className="modal"
        aria-labelledby="referral-decision-title"
        onCancel={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <div className="modal-box">
          <h2 id="referral-decision-title" className="text-xl font-semibold">
            {decision?.status === "declined"
              ? "Decline this referral?"
              : "Accept this referral?"}
          </h2>
          <p className="mt-3">
            {decision?.status === "declined"
              ? `Helpdesk will be told that referral ${shortRef(decision.ref)} is declined, and nothing else. This cannot be changed later.`
              : `Helpdesk will be told that referral ${decision ? shortRef(decision.ref) : ""} is accepted, and nothing else. The student still books anonymously on this site. This cannot be changed later.`}
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
              className={`btn ${decision?.status === "declined" ? "btn-error" : "btn-neutral"}`}
              disabled={busy}
              onClick={() => void decide()}
            >
              {busy
                ? "Saving…"
                : decision?.status === "declined"
                  ? "Decline referral"
                  : "Accept referral"}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
