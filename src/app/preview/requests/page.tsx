// What this page does: a development-only copy of the request tracking screen that always uses fake data.
// URL: /preview/requests (optional ?service=<service ID>)
// Talks to: no real API. RequestsDashboard uses the in-memory preview data in booking-preview.ts.
// Note: when preview mode is off (it is always off in production) this page answers 404 Not Found.
import { notFound } from "next/navigation";
import { RequestsDashboard } from "@/components/requests/RequestsDashboard";
import { uiPreview } from "@/lib/ui-preview";

export default async function PreviewRequestsPage({ searchParams }: { searchParams: Promise<{ service?: string }> }) {
  // Hide the page completely unless UI_PREVIEW is on in development.
  if (!uiPreview) notFound();
  // In this Next.js version searchParams is a Promise, so the page must await it.
  const params = await searchParams;
  // `preview` alone means preview={true}. The optional ?service= value is passed on as previewServiceId.
  return <RequestsDashboard preview previewServiceId={params.service} />;
}
