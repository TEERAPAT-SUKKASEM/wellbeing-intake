import { RequestsDashboard } from "@/components/requests/RequestsDashboard";
import { uiPreview } from "@/lib/ui-preview";
export default function MyRequestsPage() {
  return <RequestsDashboard preview={uiPreview} />;
}
