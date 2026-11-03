import type { Metadata } from "next";
import { CANNOT_HELP_NOW, EMERGENCY_CONTACTS } from "@/lib/emergency";

// FR-07 / NFR-11: fully static. No data fetch, no sign-in, no feature flag.
export const dynamic = "force-static";

export const metadata: Metadata = { title: "Emergency contacts" };

export default function EmergencyPage() {
  return (
    <div className="emergency-page space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Emergency contacts</h1>
      <p className="max-w-2xl alert alert-error alert-soft block p-5">{CANNOT_HELP_NOW}</p>
      <ul className="space-y-3">
        {EMERGENCY_CONTACTS.map((c) => (
          <li key={c.tel} className="card card-border bg-base-100 p-5">
            <p className="font-semibold">{c.name}</p>
            <p className="text-sm text-base-content/70">{c.detail}</p>
            <a className="mt-1 inline-block text-2xl font-bold text-base-content underline underline-offset-4" href={`tel:${c.tel}`}>
              {c.phone}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
