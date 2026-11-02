import { notFound } from "next/navigation";
import { RequestsDashboard } from "@/components/requests/RequestsDashboard";
import { uiPreview } from "@/lib/ui-preview";

export default async function PreviewRequestsPage({ searchParams }: { searchParams: Promise<{ service?: string }> }) {
  if (!uiPreview) notFound();
  const params = await searchParams;
  return <RequestsDashboard preview previewServiceId={params.service} />;
}
