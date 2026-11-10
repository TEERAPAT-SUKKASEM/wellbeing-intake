// What this test does: checks that the browser API helper and the preview API follow the privacy rules.
// Talks to: no real API. fetch is replaced by a mock (vi.stubGlobal), and preview data is in memory.
// Note: it proves the access key travels in a header and never appears in the URL.
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/client/api";
import { addDays, campusDate, campusTime } from "@/lib/client/contracts";
import {
  previewApi,
  sampleServices,
  sampleSlots,
} from "@/lib/client/booking-preview";

// Put the real fetch back after each test, so one test's mock never leaks into another test.
afterEach(() => vi.unstubAllGlobals());
describe("frontend API privacy and retry contract", () => {
  // The key must go in the X-Access-Key header: URLs end up in history, logs and shared links.
  // The URL that fetch receives must be the plain path, with no ?access_key= part.
  it("sends an access key in a header, never in the status URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: "PENDING" })));
    vi.stubGlobal("fetch", fetchMock);
    await api("/requests/me", {
      headers: { "X-Access-Key": "WB-TEST-TEST-TEST" },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/requests/me",
      expect.objectContaining({
        headers: { "X-Access-Key": "WB-TEST-TEST-TEST" },
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
  });
  // Adding the JSON content type must not drop the caller's Idempotency-Key header.
  // Without that key the server could not tell a retry from a new booking.
  it("preserves the submission retry header alongside JSON content type", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await api("/requests", {
      method: "POST",
      body: { intake_note: "Fictional note" },
      headers: { "Idempotency-Key": "submission-1" },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/requests",
      expect.objectContaining({
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "submission-1",
        },
        body: JSON.stringify({ intake_note: "Fictional note" }),
      }),
    );
  });
  // 18:00 UTC on 9 Nov is already 01:00 on 10 Nov in Bangkok (UTC+7).
  // addDays must also move correctly across the end of the year.
  it("uses campus calendar dates even when UTC is on the previous day", () => {
    expect(campusDate(new Date("2026-11-09T18:00:00Z"))).toBe("2026-11-10");
    expect(campusTime("2026-11-09T18:00:00Z")).toBe("01:00");
    expect(addDays("2026-12-30", 6)).toBe("2027-01-05");
  });
  // The whole preview journey: book, send again, look up by key, cancel, and see the time free again.
  it("previews anonymous submission, idempotent recovery, private lookup, cancellation, and released availability", async () => {
    // Two days ahead, so the chosen slot is never in the past when the test runs.
    const date = addDays(campusDate(), 2);
    const service = sampleServices[0];
    const slot = sampleSlots(service.id, date).find((s) => s.is_available)!;
    const init = {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: {
        service_id: service.id,
        alias: null,
        intake_note: "Fictional study pressure",
        manual_urgency: "URGENT",
        requested_slot_start: slot.slot_start,
        ai_opt_in: false,
      },
    };
    // The first send creates the request (201) and keeps the student's own URGENT choice.
    const first = await previewApi<{
      id: string;
      access_key: string;
      urgency_level: string;
    }>("/requests", init);
    expect(first.status).toBe(201);
    expect(first.data?.urgency_level).toBe("URGENT");
    // Sending the same body with the same Idempotency-Key returns the same receipt, not a 2nd booking.
    expect((await previewApi("/requests", init)).data).toEqual(first.data);
    // The booked time is now shown as unavailable.
    expect(
      sampleSlots(service.id, date).find(
        (s) => s.slot_start === slot.slot_start,
      )?.is_available,
    ).toBe(false);
    // A wrong key gets 404 Not Found; the real key finds the request.
    expect(
      (
        await previewApi("/requests/me", {
          headers: { "X-Access-Key": "wrong" },
        })
      ).status,
    ).toBe(404);
    const key = first.data!.access_key;
    expect(
      (await previewApi("/requests/me", { headers: { "X-Access-Key": key } }))
        .ok,
    ).toBe(true);
    // Cancel with the key. After that the same time (and its buffer) is available again.
    const cancel = await previewApi(`/requests/${first.data!.id}/cancel`, {
      method: "POST",
      body: { access_key: key },
    });
    expect(cancel.data).toEqual({ id: first.data!.id, status: "CANCELLED" });
    expect(
      sampleSlots(service.id, date).find(
        (s) => s.slot_start === slot.slot_start,
      )?.is_available,
    ).toBe(true);
  });
});
