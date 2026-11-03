"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, formatDateTime } from "@/lib/client/api";
import { STATUS_SHORT, triageShort } from "@/lib/triage";

type Row = {
  id: string;
  serviceName: string;
  triageLevelId: number;
  acute: boolean;
  status: string;
  submittedAt: string;
  lastStatusChangeAt: string;
};

// FR-13: operational metadata only. The API never sends request content to this role.
export default function CoordinatorPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ requests: Row[] }>("/coordinator/requests").then((r) => {
      if (!alive) return;
      if (r.status === 401 || r.status === 404) router.replace("/sign-in?next=/coordinator");
      else setRows(r.data?.requests ?? []);
    });
    return () => {
      alive = false;
    };
  }, [router]);

  if (!rows) return <p>Loading…</p>;
  const openAcute = rows.filter((r) => r.acute && (r.status === "submitted" || r.status === "in_review"));

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Intake overview</h1>
      <p className="text-sm text-base-content/70">
        Operational metadata across all services. You never see what a student wrote. Urgent requests are listed first.
      </p>

      <p
        role="status"
        className={
          openAcute.length
            ? "alert alert-error alert-soft block p-4 font-medium"
            : "alert block border border-base-300 bg-base-200 p-4"
        }
      >
        {openAcute.length
          ? `${openAcute.length} urgent request${openAcute.length > 1 ? "s" : ""} awaiting human follow-up — you own these until a practitioner marks them escalated.`
          : "No urgent requests are waiting."}
      </p>

      <div className="overflow-x-auto card card-border bg-base-100">
        <table className="table">
          <caption className="sr-only">All requests, urgent first, metadata only</caption>
          <thead className="border-b border-base-300 bg-base-200">
            <tr>
              <th scope="col" className="px-4 py-2">Urgency</th>
              <th scope="col" className="px-4 py-2">Service</th>
              <th scope="col" className="px-4 py-2">Status</th>
              <th scope="col" className="px-4 py-2">Submitted</th>
              <th scope="col" className="px-4 py-2">Last change</th>
              <th scope="col" className="px-4 py-2">Reference</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-4">No requests.</td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-base-300 last:border-0">
                <td className="px-4 py-2 font-medium">
                  {r.acute ? "▲ " : ""}
                  {triageShort(r.triageLevelId)}
                </td>
                <td className="px-4 py-2">{r.serviceName}</td>
                <td className="px-4 py-2">{STATUS_SHORT[r.status] ?? r.status}</td>
                <td className="px-4 py-2">{formatDateTime(r.submittedAt)}</td>
                <td className="px-4 py-2">{formatDateTime(r.lastStatusChangeAt)}</td>
                <td className="px-4 py-2 font-mono text-xs">{r.id.slice(0, 8)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
