// What this page does: shows emergency phone numbers and says this app cannot give immediate help.
// URL: /emergency
// Talks to: no API calls. The numbers are hard-coded in src/lib/emergency.ts.
// Note: the page is built once as static HTML, so it still works when the API or database is down.
import type { Metadata } from "next";
import { CANNOT_HELP_NOW, EMERGENCY_CONTACTS } from "@/lib/emergency";
import { UiIcon } from "@/components/UiIcon";

// FR-07 / NFR-11: fully static. No data fetch, no sign-in, no feature flag.
export const dynamic = "force-static";

export const metadata: Metadata = { title: "Emergency contacts" };

export default function EmergencyPage() {
  // One card per contact. Each button is a tel: link, so on a phone one tap starts the call.
  return (
    <div className="emergency-page space-y-6">
      <header className="route-intro"><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Emergency contacts</h1></header>
      <p className="max-w-2xl alert alert-error alert-soft block p-5">{CANNOT_HELP_NOW}</p>
      <ul className="space-y-3">
        {EMERGENCY_CONTACTS.map((c) => (
          <li key={c.tel} className="card card-border bg-base-100 p-5">
            <h2 className="font-semibold">{c.name}</h2>
            <p className="text-sm text-base-content/70">{c.detail}</p>
            <a className="emergency-call btn mt-4" href={`tel:${c.tel}`}>
              <UiIcon name="phone" /><span>Call {c.phone}</span><UiIcon name="arrow" className="size-4" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
