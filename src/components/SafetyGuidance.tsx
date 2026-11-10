// What this component shows: a box with safety wording and emergency numbers for a Routine or Urgent result.
// Used on: the booking page (/request/new): in the AI check result, the "Urgent support" dialog,
// and the receipt after sending (RequestReceipt).
// Talks to: no API calls. It only displays the result object it is given.
// Note: an Urgent result uses role="alert", so screen readers read it at once.
// A Routine result uses role="status", which is read politely when the reader is free.
import type { Assessment } from "@/lib/client/contracts";
export function SafetyGuidance({ result }: { result: Assessment }) {
  // Only tel: links are made clickable. Any other link becomes "#",
  // so an unexpected web address in the data is never opened.
  return (
    <div
      className="rounded-field border border-base-300 bg-base-100 p-4 text-sm"
      role={result.urgency_level === "URGENT" ? "alert" : "status"}
    >
      <p className="font-semibold">
        {result.urgency_level === "URGENT"
          ? "Urgent concern — please seek help now if you need it"
          : "Routine urgency assessment"}
      </p>
      <p className="mt-2">{result.disclaimer}</p>
      {result.urgency_level === "URGENT" && (
        <p className="mt-2 font-medium">
          Staff cannot contact an anonymous student. Do not wait for an
          appointment if you need immediate help.
        </p>
      )}
      <ul className="mt-3 space-y-2">
        {result.emergency_links.map((contact) => (
          <li key={contact.name}>
            <a
              className="inline-flex min-h-11 items-center underline underline-offset-4"
              href={contact.href.startsWith("tel:") ? contact.href : "#"}
            >
              {contact.name}: {contact.phone}
            </a>
            <p className="text-base-content/70">{contact.detail}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
