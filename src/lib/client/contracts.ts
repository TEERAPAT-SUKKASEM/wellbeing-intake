// Browser types mirror openapi.yaml. Never import database modules here.
export type Service = {
  id: string;
  name: string;
  description: string;
  duration_minutes: number;
  is_active: boolean;
};
export type Slot = {
  slot_start: string;
  slot_end: string;
  is_available: boolean;
};
export type Urgency = "ROUTINE" | "URGENT";
export type RequestStatus = "PENDING" | "CONFIRMED" | "REJECTED" | "CANCELLED";
export type Guidance = {
  disclaimer: string;
  emergency_links: {
    name: string;
    detail: string;
    phone: string;
    href: string;
  }[];
};
export type Assessment = Guidance & {
  urgency_level: Urgency;
  triage_mode: "AI_ASSISTED" | "DETERMINISTIC_FALLBACK";
};
export type Receipt = Assessment & {
  id: string;
  access_key: string;
  status: RequestStatus;
  requested_slot_start: string;
  requested_slot_end: string;
  privacy_buffer_end: string;
};
export type AppointmentRequest = Omit<
  Receipt,
  keyof Guidance | "access_key"
> & { service_id: string; alias: string | null; intake_note: string };
export type Availability = {
  windows: { weekday: number; start_time: string; end_time: string }[];
};
export const STATUS_LABELS: Record<RequestStatus, string> = {
  PENDING: "Awaiting approval",
  CONFIRMED: "Confirmed",
  REJECTED: "Declined",
  CANCELLED: "Cancelled",
};
export const campusDate = (value = new Date()): string =>
  new Date(value.getTime() + 7 * 3600000).toISOString().slice(0, 10);
export const addDays = (date: string, days: number): string =>
  new Date(new Date(`${date}T12:00:00Z`).getTime() + days * 86400000)
    .toISOString()
    .slice(0, 10);
export const campusTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
  });
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
let navigationKey = "";
export function setNavigationKey(key: string) {
  navigationKey = key;
}
export function getNavigationKey() {
  return navigationKey;
}
export function errorMessage(error: string | null): string {
  if (error === "too_many_requests")
    return "Too many attempts. Please wait a few minutes and try again.";
  if (error === "slot_unavailable")
    return "That time is no longer available. Choose another available time.";
  if (error === "invalid_transition")
    return "This request has changed. Refresh to see its latest status.";
  if (error === "validation_failed")
    return "Please check the form fields and try again.";
  return "We could not complete that action. Check your connection and try again.";
}
