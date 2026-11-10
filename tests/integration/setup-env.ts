// What this file does: it runs before each integration test file and sets fixed settings: test secrets,
// AI off, Helpdesk referrals off, no webhook address, and rate limits so high that they never get in the way.
// Why it matters: the tests must give the same result on every computer and in CI, and must never call
// a real AI provider or a real Notification Hub.
// How to run it: it is not run by itself; vitest.config.mts loads it for `pnpm test:integration`.
import { config } from "dotenv";

// Load the local database address and keys from .env.local, then .env.
config({ path: ".env.local" });
config({ path: ".env" });

// Deterministic test configuration. Every boundary is mocked: no Hub URL unless a test sets one, AI off
// unless a test turns it on against a local fake, and limits high enough not to interfere.
process.env.IDENTITY_MODE = "fixture";
process.env.HUB_WEBHOOK_URL = "";
process.env.HUB_SIGNING_SECRET = "test-outbound-secret";
process.env.HUB_INBOUND_SECRET = "test-inbound-secret";
process.env.DISPATCH_TOKEN = "test-dispatch-token";
process.env.ACCESS_KEY_SECRET = "test-access-key-secret";
process.env.AI_TRIAGE_ENABLED = "false";
process.env.LLM_API_KEY = "";
process.env.LLM_BASE_URL = "";
process.env.AI_DAILY_BUDGET = "100000";
process.env.APP_ORIGIN = "http://localhost:3000";
process.env.WEBHOOK_BACKOFF_BASE_SECONDS = "30";
process.env.WEBHOOK_MAX_ATTEMPTS = "3";
process.env.BOOKING_HORIZON_DAYS = "30";
process.env.RATE_REQUESTS_PER_IP = "100000";
process.env.RATE_KEY_FAILURES_PER_IP = "100000";
process.env.RATE_TRIAGE_CHECKS_PER_IP = "100000";
process.env.RATE_REQUESTS_PER_HOUR = "100000";
// Helpdesk referrals (docs/HELPDESK-REFERRALS.md) are off unless a test turns them on; then every
// referral route answers the standard 404. tests/integration/referrals.test.ts switches them on.
process.env.REFERRALS_ENABLED = "false";
// The bearer token Helpdesk sends to POST/GET/DELETE /referrals. A fixed test value, never a real one.
process.env.HELPDESK_REFERRAL_TOKEN = "test-referral-token";
// The HMAC secret our referral callbacks to Helpdesk are signed with. The fake Helpdesk checks it.
process.env.HELPDESK_WEBHOOK_SECRET = "test-helpdesk-webhook-secret";
// No callback address unless a test sets one (the referrals test points it at a fake Helpdesk on 127.0.0.1).
process.env.HELPDESK_WEBHOOK_URL = "";
