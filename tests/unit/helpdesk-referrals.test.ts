// What this test file does: checks the pure parts of the Helpdesk referrals feature (Team 14 -> Wellbeing,
//   docs/HELPDESK-REFERRALS.md): the exact callback body, its HMAC signature, the bearer-token check on
//   Helpdesk's calls to us, and that the callback sender does nothing while the feature is off.
// Why it matters: the callback body is the only thing Helpdesk ever learns about a referral, so it must be
//   exactly { eventId, type, data: { ref, status } }. The signature and token are the two secrets that
//   prove each side is who it claims to be, and Team 14 checks the same signature vector on their side.
// How to run it: `pnpm test` (or `pnpm exec vitest run --project unit tests/unit/helpdesk-referrals.test.ts`).
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CALLBACK_TYPE, callbackBody, sendReferralCallbacks, signCallback } from "@/lib/partners/helpdesk-referrals";
import { REF_RE, helpdeskTokenOk } from "@/lib/referrals";

// The database client is replaced by a mock (vi.mock is hoisted above the imports), so a test can
// prove the sender never touched it. The network (fetch) is stubbed per test below.
const { dbMock } = vi.hoisted(() => ({ dbMock: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({ db: dbMock }));

const EVENT_ID = "evt-3f2b8c1e-9d4a-4e6b-a1c7-5e8f0b2d4c69";
const REF = "hd-0123456789abcdef0123456789abcdef";
const SECRET = "test-helpdesk-webhook-secret";
const TS = "1794268800"; // 2026-11-10T00:00:00Z, in Unix seconds

const fetchMock = vi.fn<typeof fetch>();

afterEach(() => {
  fetchMock.mockReset();
  dbMock.mockReset();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// A Helpdesk ref is "hd-" and exactly 32 lowercase hex characters, nothing else.
describe("REF_RE", () => {
  it("accepts a well-formed ref", () => {
    expect(REF_RE.test(REF)).toBe(true);
  });

  it.each([
    ["uppercase hex", `hd-${"A".repeat(32)}`],
    ["31 characters", `hd-${"a".repeat(31)}`],
    ["33 characters", `hd-${"a".repeat(33)}`],
    ["another prefix", `xx-${"a".repeat(32)}`],
    ["no prefix", "a".repeat(32)],
    ["a trailing newline", `${REF}\n`],
    ["a non-hex letter", `hd-${"g".repeat(32)}`],
  ])("refuses %s", (_label, ref) => {
    expect(REF_RE.test(ref)).toBe(false);
  });
});

// The callback body is the whole of what Helpdesk learns: these exact keys, in this exact order.
describe("callbackBody", () => {
  it("is exactly {eventId, type, data: {ref, status}} in that key order", () => {
    expect(CALLBACK_TYPE).toBe("wellbeing.referral_status");
    expect(callbackBody(EVENT_ID, REF, "approved")).toBe(
      `{"eventId":"${EVENT_ID}","type":"wellbeing.referral_status","data":{"ref":"${REF}","status":"approved"}}`,
    );
    expect(callbackBody(EVENT_ID, REF, "declined")).toBe(
      `{"eventId":"${EVENT_ID}","type":"wellbeing.referral_status","data":{"ref":"${REF}","status":"declined"}}`,
    );
  });

  it("carries no time, service, consent or session detail", () => {
    const parsed = JSON.parse(callbackBody(EVENT_ID, REF, "approved"));
    expect(Object.keys(parsed)).toEqual(["eventId", "type", "data"]);
    expect(Object.keys(parsed.data)).toEqual(["ref", "status"]);
  });
});

// X-Signature = lowercase hex HMAC-SHA256(secret, `${X-Timestamp}.${raw body}`), the scheme Team 14 checks.
describe("signCallback", () => {
  const body = callbackBody(EVENT_ID, REF, "approved");

  it("equals HMAC-SHA256 over `${timestamp}.${body}` as lowercase hex", () => {
    const expected = createHmac("sha256", SECRET).update(`${TS}.${body}`).digest("hex");
    const signature = signCallback(body, TS, SECRET);
    expect(signature).toBe(expected);
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches the fixed test vector shared with Team 14", () => {
    expect(signCallback(body, TS, SECRET)).toBe("f4af2ff2614ec6be66071d34896dea4b899c2afa78257da167d7c547f0651d2c");
  });

  it("changes when the body, the timestamp or the secret changes", () => {
    const original = signCallback(body, TS, SECRET);
    expect(signCallback(callbackBody(EVENT_ID, REF, "declined"), TS, SECRET)).not.toBe(original);
    expect(signCallback(body, String(Number(TS) + 1), SECRET)).not.toBe(original);
    expect(signCallback(body, TS, `${SECRET}x`)).not.toBe(original);
  });
});

// Helpdesk calls us with "Authorization: Bearer <HELPDESK_REFERRAL_TOKEN>". Anything else is refused.
describe("helpdeskTokenOk", () => {
  const req = (authorization?: string) =>
    new Request("http://localhost:3000/api/v1/referrals", {
      method: "POST",
      headers: authorization === undefined ? {} : { authorization },
    });

  // The answer, or "threw" if the check threw (for example because the token is not configured).
  const outcome = (fn: () => boolean): boolean | "threw" => {
    try {
      return fn();
    } catch {
      return "threw";
    }
  };

  beforeEach(() => {
    vi.stubEnv("HELPDESK_REFERRAL_TOKEN", "test-referral-token");
  });

  it("accepts the right token", () => {
    expect(helpdeskTokenOk(req("Bearer test-referral-token"))).toBe(true);
  });

  it.each([
    ["no Authorization header", undefined],
    ["an empty header", ""],
    ["a wrong token of the same length", "Bearer test-referral-tokex"],
    ["Bearer with nothing after it", "Bearer"],
    ["Bearer and a space", "Bearer "],
    ["a shorter token", "Bearer test-referral"],
    ["a longer token", "Bearer test-referral-token-and-more"],
    ["the token without the Bearer scheme", "test-referral-token"],
    ["another scheme", "Basic test-referral-token"],
  ])("refuses %s", (_label, header) => {
    expect(helpdeskTokenOk(req(header))).toBe(false);
  });

  // With no usable token configured, nobody gets in: the check answers false or throws (which route()
  // turns into an error answer), but it is never true.
  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["still a change-me placeholder", "change-me-referral-token"],
  ])("never lets anyone in when HELPDESK_REFERRAL_TOKEN is %s", (_label, value) => {
    vi.stubEnv("HELPDESK_REFERRAL_TOKEN", value);
    for (const header of [undefined, "", "Bearer", "Bearer ", "Bearer undefined", `Bearer ${value ?? ""}`]) {
      expect(outcome(() => helpdeskTokenOk(req(header)))).not.toBe(true);
    }
  });
});

// While the feature is off, or has nowhere or no secret to send with, the sender returns "skipped" at
// once: no network call and no database query. Events then wait safely in the outbox.
describe("sendReferralCallbacks when it must not send", () => {
  const SKIPPED = { skipped: true, sent: 0, retry: 0, gaveUp: 0 };

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});
    // Everything else is ready to send, so only the setting under test can cause the skip.
    vi.stubEnv("REFERRALS_ENABLED", "true");
    vi.stubEnv("HELPDESK_API_BASE_URL", "https://helpdesk.example.test/api/v1");
    vi.stubEnv("HELPDESK_WEBHOOK_URL", "https://helpdesk.example.test/api/v1/webhooks/wellbeing");
    vi.stubEnv("HELPDESK_WEBHOOK_SECRET", SECRET);
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["false", "false"],
    ["1", "1"],
  ])("is skipped while REFERRALS_ENABLED is %s", async (_label, value) => {
    vi.stubEnv("REFERRALS_ENABLED", value);
    expect(await sendReferralCallbacks("cid-1")).toEqual(SKIPPED);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dbMock).not.toHaveBeenCalled();
  });

  it("is skipped when there is no webhook address (none set and no Helpdesk base URL)", async () => {
    vi.stubEnv("HELPDESK_WEBHOOK_URL", "");
    vi.stubEnv("HELPDESK_API_BASE_URL", "");
    expect(await sendReferralCallbacks("cid-1", 3)).toEqual(SKIPPED);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dbMock).not.toHaveBeenCalled();
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
  ])("is skipped when HELPDESK_WEBHOOK_SECRET is %s", async (_label, value) => {
    vi.stubEnv("HELPDESK_WEBHOOK_SECRET", value);
    expect(await sendReferralCallbacks("cid-1")).toEqual(SKIPPED);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dbMock).not.toHaveBeenCalled();
  });
});
