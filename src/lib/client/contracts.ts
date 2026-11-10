// What this helper does: shared data types, status labels and date/time helpers for the browser screens.
// Talks to: no API calls.
// Note: times are always shown in campus time (Asia/Bangkok, UTC+7), whatever the viewer's time zone.
// Browser types mirror openapi.yaml. Never import database modules here.
/** A counselling service, as returned by GET /services. */
export type Service = {
  id: string;
  name: string;
  description: string;
  duration_minutes: number;
  is_active: boolean;
};
/** One start time from GET /slots. The public only sees available or not, never who booked it. */
export type Slot = {
  slot_start: string;
  slot_end: string;
  is_available: boolean;
};
export type Urgency = "ROUTINE" | "URGENT";
export type RequestStatus = "PENDING" | "CONFIRMED" | "REJECTED" | "CANCELLED";
/** Safety text and emergency phone links that come with every urgency result. */
export type Guidance = {
  disclaimer: string;
  emergency_links: {
    name: string;
    detail: string;
    phone: string;
    href: string;
  }[];
};
/** Urgency result: ROUTINE or URGENT, and whether the AI or the keyword fallback decided it. */
export type Assessment = Guidance & {
  urgency_level: Urgency;
  triage_mode: "AI_ASSISTED" | "DETERMINISTIC_FALLBACK";
};
/** The answer to POST /requests. It is the only answer that ever contains the access key. */
export type Receipt = Assessment & {
  id: string;
  access_key: string;
  status: RequestStatus;
  requested_slot_start: string;
  requested_slot_end: string;
  privacy_buffer_end: string;
};
/**
 * A stored request, as returned by GET /requests/me and the staff endpoints.
 * It is a Receipt without the safety guidance and WITHOUT the access key, plus service, alias and note.
 */
export type AppointmentRequest = Omit<
  Receipt,
  keyof Guidance | "access_key"
> & { service_id: string; alias: string | null; intake_note: string };
/** Weekly opening hours for the admin page. weekday 0 is Sunday; times are campus times. */
export type Availability = {
  windows: { weekday: number; start_time: string; end_time: string }[];
};
/** A Helpdesk referral's status: waiting for review, or the final decision. */
export type ReferralStatus = "received" | "approved" | "declined";
/**
 * A referral from Team 14's Helpdesk, as returned by GET /practitioner/referrals. It holds only a random
 * reference, the service (or null), when the student consented, and our own timestamps (ISO, UTC).
 */
export type Referral = {
  ref: string;
  service_id: string | null;
  consent_at: string;
  status: ReferralStatus;
  received_at: string;
  decided_at: string | null;
};
/** Plain words for each status, shown to students and staff. */
export const STATUS_LABELS: Record<RequestStatus, string> = {
  PENDING: "Awaiting approval",
  CONFIRMED: "Confirmed",
  REJECTED: "Declined",
  CANCELLED: "Cancelled",
};
/** Plain words for each Helpdesk referral status, shown to staff. */
export const REFERRAL_STATUS_LABELS: Record<ReferralStatus, string> = {
  received: "Waiting for review",
  approved: "Accepted",
  declined: "Declined",
};
/**
 * The campus date (YYYY-MM-DD) for a moment, today by default. Bangkok is always UTC+7 with no
 * daylight saving, so adding 7 hours to UTC and keeping the date part gives the campus date.
 */
export const campusDate = (value = new Date()): string =>
  new Date(value.getTime() + 7 * 3600000).toISOString().slice(0, 10);
/** Adds days to a YYYY-MM-DD date. Working at 12:00 UTC keeps the maths far from midnight problems. */
export const addDays = (date: string, days: number): string =>
  new Date(new Date(`${date}T12:00:00Z`).getTime() + days * 86400000)
    .toISOString()
    .slice(0, 10);
/** Shows only the time (24-hour HH:MM) in campus time. */
export const campusTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
  });
/** Shows weekday, date, year and time in campus time, for example on the booking and staff screens. */
export const campusDateTime = (iso: string): string =>
  new Date(iso).toLocaleString("en-GB", {
    timeZone: "Asia/Bangkok",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
// In-memory navigation only. Never put a key in a URL or persist it automatically.
// Why: URLs are kept in browser history, server logs and shared links, and saved storage stays
// on a shared computer. This variable lives only while the tab is open; a refresh empties it.
let navigationKey = "";
/** Hands the key from the booking confirmation to the tracking page. Pass "" to forget it. */
export function setNavigationKey(key: string) {
  navigationKey = key;
}
/** Reads the key handed over by the booking confirmation ("" if there is none). */
export function getNavigationKey() {
  return navigationKey;
}
/** Turns an API error code into a plain sentence for the user. Unknown codes get a general message. */
export function errorMessage(error: string | null): string {
  if (error === "too_many_requests")
    return "Too many attempts. Please wait a few minutes and try again.";
  if (error === "slot_unavailable")
    return "That time is no longer available. Choose another available time.";
  if (error === "invalid_transition")
    return "This request has changed. Refresh to see its latest status.";
  // too_late: the cancel endpoint refuses once the session has started (409 too_late).
  if (error === "too_late")
    return "This appointment has already started, so it can no longer be cancelled.";
  if (error === "validation_failed")
    return "Please check the form fields and try again.";
  return "We could not complete that action. Check your connection and try again.";
}
