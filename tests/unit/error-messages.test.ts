// What this test file does: checks that every API error code the screens can receive turns into a clear
//   sentence for the student (src/lib/client/contracts.ts, errorMessage()).
// Why it matters: an unknown code falls back to "Check your connection", which is misleading when the real
//   reason is known, e.g. a cancel refused because the session has already started (409 too_late).
// How to run it: `pnpm test`.
import { describe, expect, it } from "vitest";
import { errorMessage } from "@/lib/client/contracts";

describe("errorMessage", () => {
  it.each([
    ["too_many_requests", /Too many attempts/],
    ["slot_unavailable", /no longer available/],
    ["invalid_transition", /has changed/],
    ["too_late", /already started, so it can no longer be cancelled/],
    ["validation_failed", /check the form fields/],
  ])("explains %s plainly", (code, sentence) => {
    expect(errorMessage(code)).toMatch(sentence);
  });

  it("never blames the connection for a known reason", () => {
    for (const code of ["too_many_requests", "slot_unavailable", "invalid_transition", "too_late", "validation_failed"]) {
      expect(errorMessage(code)).not.toMatch(/connection/);
    }
  });

  it("falls back to a general message for unknown codes and network errors", () => {
    expect(errorMessage("network_error")).toMatch(/connection/);
    expect(errorMessage(null)).toMatch(/connection/);
  });
});
