"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { createRequestPreviewApi } from "@/lib/client/request-preview";
import { UiIcon } from "@/components/UiIcon";
import { BookingTimePicker } from "./BookingTimePicker";
import { StudentRequestCard } from "./StudentRequestCard";
import type { BookingSlot, StudentRequest } from "./types";
import { useRouter } from "next/navigation";

export function RequestsDashboard({ preview = false, previewServiceId, justSent = false }: { preview?: boolean; previewServiceId?: string; justSent?: boolean }) {
  const router = useRouter();
  const requestApi = useMemo(() => preview ? createRequestPreviewApi(previewServiceId) : api, [preview, previewServiceId]);
  const [requests, setRequests] = useState<StudentRequest[] | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [slots, setSlots] = useState<BookingSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [sentMessageVisible, setSentMessageVisible] = useState(justSent);
  const noticeRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    let alive = true;
    requestApi<{ requests: StudentRequest[] }>("/requests/me").then(result => {
      if (!alive) return;
      if (result.status === 401 || result.status === 404) { router.replace("/sign-in?next=/requests"); return; }
      setLoadError(!result.ok);
      if (result.ok) setRequests(result.data?.requests ?? []);
    });
    return () => { alive = false; };
  }, [requestApi, router, refresh]);

  useEffect(() => { if (notice?.error) noticeRef.current?.focus(); }, [notice]);

  const dismissNotice = useCallback(() => setNotice(null), []);

  async function showSlots(id: string) {
    setSentMessageVisible(false);
    setOpenFor(id);
    setSlots([]);
    setSlotsError(false);
    setLoadingSlots(true);
    const result = await requestApi<{ slots: BookingSlot[] }>(`/requests/${id}/slots`);
    setLoadingSlots(false);
    setSlotsError(!result.ok);
    if (result.ok) setSlots(result.data?.slots ?? []);
  }

  async function book(requestId: string, slotId: string) {
    setBusy(true);
    const result = await requestApi<{ slots?: BookingSlot[] }>("/appointments", { method: "POST", body: { requestId, slotId } });
    setBusy(false);
    if (result.ok) {
      setOpenFor(null);
      setNotice({ text: "Your appointment is booked.", error: false });
      setRefresh(value => value + 1);
    } else if (result.error === "slot_taken") {
      setSlots(result.data?.slots ?? []);
      setNotice({ text: "That time was just booked. Choose another available time below.", error: true });
    } else if (result.error === "request_not_bookable") {
      setOpenFor(null);
      setNotice({ text: "This request cannot be booked right now. Its latest status is shown below.", error: true });
      setRefresh(value => value + 1);
    } else setNotice({ text: "We could not book that time. Your appointment has not been confirmed. Please try again.", error: true });
  }

  async function cancel(id: string) {
    setBusy(true);
    const result = await requestApi(`/appointments/${id}/cancel`, { method: "POST" });
    setBusy(false);
    setNotice({ text: result.ok ? "Your appointment is cancelled. No reason needed, no penalty." : "We could not cancel your appointment. It remains booked. Please try again.", error: !result.ok });
    if (result.ok) setRefresh(value => value + 1);
    return result.ok;
  }

  return <div className="requests-page mx-auto max-w-4xl space-y-6 sm:space-y-8">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="display-heading text-4xl sm:text-5xl">My requests</h1><p className="mt-3 max-w-xl text-base-content/70">A quiet place to check your progress and manage your appointments.</p></div><Link href="/" className="btn">Explore services <UiIcon name="arrow" className="size-4" /></Link></div>
    <section className="booking-scene request-glass card card-border" aria-label="Campus wellbeing appointments"><div><h2 className="text-2xl font-semibold tracking-tight">Support that fits your student life.</h2><p>Follow your campus service request and choose an appointment after practitioner review.</p></div></section>
    {preview && <p className="request-note rounded-field p-4 text-sm text-base-content/70">UI preview uses fictional records. These interactions do not book or cancel a real appointment. Refresh to reset.</p>}
    {(notice?.error || sentMessageVisible) && <p ref={noticeRef} tabIndex={-1} role={notice?.error ? "alert" : "status"} className={notice?.error ? "alert alert-error block p-4" : "request-glass alert block p-4 font-medium"}>{notice?.error ? notice.text : "Your request was sent privately. You can book a time once a practitioner has opened it."}</p>}
    {notice && !notice.error && <BookingToast key={notice.text} text={notice.text} onDismiss={dismissNotice} />}
    {loadError && <div role="alert" className="request-glass space-y-3 p-5"><p>We could not load your requests. Please try again.</p><button type="button" className="btn" onClick={() => setRefresh(value => value + 1)}>Retry loading requests</button></div>}
    {!requests && !loadError && <div role="status" aria-label="Loading requests" aria-busy="true" className="space-y-4"><div className="skeleton h-48 w-full" /><div className="skeleton h-24 w-full" /></div>}
    {requests?.length === 0 && <section className="request-glass card card-border p-6"><h2 className="text-xl font-semibold">No requests yet</h2><p className="mt-2 text-sm text-base-content/70">Explore campus services and send a private request when you’re ready.</p><Link href="/" className="btn btn-primary mt-4 self-start">Find your support</Link></section>}
    <div className="space-y-5">{requests?.map(request => <StudentRequestCard key={request.id} request={request} busy={busy} onCancel={cancel}>
      {request.bookable && <div className="mt-5 border-t border-base-300 pt-5"><button type="button" className={`btn w-full sm:w-auto ${openFor === request.id ? "btn-ghost" : "btn-primary"}`} disabled={busy || loadingSlots} aria-expanded={openFor === request.id} aria-controls={`slots-${request.id}`} onClick={() => openFor === request.id ? setOpenFor(null) : void showSlots(request.id)}>{openFor === request.id ? "Hide available times" : "Choose a time"}</button>
        {openFor === request.id && <div id={`slots-${request.id}`} className="booking-stage mt-5 min-w-0">{loadingSlots ? <div className="skeleton h-40 w-full" role="status" aria-label="Loading appointment times" /> : slotsError ? <div role="alert" className="space-y-3"><p>We could not load available times.</p><button type="button" className="btn" onClick={() => void showSlots(request.id)}>Retry loading times</button></div> : <BookingTimePicker slots={slots} busy={busy} onConfirm={id => void book(request.id, id)} />}</div>}
      </div>}
    </StudentRequestCard>)}</div>
    <aside className="request-glass card card-border p-5 sm:p-8"><h2 className="font-semibold">Your details stay private</h2><p className="mt-2 max-w-prose text-sm text-base-content/70">Request content is not repeated on this dashboard. Only the practitioners of your chosen service can read it.</p></aside>
  </div>;
}

function BookingToast({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const fadeTimer = setTimeout(() => setLeaving(true), 4840);
    const removeTimer = setTimeout(onDismiss, 5000);
    return () => { clearTimeout(fadeTimer); clearTimeout(removeTimer); if (dismissTimer.current) clearTimeout(dismissTimer.current); };
  }, [onDismiss]);
  function dismiss() {
    setLeaving(true);
    dismissTimer.current = setTimeout(onDismiss, 160);
  }
  return <div data-leaving={leaving} className="booking-toast toast toast-end toast-bottom bottom-6 right-4 z-50 max-w-[calc(100vw-2rem)] sm:right-6"><div className="request-glass alert flex items-center gap-3 p-4" role="status"><svg aria-hidden="true" className="size-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m5 12 4 4L19 6" /></svg><span className="text-sm font-medium">{text}</span><button type="button" className="btn btn-ghost btn-square shrink-0 border-0" aria-label="Dismiss notification" disabled={leaving} onClick={dismiss}><UiIcon name="close" /></button></div></div>;
}
