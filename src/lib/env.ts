// What this file does: reads every setting and secret from environment variables, in one place.
// Why it exists: secrets stay on the server, a missing secret stops the code that needs it instead of
// running without protection, and every limit has a safe default.
// Used by: almost every server module, e.g. http.ts, the identity adapter, the dispatcher and API routes.
import "server-only";

// Every secret and switch is server-only: nothing here carries a NEXT_PUBLIC_ prefix.

// A required value must be set and must not still be a "change-me..." placeholder. Otherwise we throw,
// so the app never runs with an empty secret.
function required(name: string): string {
  const v = process.env[name];
  if (!v || v.startsWith("change-me")) throw new Error(`Missing required env var ${name}`);
  return v;
}

// An optional value uses the fallback when it is not set.
function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

// A number setting. A missing value or anything that is not a real number uses the fallback.
function number(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return process.env[name] && Number.isFinite(parsed) ? parsed : fallback;
}

// Each setting is a getter, so it is read when it is used, not when the file loads. A route only fails
// on a missing secret if that route really needs the secret.
export const env = {
  // The Supabase project address and keys. The service-role key can read and write everything,
  // so it must only ever be used on the server.
  get supabaseUrl() {
    return required("SUPABASE_URL");
  },
  get supabaseAnonKey() {
    return required("SUPABASE_ANON_KEY");
  },
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },

  // Staff sign-in. Students never sign in.
  /** "fixture" (Supabase Auth demo accounts) or "campus" (identity provider tokens). */
  get identityMode(): "fixture" | "campus" {
    return optional("IDENTITY_MODE", "fixture") === "campus" ? "campus" : "fixture";
  },
  // Campus mode only: where the provider's public keys are, and who must have made the token (issuer)
  // and for whom (audience).
  get identityJwksUrl() {
    return required("IDENTITY_JWKS_URL");
  },
  get identityIssuer() {
    return required("IDENTITY_ISSUER");
  },
  get identityAudience() {
    return optional("IDENTITY_AUDIENCE", "wellbeing");
  },

  /** Origin allowed on cookie-authenticated writes. Empty = the request's own origin. */
  get appOrigin() {
    return optional("APP_ORIGIN");
  },

  /** Turns an Idempotency-Key into a repeatable access key, so a retried submit gets the same key back. */
  get accessKeySecret() {
    return required("ACCESS_KEY_SECRET");
  },

  // Anonymous abuse limits. Per-address counters live in memory only and are never stored or logged.
  /** New booking requests per address in each 10-minute window. */
  get requestsPerIp() {
    return number("RATE_REQUESTS_PER_IP", 5);
  },
  /** Wrong access-key tries per address in each 10-minute window. This stops key guessing. */
  get keyFailuresPerIp() {
    return number("RATE_KEY_FAILURES_PER_IP", 20);
  },
  /** Urgency checks and service suggestions per address in each 10-minute window (protects the AI). */
  get triageChecksPerIp() {
    return number("RATE_TRIAGE_CHECKS_PER_IP", 10);
  },
  /** New requests per hour from ALL addresses together, counted in the database. */
  get requestsPerHour() {
    return number("RATE_REQUESTS_PER_HOUR", 60);
  },
  /** How far ahead a student can book. */
  get bookingHorizonDays() {
    return number("BOOKING_HORIZON_DAYS", 30);
  },

  // Outbound webhook to the Notification Hub
  /** Where the Hub receives our webhooks. Empty = events wait safely in the outbox table. */
  get hubWebhookUrl() {
    return optional("HUB_WEBHOOK_URL");
  },
  /** Shared secret for the HMAC signature on every webhook we send (see events/contract.ts). */
  get hubSigningSecret() {
    return required("HUB_SIGNING_SECRET");
  },
  /** Optional extra bearer token, if the Hub also asks for one. */
  get hubMachineToken() {
    return optional("HUB_MACHINE_TOKEN");
  },
  /** Secret the Hub signs its inbound receipts with. */
  get hubInboundSecret() {
    return required("HUB_INBOUND_SECRET");
  },
  /** Scoped machine credential for the dispatcher route. */
  get dispatchToken() {
    return required("DISPATCH_TOKEN");
  },
  /** After this many failed tries an event is "parked": it is kept but no longer retried. */
  get webhookMaxAttempts() {
    return number("WEBHOOK_MAX_ATTEMPTS", 6);
  },
  /** Wait before the first retry; each later retry waits twice as long as the one before. */
  get webhookBackoffBaseSeconds() {
    return number("WEBHOOK_BACKOFF_BASE_SECONDS", 30);
  },

  // AI urgency assessment
  /** Main switch for AI calls. Off (the default) = only the fixed keyword rules are used. */
  get aiTriageEnabled() {
    return optional("AI_TRIAGE_ENABLED", "false") === "true";
  },
  get llmApiKey() {
    return optional("LLM_API_KEY");
  },
  // Groq (OpenAI-compatible API): free tier, no card. `||` so an empty value means "default".
  get llmModel() {
    return optional("LLM_MODEL") || "openai/gpt-oss-20b";
  },
  get llmBaseUrl() {
    return optional("LLM_BASE_URL") || "https://api.groq.com/openai/v1";
  },
  /** Most AI calls per day, counted in the database. After that the fixed rules answer. */
  get aiDailyBudget() {
    return number("AI_DAILY_BUDGET", 200);
  },
  /** How long to wait for the AI before giving up and using the fixed rules. */
  get aiTimeoutMs() {
    return number("AI_TIMEOUT_MS", 3000);
  },

  /**
   * Partner integration: Team 14's Helpdesk API base URL, e.g. https://<host>/api/v1. We read their
   * public campus contacts list. Empty = off: no call is made and the hard-coded numbers are used.
   */
  get helpdeskApiBaseUrl() {
    return optional("HELPDESK_API_BASE_URL");
  },

  /** Turns on the built-in fake Notification Hub at /api/v1/mock/hub, for tests and demos. */
  get mockHubEnabled() {
    return optional("MOCK_HUB_ENABLED", "false") === "true";
  },
  /** Short git commit id, shown by the health route. */
  get version() {
    return optional("VERCEL_GIT_COMMIT_SHA", "dev").slice(0, 7);
  },
};
