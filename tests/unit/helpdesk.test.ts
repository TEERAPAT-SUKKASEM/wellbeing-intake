// What this test file does: checks our client for Team 14's Helpdesk contacts API
//   (src/lib/partners/helpdesk.ts) with the network faked.
// Why it matters: this is our cross-group integration in the Wellbeing -> Helpdesk direction, and it feeds
//   the emergency numbers shown to students, so any Helpdesk problem must fall back to our hard-coded list.
// How to run it: `pnpm test`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMERGENCY_CONTACTS } from "@/lib/emergency";
import { clearHelpdeskCache, emergencyContactsFor, fetchHelpdeskContacts } from "@/lib/partners/helpdesk";
import { guidanceFor } from "@/lib/urgency/assess";

const BASE = "https://helpdesk.example.test/api/v1";

// Exactly what Team 14's live API returned on 2026-11-10 (both numbers are still placeholders).
const LIVE = [
  {
    id: "campus_security",
    name: "Campus security",
    phone: "0-0000-0000",
    tel: "000000000",
    hours: "24 hours",
    type: "emergency",
    available_24h: true,
    verified: false,
    updated_at: "2026-11-10T07:00:00Z",
  },
  {
    id: "counselling_front_desk",
    name: "Campus counselling front desk",
    phone: "0-0000-0001",
    tel: "000000001",
    hours: "Weekdays 08:30-16:30",
    type: "service",
    available_24h: false,
    verified: false,
    updated_at: "2026-11-10T07:00:00Z",
  },
];

const fetchMock = vi.fn<typeof fetch>();
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

beforeEach(() => {
  clearHelpdeskCache();
  vi.stubEnv("HELPDESK_API_BASE_URL", BASE);
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("switched off", () => {
  it("makes no call and keeps the hard-coded numbers when HELPDESK_API_BASE_URL is empty", async () => {
    vi.stubEnv("HELPDESK_API_BASE_URL", "");
    expect(await emergencyContactsFor("cid-1")).toEqual(EMERGENCY_CONTACTS);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Helpdesk answers", () => {
  it("replaces only the two campus placeholders, labelled (demo) while unverified", async () => {
    fetchMock.mockResolvedValue(ok(LIVE));
    const contacts = await emergencyContactsFor("cid-1");

    // The national hotlines are never replaced.
    expect(contacts.slice(0, 2)).toEqual(EMERGENCY_CONTACTS.slice(0, 2));
    expect(contacts[2]).toEqual({ name: "Campus security (demo)", detail: "24 hours", phone: "0-0000-0000", tel: "000000000" });
    expect(contacts[3]).toEqual({
      name: "Campus counselling front desk (demo)",
      detail: "Weekdays 08:30-16:30",
      phone: "0-0000-0001",
      tel: "000000001",
    });
  });

  it("drops the (demo) label once Helpdesk marks a number verified", async () => {
    fetchMock.mockResolvedValue(ok([{ ...LIVE[0], verified: true, phone: "0-5555-0000", tel: "055550000" }]));
    const contacts = await emergencyContactsFor("cid-1");
    expect(contacts[2]).toMatchObject({ name: "Campus security", tel: "055550000" });
    expect(contacts[3]).toEqual(EMERGENCY_CONTACTS[3]); // Helpdesk did not send this one
  });

  it("calls GET <base>/contacts with a team16- correlation id, and the student sees it in the guidance", async () => {
    fetchMock.mockResolvedValue(ok(LIVE));
    const guidance = guidanceFor("URGENT", await emergencyContactsFor("abc12345"));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/contacts`);
    expect((init!.headers as Record<string, string>)["x-correlation-id"]).toBe("team16-abc12345");
    expect(init!.signal).toBeInstanceOf(AbortSignal);
    expect(guidance.emergency_links[2]).toEqual({
      name: "Campus security (demo)",
      detail: "24 hours",
      phone: "0-0000-0000",
      href: "tel:000000000",
    });
  });

  it("passes an id that already starts with team16- through unchanged (the agreed evidence id)", async () => {
    fetchMock.mockResolvedValue(ok(LIVE));
    await fetchHelpdeskContacts("team16-v1-0001");
    expect((fetchMock.mock.calls[0][1]!.headers as Record<string, string>)["x-correlation-id"]).toBe("team16-v1-0001");
  });

  it("ignores fields Helpdesk adds later", async () => {
    fetchMock.mockResolvedValue(ok(LIVE.map((contact) => ({ ...contact, building: "C1" }))));
    expect((await fetchHelpdeskContacts("cid-1"))?.length).toBe(2);
  });
});

describe("any Helpdesk problem falls back to the hard-coded numbers", () => {
  it.each([
    ["an HTTP error", () => new Response("{}", { status: 500 })],
    ["a wrapped object instead of an array", () => ok({ contacts: LIVE })],
    ["a tel that is not digits", () => ok([{ ...LIVE[0], tel: "javascript:alert(1)" }])],
    ["a missing field", () => ok([{ ...LIVE[0], verified: undefined }])],
    ["text that is not JSON", () => new Response("<html>oops</html>", { status: 200 })],
  ])("%s", async (_label, reply) => {
    fetchMock.mockImplementation(async () => reply());
    expect(await emergencyContactsFor("cid-1")).toEqual(EMERGENCY_CONTACTS);
  });

  it("a timeout or network failure", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("The operation timed out.", "TimeoutError"));
    expect(await emergencyContactsFor("cid-1")).toEqual(EMERGENCY_CONTACTS);
    clearHelpdeskCache();
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await emergencyContactsFor("cid-2")).toEqual(EMERGENCY_CONTACTS);
  });
});

describe("cache and back-off", () => {
  it("reuses a good answer for 5 minutes without calling again", async () => {
    fetchMock.mockResolvedValue(ok(LIVE));
    await fetchHelpdeskContacts("cid-1");
    await fetchHelpdeskContacts("cid-2");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps using the last good answer while Helpdesk is down", async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    fetchMock.mockResolvedValueOnce(ok(LIVE));
    await fetchHelpdeskContacts("cid-1");

    clock.mockReturnValue(now + 6 * 60_000); // the cached answer is no longer fresh
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 503 }));
    expect((await emergencyContactsFor("cid-2"))[2].name).toBe("Campus security (demo)");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("after a failure with nothing cached, waits a minute before calling again", async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
    await fetchHelpdeskContacts("cid-1");
    await fetchHelpdeskContacts("cid-2");
    expect(fetchMock).toHaveBeenCalledTimes(1); // the second call was skipped

    clock.mockReturnValue(now + 61_000);
    await fetchHelpdeskContacts("cid-3");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("writes one content-free log line per real call", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    fetchMock.mockResolvedValue(ok(LIVE));
    await fetchHelpdeskContacts("cid-1");
    const entry = JSON.parse(log.mock.calls[0][0] as string);
    expect(entry).toMatchObject({ kind: "partner", partner: "helpdesk", cid: "team16-cid-1", outcome: "ok" });
    expect(Object.keys(entry).sort()).toEqual(["cid", "kind", "ms", "outcome", "partner", "svc", "t"]);
  });
});
