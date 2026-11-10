// What this page does: the practitioner "Schedule & triage desk": timeline, review queue and decisions.
// URL: /practitioner
// Talks to: no API calls itself. PractitionerDesk calls GET /api/v1/practitioner/queue,
//   GET /api/v1/practitioner/schedule and PATCH /api/v1/requests/{id}/status.
// Note: staff screens always use the real API, even in preview mode, so permissions are never skipped.
import { PractitionerDesk } from "@/components/PractitionerDesk";
// No sign-in check here. PractitionerDesk learns it from the API and redirects to /sign-in on a 401.
export default function PractitionerPage() {
  return <PractitionerDesk />;
}
