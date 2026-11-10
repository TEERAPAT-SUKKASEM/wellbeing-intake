// What this page does: the booking page. The student picks a time, writes a note and sends the request.
// URL: /request/new?service=<service ID>
// Talks to: no API calls itself. RequestForm calls GET /api/v1/services, GET /api/v1/slots,
//   POST /api/v1/triage/assess (only if the student agrees to the AI check) and POST /api/v1/requests.
// Note: no name, email or student ID is asked for, only an optional alias.
import Link from "next/link";
import { Suspense } from "react";
import { EmergencyBanner } from "@/components/EmergencyBanner";
import { RequestForm } from "@/components/RequestForm";
import { uiPreview } from "@/lib/ui-preview";
import { UiIcon } from "@/components/UiIcon";

// FR-07: the emergency banner is a static server component rendered above the form, so it is
// visible without scrolling and does not depend on any data loading.
export default function NewRequestPage() {
  // The back link jumps to the service list on the home page (the #services-heading anchor).
  return (
    <div className="new-request-page mx-auto w-full max-w-5xl space-y-6">
      <div>
        <Link
          href="/#services-heading"
          className="service-back-link"
        >
          <UiIcon name="arrow" className="size-5 rotate-180" />
          Choose a different service
        </Link>
        <h1 className="mt-3">Request an appointment</h1>
        <p>
          Choose a time, then tell us a little about what’s on your mind. Share
          only what feels comfortable.
        </p>
      </div>
      <EmergencyBanner />
      {/* RequestForm reads ?service= with useSearchParams, so it must sit inside a Suspense boundary. */}
      <Suspense fallback={<p>Loading…</p>}>
        <RequestForm preview={uiPreview} />
      </Suspense>
    </div>
  );
}
