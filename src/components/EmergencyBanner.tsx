// What this component shows: emergency phone numbers, and a reminder that this is not crisis support.
// Used on: the home page (/), the booking page (/request/new) and the tracking page (/requests).
// Talks to: no API calls. The numbers come from the fixed list in src/lib/emergency.ts.
// Note: each number is a tel: link, so on a phone one tap starts the call.
import Link from "next/link";
import { CANNOT_HELP_NOW, EMERGENCY_CONTACTS } from "@/lib/emergency";
import { UiIcon } from "./UiIcon";

// Remains static and available without a database connection.
export function EmergencyBanner({
  prominent = false,
}: {
  prominent?: boolean;
}) {
  // The "prominent" version is a red alert box with every contact.
  // No page passes prominent={true} at the moment, so the smaller version below is what users see.
  if (prominent)
    return (
      <aside
        aria-label="Emergency contacts"
        className="alert alert-error alert-soft block p-5"
      >
        <p className="font-semibold">Please contact someone now</p>
        <p className="mt-2">{CANNOT_HELP_NOW}</p>
        <ul className="mt-3 space-y-2">
          {EMERGENCY_CONTACTS.map((c) => (
            <li key={c.tel}>
              {c.name}:{" "}
              <a className="link font-semibold" href={`tel:${c.tel}`}>
                {c.phone}
              </a>
            </li>
          ))}
        </ul>
      </aside>
    );
  // The default version: a short notice, the first two numbers, and a link to the full list on /emergency.
  // aria-label names the box, so screen reader users can jump straight to it.
  return (
    <aside aria-label="Emergency contacts" className="emergency-notice">
      <UiIcon name="phone" className="emergency-icon size-5" />
      <div>
        <p className="emergency-heading">Need someone right now?</p>
        <p className="emergency-detail">
          This is an appointment service, not emergency support.{" "}
          <Link href="/emergency" className="link">
            See all contacts
          </Link>
        </p>
      </div>
      <ul>
        {EMERGENCY_CONTACTS.slice(0, 2).map((c) => (
          <li key={c.tel}>
            {c.name}:{" "}
            <a className="link font-semibold" href={`tel:${c.tel}`}>
              {c.phone}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}
