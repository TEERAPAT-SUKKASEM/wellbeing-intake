import Link from "next/link";
import { CANNOT_HELP_NOW, EMERGENCY_CONTACTS } from "@/lib/emergency";
import { UiIcon } from "./UiIcon";

// Remains static and available without a database connection.
export function EmergencyBanner({
  prominent = false,
}: {
  prominent?: boolean;
}) {
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
