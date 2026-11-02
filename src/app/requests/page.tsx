"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { RequestsDashboard } from "@/components/requests/RequestsDashboard";

function ConnectedRequests() {
  const justSent = useSearchParams().get("sent") === "1";
  return <RequestsDashboard justSent={justSent} />;
}

export default function MyRequestsPage() {
  return <Suspense fallback={<p role="status">Loading requests…</p>}><ConnectedRequests /></Suspense>;
}
