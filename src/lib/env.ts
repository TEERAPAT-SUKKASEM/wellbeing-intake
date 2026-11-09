import "server-only";

// Every secret and switch is server-only: nothing here carries a NEXT_PUBLIC_ prefix.

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.startsWith("change-me")) throw new Error(`Missing required env var ${name}`);
  return v;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

function number(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return process.env[name] && Number.isFinite(parsed) ? parsed : fallback;
}

export const env = {
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
  get requestsPerIp() {
    return number("RATE_REQUESTS_PER_IP", 5);
  },
  get keyFailuresPerIp() {
    return number("RATE_KEY_FAILURES_PER_IP", 20);
  },
  get triageChecksPerIp() {
    return number("RATE_TRIAGE_CHECKS_PER_IP", 10);
  },
  get requestsPerHour() {
    return number("RATE_REQUESTS_PER_HOUR", 60);
  },
  /** How far ahead a student can book. */
  get bookingHorizonDays() {
    return number("BOOKING_HORIZON_DAYS", 30);
  },

  // Outbound webhook to the Notification Hub
  get hubWebhookUrl() {
    return optional("HUB_WEBHOOK_URL");
  },
  get hubSigningSecret() {
    return required("HUB_SIGNING_SECRET");
  },
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
  get webhookMaxAttempts() {
    return number("WEBHOOK_MAX_ATTEMPTS", 6);
  },
  get webhookBackoffBaseSeconds() {
    return number("WEBHOOK_BACKOFF_BASE_SECONDS", 30);
  },

  // AI urgency assessment
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
  get aiDailyBudget() {
    return number("AI_DAILY_BUDGET", 200);
  },
  get aiTimeoutMs() {
    return number("AI_TIMEOUT_MS", 3000);
  },

  get mockHubEnabled() {
    return optional("MOCK_HUB_ENABLED", "false") === "true";
  },
  get version() {
    return optional("VERCEL_GIT_COMMIT_SHA", "dev").slice(0, 7);
  },
};
