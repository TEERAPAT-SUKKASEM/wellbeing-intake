"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AppointmentSummary } from "@/components/AppointmentSummary";
import { STATUS_SHORT, ACUTE_LEVEL_ID, triageShort } from "@/lib/triage";
import type { StudentRequest } from "./types";
import { bookingDateLabel, bookingTimeLabel } from "@/lib/client/booking-dates";

export function StudentRequestCard({ request, busy, onCancel, children }: { request: StudentRequest; busy: boolean; onCancel: (id: string) => Promise<boolean>; children?: ReactNode }) {
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const appointment = request.appointment;
  const confirmationRef = useRef<HTMLParagraphElement>(null);
  const previousAppointmentId = useRef(appointment?.id ?? null);
  useEffect(() => {
    const id = appointment?.id ?? null;
    if (id !== previousAppointmentId.current) confirmationRef.current?.focus();
    previousAppointmentId.current = id;
  }, [appointment?.id]);
  const urgent = request.triageLevelId === ACUTE_LEVEL_ID;
  const status = appointment ? "Appointment booked" : urgent && request.status !== "closed" ? "Needs direct follow-up" : request.bookable ? "In review" : request.status === "handled" ? "No active appointment" : STATUS_SHORT[request.status] ?? request.status;
  const statusTone = appointment ? "badge-success" : urgent && request.status !== "closed" ? "badge-error" : ["handled", "closed"].includes(request.status) ? "badge-neutral" : "badge-info";
  return <section aria-labelledby={`request-${request.id}`} className="request-glass appointment-card card card-border p-5 sm:p-8">
    {!urgent && ["submitted", "in_review", "handled"].includes(request.status) && <div className="mb-6 border-b border-base-300 pb-5"><p className="mb-4 text-sm font-medium">Request progress</p><ol aria-label="Request progress" className="steps steps-vertical w-full text-sm sm:steps-horizontal"><li className="step step-neutral">Request sent</li><li className={`step ${request.status !== "submitted" ? "step-neutral" : ""}`}>Reviewed</li><li className={`step ${appointment ? "step-neutral" : ""}`}>Appointment</li></ol><p className="mt-3 text-xs text-base-content/70">Sent {new Date(request.submittedAt).toLocaleString("en-GB")}</p></div>}
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id={`request-${request.id}`} className="text-2xl font-semibold tracking-tight">{request.serviceName}</h2><p className="mt-2 text-xs text-base-content/70">Reference: {request.id.slice(0, 8)} · Urgency: {triageShort(request.triageLevelId)}</p></div><p className={`request-status badge badge-outline badge-lg h-auto max-w-full gap-2 whitespace-normal px-3 py-2 text-sm font-semibold leading-snug ${statusTone}`}><span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-current" /><span><span className="sr-only">Status: </span>{status}</span></p></div>
    <p ref={confirmationRef} tabIndex={-1} className="mt-4 max-w-xl text-sm text-base-content/70">{appointment ? "Your appointment is booked. Check the details below." : urgent ? "Staff follow urgent requests up directly. This request cannot be booked through the app." : request.bookable ? "A practitioner has opened your request. You can now choose an appointment time." : request.status === "submitted" ? "Your request is waiting for a practitioner to review it. Available times will appear here when it is ready to book." : request.status === "handled" ? "This request has been handled and has no active appointment. Start a new request if you need another appointment." : "Check your request status here. You can explore services if you need further support."}</p>
    {urgent && request.status !== "closed" && <p role="alert" className="alert alert-error alert-soft mt-4 block">If you need help now, please use the <Link className="font-semibold underline" href="/emergency">emergency contacts</Link>. Do not wait for a response in this app.</p>}
    {appointment && <div className="booking-confirmed mt-6 border-t border-base-300 pt-5">
      <AppointmentSummary date={appointment.startAt ? bookingDateLabel(appointment.startAt) : "Appointment confirmed"} time={appointment.startAt ? bookingTimeLabel(appointment.startAt) : undefined} />
      <div className="mt-5 border-t border-base-300 pt-4">{confirming ? <div className="space-y-3"><h3 className="font-semibold">Cancel this appointment?</h3><p className="text-sm text-base-content/70">No reason needed, no penalty. This will release your appointment time.</p><div className="flex flex-col gap-2 sm:flex-row"><button type="button" disabled={busy} className="btn" onClick={() => { setConfirming(false); requestAnimationFrame(() => cancelRef.current?.focus()); }}>Keep appointment</button><button type="button" disabled={busy} className="btn btn-error" onClick={async () => { if (await onCancel(appointment.id)) setConfirming(false); }}>{busy ? "Cancelling…" : "Yes, cancel appointment"}</button></div></div> : <><p className="text-sm text-base-content/70">Plans changed? You can cancel without giving a reason.</p><button ref={cancelRef} type="button" disabled={busy} className="btn mt-3" onClick={() => setConfirming(true)}>Cancel appointment</button></>}</div>
    </div>}
    {!appointment && children}
    {!appointment && !urgent && ["handled", "closed"].includes(request.status) && <Link href="/" className="btn mt-5 self-start">Start a new request</Link>}
  </section>;
}
