// What this page does: the student tracking page. Enter a Private Access Key to see status or cancel.
// URL: /requests
// Talks to: no API calls itself. RequestsDashboard calls GET /api/v1/services,
//   GET /api/v1/requests/me (key sent in the X-Access-Key header) and POST /api/v1/requests/{id}/cancel.
// Note: the key is never in the URL. The student types it, or it is handed over in memory after booking.
import { RequestsDashboard } from "@/components/requests/RequestsDashboard";
import { uiPreview } from "@/lib/ui-preview";
// A thin server page: it reads the preview flag on the server and gives it to the client dashboard.
export default function MyRequestsPage() {
  return <RequestsDashboard preview={uiPreview} />;
}
