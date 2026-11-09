import { config } from "dotenv";

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
