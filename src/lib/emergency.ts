// What this file does: holds the emergency phone numbers and the "this app cannot help right now"
// message.
// Why it exists: a student in crisis must always see real help numbers, even when the database, the AI
// or the whole API is down, so they are plain text in the code and not data.
// Used by: the /emergency page, the EmergencyBanner component, the urgent guidance in
// src/lib/urgency/assess.ts, and the frontend booking preview.
//
// NFR-11 / BR-17: emergency contacts are hard-coded static content. No fetch, no database,
// no feature flag — they render even when every API route is down.
//
// 1669 and 1323 are Thailand's national emergency-medical and mental-health lines.
// The campus entries are DEMO PLACEHOLDERS — replace with your university's real numbers.

// "phone" is the number as people read it; "tel" is digits only, for a tap-to-call tel: link.
export type EmergencyContact = { name: string; detail: string; phone: string; tel: string };

export const EMERGENCY_CONTACTS: EmergencyContact[] = [
  { name: "Emergency medical services", detail: "Life-threatening emergency, 24 hours", phone: "1669", tel: "1669" },
  { name: "Mental health hotline", detail: "Department of Mental Health, 24 hours", phone: "1323", tel: "1323" },
  { name: "Campus security (demo placeholder)", detail: "On campus, 24 hours", phone: "0-0000-0000", tel: "000000000" },
  { name: "Campus counselling front desk (demo placeholder)", detail: "Weekdays 08:30–16:30", phone: "0-0000-0001", tel: "000000001" },
];

// Shown next to the numbers, so nobody thinks a booking app is an emergency service.
export const CANNOT_HELP_NOW =
  "This app cannot provide immediate help. If you or someone else is in danger or you feel unable to keep yourself safe, please contact one of these numbers now.";
