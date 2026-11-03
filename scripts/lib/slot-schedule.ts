// Plans demo availability (BR-12: slots are seeded or published by hand, there is no calendar sync).
// Pure: the caller reads the database and writes the result.

export const DAILY_TIMES = ["09:00", "10:30", "13:00", "14:30"] as const;

// Campus time. Thailand has no daylight saving, so the offset is constant.
const CAMPUS_OFFSET = "+07:00";
const CAMPUS_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;

export type Practitioner = { id: string; serviceId: string };
export type ExistingSlot = { practitionerId: string; startAt: string };
export type NewSlot = { practitioner_id: string; start_at: string };

/**
 * Weekday slots from now through the next `days` calendar days. Students see a service's slots
 * pooled across its practitioners, so each time goes to one practitioner only: two people at 09:00
 * would show as two identical buttons in the booking picker. A time the service already has is
 * skipped, whoever holds it and however it got there, which also makes repeat runs add nothing.
 */
export function planSlots(input: {
  practitioners: readonly Practitioner[];
  existing: readonly ExistingSlot[];
  now: Date;
  days: number;
}): NewSlot[] {
  const { practitioners, existing, now, days } = input;

  const serviceOf = new Map(practitioners.map((p) => [p.id, p.serviceId]));
  const taken = new Set<string>();
  for (const slot of existing) {
    const service = serviceOf.get(slot.practitionerId);
    if (service) taken.add(`${service}|${new Date(slot.startAt).getTime()}`);
  }

  const byService = new Map<string, string[]>();
  for (const p of practitioners) byService.set(p.serviceId, [...(byService.get(p.serviceId) ?? []), p.id]);

  const campusToday = new Date(now.getTime() + CAMPUS_OFFSET_MS);
  const firstDay = Date.UTC(campusToday.getUTCFullYear(), campusToday.getUTCMonth(), campusToday.getUTCDate());

  const planned: NewSlot[] = [];
  for (let offset = 0; offset < days; offset++) {
    const day = new Date(firstDay + offset * DAY_MS);
    if (day.getUTCDay() === 0 || day.getUTCDay() === 6) continue;
    const date = day.toISOString().slice(0, 10);

    for (const [service, ids] of byService) {
      const sorted = [...ids].sort();
      DAILY_TIMES.forEach((time, index) => {
        const start = new Date(`${date}T${time}:00${CAMPUS_OFFSET}`);
        const key = `${service}|${start.getTime()}`;
        if (start <= now || taken.has(key)) return;
        taken.add(key);
        planned.push({ practitioner_id: sorted[index % sorted.length], start_at: start.toISOString() });
      });
    }
  }
  return planned;
}
