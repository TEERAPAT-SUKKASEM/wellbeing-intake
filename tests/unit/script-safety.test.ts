import { describe, expect, it } from "vitest";
import { checkDbTarget } from "../../scripts/lib/db-target";
import { DAILY_TIMES, planSlots, type Practitioner } from "../../scripts/lib/slot-schedule";

const REMOTE = "https://abcdefgh.supabase.co";

describe("checkDbTarget", () => {
  it.each(["http://127.0.0.1:54321", "http://localhost:54321", "http://[::1]:54321"])("allows the local stack %s", (url) => {
    expect(checkDbTarget(url, [])).toMatchObject({ allowed: true, local: true });
  });

  it("refuses a remote database by default", () => {
    expect(checkDbTarget(REMOTE, [])).toEqual({ allowed: false, host: "abcdefgh.supabase.co", local: false });
  });

  it("allows a remote database only when that exact host is confirmed", () => {
    expect(checkDbTarget(REMOTE, ["--confirm-remote=abcdefgh.supabase.co"]).allowed).toBe(true);
    expect(checkDbTarget(REMOTE, ["--confirm-remote=other.supabase.co"]).allowed).toBe(false);
    expect(checkDbTarget(REMOTE, ["--confirm-remote"]).allowed).toBe(false);
    expect(checkDbTarget(REMOTE, ["--confirm-remote=true"]).allowed).toBe(false);
  });

  it.each(["https://127.0.0.1.evil.test", "https://127.0.0.1@evil.test", "https://localhost.evil.test"])(
    "does not mistake the lookalike %s for local",
    (url) => {
      expect(checkDbTarget(url, []).allowed).toBe(false);
    },
  );

  it("refuses a value that is not a URL", () => {
    expect(checkDbTarget("not a url", [])).toEqual({ allowed: false, host: null, local: false });
  });
});

describe("planSlots", () => {
  const solo: Practitioner = { id: "nurse", serviceId: "clinic" };
  const pair: Practitioner[] = [
    { id: "counsellor-1", serviceId: "counselling" },
    { id: "counsellor-2", serviceId: "counselling" },
  ];
  // Monday 2 November 2026, 06:00 campus time.
  const monday = new Date("2026-11-01T23:00:00Z");
  const campusHour = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3_600_000).getUTCHours();

  it("gives one practitioner every daily time on each weekday", () => {
    const planned = planSlots({ practitioners: [solo], existing: [], now: monday, days: 5 });
    expect(planned).toHaveLength(5 * DAILY_TIMES.length);
    expect(planned.map((s) => campusHour(s.start_at)).slice(0, 4)).toEqual([9, 10, 13, 14]);
  });

  it("skips weekends in campus time", () => {
    const planned = planSlots({ practitioners: [solo], existing: [], now: monday, days: 7 });
    const days = planned.map((s) => new Date(new Date(s.start_at).getTime() + 7 * 3_600_000).getUTCDay());
    expect(new Set(days)).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  it("uses the campus date, not the UTC one, near midnight", () => {
    // Saturday 23:00 UTC is already Sunday 06:00 on campus, so one day ahead plans nothing.
    const planned = planSlots({ practitioners: [solo], existing: [], now: new Date("2026-11-07T23:00:00Z"), days: 1 });
    expect(planned).toEqual([]);
  });

  it("never plans a slot in the past", () => {
    const midday = new Date("2026-11-02T05:30:00Z"); // 12:30 campus time
    const planned = planSlots({ practitioners: [solo], existing: [], now: midday, days: 1 });
    expect(planned.map((s) => campusHour(s.start_at))).toEqual([13, 14]);
  });

  it("gives each time to one practitioner, so the picker shows no duplicate times", () => {
    const planned = planSlots({ practitioners: pair, existing: [], now: monday, days: 5 });
    const times = planned.map((s) => s.start_at);
    expect(new Set(times).size).toBe(times.length);
    expect(planned.filter((s) => s.practitioner_id === "counsellor-1")).toHaveLength(10);
    expect(planned.filter((s) => s.practitioner_id === "counsellor-2")).toHaveLength(10);
  });

  it("lets different services share a time", () => {
    const planned = planSlots({ practitioners: [solo, ...pair], existing: [], now: monday, days: 1 });
    expect(planned.filter((s) => campusHour(s.start_at) === 9)).toHaveLength(2);
  });

  it("adds nothing on a second run", () => {
    const practitioners = [solo, ...pair];
    const first = planSlots({ practitioners, existing: [], now: monday, days: 14 });
    const existing = first.map((s) => ({ practitionerId: s.practitioner_id, startAt: s.start_at }));
    expect(planSlots({ practitioners, existing, now: monday, days: 14 })).toEqual([]);
  });

  it("skips a time a colleague in the same service already holds", () => {
    const existing = [{ practitionerId: "counsellor-2", startAt: "2026-11-02T09:00:00+07:00" }];
    const planned = planSlots({ practitioners: pair, existing, now: monday, days: 1 });
    expect(planned.map((s) => campusHour(s.start_at))).toEqual([10, 13, 14]);
  });

  it("compares times by instant, whatever format the database returns", () => {
    const existing = [{ practitionerId: "nurse", startAt: "2026-11-02T02:00:00+00:00" }]; // 09:00 campus time
    const planned = planSlots({ practitioners: [solo], existing, now: monday, days: 1 });
    expect(planned.map((s) => campusHour(s.start_at))).toEqual([10, 13, 14]);
  });
});
