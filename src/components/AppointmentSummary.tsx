export function AppointmentSummary({ date, time, duration, location }: { date: string; time?: string; duration?: string; location?: string }) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-base-content/70">Appointment details</h3>
      <div><p className="text-xl font-semibold">{date}</p>{time && <p className="appointment-time mt-2 text-3xl font-semibold tracking-tight tabular-nums">{time}</p>}</div>
      {(duration || location) && <dl className="grid gap-4 border-t border-base-300 pt-4 text-sm sm:grid-cols-2">
        {duration && <div><dt className="text-base-content/70">Duration</dt><dd className="mt-1 font-medium">{duration}</dd></div>}
        {location && <div><dt className="text-base-content/70">Location</dt><dd className="mt-1 font-medium">{location}</dd></div>}
      </dl>}
    </div>
  );
}
