import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/client/api";
import { addDays, campusDate, campusTime } from "@/lib/client/contracts";
import {
  previewApi,
  sampleServices,
  sampleSlots,
} from "@/lib/client/booking-preview";

afterEach(() => vi.unstubAllGlobals());
describe("frontend API privacy and retry contract", () => {
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
  it("uses campus calendar dates even when UTC is on the previous day", () => {
    expect(campusDate(new Date("2026-11-09T18:00:00Z"))).toBe("2026-11-10");
    expect(campusTime("2026-11-09T18:00:00Z")).toBe("01:00");
    expect(addDays("2026-12-30", 6)).toBe("2027-01-05");
  });
  it("previews anonymous submission, idempotent recovery, private lookup, cancellation, and released availability", async () => {
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
    const first = await previewApi<{
      id: string;
      access_key: string;
      urgency_level: string;
    }>("/requests", init);
    expect(first.status).toBe(201);
    expect(first.data?.urgency_level).toBe("URGENT");
    expect((await previewApi("/requests", init)).data).toEqual(first.data);
    expect(
      sampleSlots(service.id, date).find(
        (s) => s.slot_start === slot.slot_start,
      )?.is_available,
    ).toBe(false);
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
