import Link from "next/link";
import { CANNOT_HELP_NOW, EMERGENCY_CONTACTS } from "@/lib/emergency";

// Static server component: zero data dependency (NFR-11). `prominent` is the FR-08 state.
export function EmergencyBanner({ prominent = false }: { prominent?: boolean }) {
  const primary = EMERGENCY_CONTACTS.slice(0, 2);
  return (
    <aside
      aria-label="Emergency contacts"
      className={
        prominent
          ? "alert alert-error alert-soft block p-5"
          : "emergency-notice alert alert-error alert-outline block p-5 sm:p-8"
      }
    >
      <p className={prominent ? "text-lg font-semibold" : "font-semibold"}>
        {prominent ? "Please contact someone now" : "Need help right now?"}
      </p>
      {prominent && <p className="mt-2">{CANNOT_HELP_NOW}</p>}
      <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
        {(prominent ? EMERGENCY_CONTACTS : primary).map((c) => (
          <li key={c.tel}>
            {c.name}:{" "}
            <a className="font-bold underline underline-offset-2" href={`tel:${c.tel}`}>
              {c.phone}
            </a>
          </li>
        ))}
      </ul>
      {!prominent && (
        <p className="mt-2 text-sm">
          This app books appointments; it cannot respond to emergencies.{" "}
          <Link className="underline underline-offset-2" href="/emergency">
            All emergency contacts
          </Link>
        </p>
      )}
    </aside>
  );
}
