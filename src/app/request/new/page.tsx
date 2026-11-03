import Link from "next/link";
import { Suspense } from "react";
import { EmergencyBanner } from "@/components/EmergencyBanner";
import { RequestForm } from "@/components/RequestForm";
import { uiPreview } from "@/lib/ui-preview";

// FR-07: the emergency banner is a static server component rendered above the form, so it is
// visible without scrolling and does not depend on any data loading.
export default function NewRequestPage() {
  return (
    <div className="new-request-page mx-auto w-full max-w-5xl space-y-6">
      <div><Link href="/" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">← Back to services</Link><h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">A little about what you need</h1><p className="mt-3 text-base-content/70">A sentence or two is enough to get started. You choose how much to share.</p></div>
      <EmergencyBanner />
      <Suspense fallback={<p>Loading…</p>}>
        <RequestForm preview={uiPreview} />
      </Suspense>
    </div>
  );
}
