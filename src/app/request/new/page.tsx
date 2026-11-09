import Link from "next/link";
import { Suspense } from "react";
import { EmergencyBanner } from "@/components/EmergencyBanner";
import { RequestForm } from "@/components/RequestForm";
import { uiPreview } from "@/lib/ui-preview";
import { UiIcon } from "@/components/UiIcon";

// FR-07: the emergency banner is a static server component rendered above the form, so it is
// visible without scrolling and does not depend on any data loading.
export default function NewRequestPage() {
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
      <Suspense fallback={<p>Loading…</p>}>
        <RequestForm preview={uiPreview} />
      </Suspense>
    </div>
  );
}
