# Helpdesk referrals (Team 14 → Wellbeing): design and exact contract

Status: built on branch `feature/helpdesk-referrals`. It is **off** until `REFERRALS_ENABLED=true`.
Source proposal: Team 14's "referrals with a status back" (10 Nov 2026).

## 1. What it does

1. A student on a Helpdesk ticket ticks a consent box and presses **Send to Wellbeing**.
2. Helpdesk calls our `POST /api/v1/referrals` with only a random `ref`, a `service_id` (or null) and
   `consent_at`.
3. A Wellbeing practitioner or admin sees it in a new **Helpdesk referrals** tab on the practitioner desk and
   presses **Accept** or **Decline**.
4. We send Helpdesk a signed callback with the `ref` and the status. Helpdesk closes its ticket on `approved`.

**Privacy rules (do not break):**
- We store and show only `ref`, `service_id`, `consent_at` and our own timestamps. There is no name, email,
  student ID, ticket text or anything else.
- A `ref` is **never** linked to an appointment request. We do **not** accept a `ref` in booking links: that
  would let Helpdesk, which knows the student behind each `ref`, learn about their counselling booking.
- The callback carries only `eventId`, `type` and `data.ref` / `data.status`. It never includes times, a
  counsellor, notes or anything about a session.
- "Approved" means "we accept the referral", not "a session happened". The student still books anonymously
  on our site.
- Referrals are deleted when Helpdesk calls `DELETE` (the student withdrew), and automatically 30 days after
  they arrived.

## 2. Settings (`src/lib/env.ts`)

| Variable | Getter | Meaning |
| --- | --- | --- |
| `REFERRALS_ENABLED` | `env.referralsEnabled` (boolean, default false) | Off → every referral endpoint answers the standard `404 {"error":"not_found"}` |
| `HELPDESK_REFERRAL_TOKEN` | `env.helpdeskReferralToken` (`required()`) | Bearer token **Helpdesk sends to us**. We generate it (32+ random bytes) and give it to them privately |
| `HELPDESK_WEBHOOK_SECRET` | `env.helpdeskWebhookSecret` (`required()`) | HMAC secret for **our callbacks to Helpdesk**. Helpdesk generates it and gives it to us privately |
| `HELPDESK_WEBHOOK_URL` | `env.helpdeskWebhookUrl` (string) | Optional. Default: `${HELPDESK_API_BASE_URL without trailing /}/webhooks/wellbeing`, or `""` if the base URL is empty |

`HELPDESK_API_BASE_URL` already exists (the contacts integration).

## 3. Database: `supabase/migrations/20261110000001_helpdesk_referrals.sql`

```sql
create table referral (
  ref          text primary key check (ref ~ '^hd-[0-9a-f]{32}$'),
  service_id   text references service(id) on delete set null,      -- may be null
  consent_at   timestamptz not null,
  status       text not null default 'received' check (status in ('received','approved','declined')),
  received_at  timestamptz not null default now(),
  decided_at   timestamptz,
  check ((status = 'received') = (decided_at is null))
);

create table referral_event (                                       -- outbox for callbacks to Helpdesk
  event_id        text primary key,                                 -- 'evt-' || gen_random_uuid()
  ref             text not null references referral(ref) on delete cascade,
  status          text not null check (status in ('approved','declined')),
  created_at      timestamptz not null default now(),
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  delivered_at    timestamptz,
  gave_up_at      timestamptz,
  last_status     integer
);
```

- Row-level security on, zero policies, and no rights for `anon` or `authenticated`, the same deny-all
  pattern as `20261109000001_rebuild_schema.sql`.
- **`decide_referral(p_ref text, p_status text) returns jsonb`** (plpgsql, in one transaction, locks the row):
  - unknown `ref` → `{"code":"not_found"}`
  - `p_status` is the same as the current final status → `{"code":"ok","referral":{…}}`, **no new event**
    (idempotent)
  - current status is not `received` → `{"code":"invalid_transition"}`
  - otherwise set `status` and `decided_at = now()`, insert one `referral_event`, and return
    `{"code":"ok","referral":{…},"event_id":"evt-…"}`
  - `referral` JSON keys: `ref, service_id, consent_at, status, received_at, decided_at`, with times as ISO
    8601 UTC strings
- **`purge_old_referrals(p_days integer default 30) returns integer`**: deletes referrals whose `received_at`
  is older than `p_days` days (events cascade), and returns the count.
- At the end, execute rights go to `service_role` only, as in `20261109000002_rebuild_functions.sql`.

## 4. Server library

### `src/lib/referrals.ts` (server-only)

```ts
export const REF_RE = /^hd-[0-9a-f]{32}$/;
export type ReferralStatus = "received" | "approved" | "declined";
export type Referral = {
  ref: string; service_id: string | null; consent_at: string;   // ISO UTC
  status: ReferralStatus; received_at: string; decided_at: string | null;
};
export function helpdeskTokenOk(req: Request): boolean;          // "Authorization: Bearer <t>", constant-time compare with env.helpdeskReferralToken
export async function createReferral(input: { ref: string; service_id: string | null; consent_at: Date }):
  Promise<{ created: boolean; referral: Referral } | { error: "unknown_service" }>;   // existing ref → created:false, row unchanged
export async function getReferral(ref: string): Promise<Referral | null>;
export async function deleteReferral(ref: string): Promise<void>;                  // idempotent
export async function listReferrals(): Promise<Referral[]>;                         // 'received' first, then newest received_at; max 200
export async function decideReferral(ref: string, status: "approved" | "declined"):
  Promise<{ code: "ok"; referral: Referral } | { code: "not_found" } | { code: "invalid_transition" }>;
```

### `src/lib/partners/helpdesk-referrals.ts` (server-only): callbacks to Helpdesk

```ts
export const CALLBACK_TYPE = "wellbeing.referral_status";
export function callbackBody(eventId: string, ref: string, status: "approved" | "declined"): string;
//   exactly JSON.stringify({ eventId, type: CALLBACK_TYPE, data: { ref, status } })  (this key order)
export function signCallback(body: string, timestampSeconds: string, secret: string): string;
//   lowercase hex HMAC-SHA256(secret, `${timestampSeconds}.${body}`)
export async function sendReferralCallbacks(cid: string, limit?: number /* default 10 */):
  Promise<{ skipped: boolean; sent: number; retry: number; gaveUp: number }>;
```

`sendReferralCallbacks`:
- **Skipped:** returns `{skipped:true,…0}` and sends nothing if `!env.referralsEnabled`, the webhook URL is
  empty, or `HELPDESK_WEBHOOK_SECRET` is missing. Events then wait.
- **Which events:** due ones (`delivered_at` and `gave_up_at` null, `next_attempt_at <= now()`), oldest first,
  up to `limit`.
- **Request for each event:** `POST <webhook url>` with
  - body = `callbackBody(...)`
  - headers `Content-Type: application/json`, `X-Timestamp` (Unix **seconds**), `X-Signature` =
    `signCallback(body, ts, secret)`, and `X-Correlation-Id: team16-<cid>` (an id that already starts with
    `team16-` is kept as is; max 128 characters)
  - 3-second timeout
- **Result:**

  | Helpdesk answer | What we do |
  | --- | --- |
  | any 2xx | `delivered_at=now()`, `last_status` |
  | any other 4xx | `gave_up_at=now()`, `last_status`; no retry |
  | 5xx, timeout or network error | `attempts+1`, `next_attempt_at = now() + 30s × 2^attempts`; give up after 8 attempts |

  Retries reuse the same `eventId` and body.
- **Logs:** one content-free line per send:
  `{"t","svc":"wellbeing","kind":"partner","partner":"helpdesk","op":"referral_callback","cid","outcome","ms"}`.
  `outcome` is `ok`, `http_<n>`, `timeout` or `network`. Never log the `ref`.

## 5. API routes (all use `route()` from `src/lib/http.ts`)

When `!env.referralsEnabled`, every route below throws `notFound()` first, so the answer is an identical
`404 {"error":"not_found"}`.

| Route | Access | Behaviour |
| --- | --- | --- |
| `POST /api/v1/referrals` (`src/app/api/v1/referrals/route.ts`) | `public` + `helpdeskTokenOk` else `401 {"error":"unauthenticated"}`; in-memory limit `"referral"` 60 per 10 min per address → `429` | Body (strict zod): `ref` (REF_RE), `service_id` (`/^srv_[a-z0-9_]+$/` or `null`), `consent_at` (ISO datetime with offset). `consent_at` more than 5 min in the future or more than 30 days old → `400 validation_failed ["consent_at"]`. Unknown service → `400 validation_failed ["service_id"]`. New → `201 {"id":ref,"status":"received"}`; existing ref → `200` with the same shape |
| `GET /api/v1/referrals/{ref}` (`src/app/api/v1/referrals/[ref]/route.ts`) | `public` + token | `200 {"status":"received"\|"approved"\|"declined"}`; unknown or badly formed ref → `404` |
| `DELETE /api/v1/referrals/{ref}` (same file) | `public` + token | Always `200 {"deleted":true}` (idempotent) |
| `GET /api/v1/practitioner/referrals` (`src/app/api/v1/practitioner/referrals/route.ts`) | `["practitioner","admin"]` | `200 Referral[]` from `listReferrals()` |
| `PATCH /api/v1/practitioner/referrals/{ref}` (`src/app/api/v1/practitioner/referrals/[ref]/route.ts`) | `["practitioner","admin"]` (route() enforces same-origin for cookies) | Body (strict): `{"status":"approved"\|"declined"}`. `ok` → `200 Referral`, then `await sendReferralCallbacks(cid, 3)` inside try/catch (never fails the request); `not_found` → `404`; `invalid_transition` → `409 {"error":"invalid_transition"}` |
| `POST /api/v1/internal/events/dispatch` (existing) | machine | Keep the existing response keys unchanged, and **add** `referrals: await sendReferralCallbacks(cid)` and `referrals_purged: <purge_old_referrals(30) result>` |

`openapi.yaml` documents the 5 new operations: a `helpdeskBearer` http-bearer security scheme for the
three `/referrals` operations, and `staffBearer` / `staffCookie` for the practitioner ones.

## 6. Staff screen

- **`src/lib/client/contracts.ts`:**
  - `Referral` type (same fields as above)
  - `REFERRAL_STATUS_LABELS = { received: "Waiting for review", approved: "Accepted", declined: "Declined" }`
- **`src/components/HelpdeskReferrals.tsx`:** the list. Each row shows:
  - the service name (from `GET /services`, or "Not specified" for null)
  - when the student consented, and when it arrived (campus time)
  - the status badge
  - the reference shortened to its last 6 characters

  `received` rows have **Accept** and **Decline** buttons, each confirmed in a `<dialog>`, sending
  `PATCH /practitioner/referrals/{ref}`. A short note explains: only a random reference, the service and the
  consent time come from Helpdesk; accepting tells Helpdesk the referral is accepted; the student still books
  anonymously.
- **`src/components/PractitionerDesk.tsx`:** a third tab, **Helpdesk referrals**, with a badge counting
  `received`. It is shown **only** if `GET /practitioner/referrals` answers 200; a 404 means the feature is
  off, so the tab is hidden. Keyboard tab navigation covers all three tabs.

## 7. Tests

- **`tests/unit/helpdesk-referrals.test.ts`:** the exact body, signature vector and token check.
- **`tests/integration/referrals.test.ts`:** real database plus a fake Helpdesk on `127.0.0.1` that checks
  the signature. It covers: off → 404; token; create and replay; validation; status; staff list and decide;
  the callback body and signature; retry on 503 with the same `eventId`; give up on 401; `DELETE`; purge.
- **`tests/integration/setup-env.ts`:**
  - `REFERRALS_ENABLED=false`
  - `HELPDESK_REFERRAL_TOKEN=test-referral-token`
  - `HELPDESK_WEBHOOK_SECRET=test-helpdesk-webhook-secret`
  - `HELPDESK_WEBHOOK_URL=` (empty)

## 8. As built (small decisions made while building)

- **Staff routes while off:** `GET /practitioner/referrals` and `PATCH /practitioner/referrals/{ref}` check
  the switch **before** `route()` runs. While off, a caller who is not signed in also gets `404`, not `401`,
  so nothing reveals that the feature exists.
- **Check order in `POST /referrals`:** switch (404), token (401), rate limit (429; only calls with the
  right token count), then body validation. The body is validated in the handler so the token is checked
  first.
- **`service_id`** may be `null` **or left out**; both mean "no service".
- **A repeated `POST` for an existing `ref`** answers `200` with that referral's **current** status, which
  may already be `approved` or `declined`.
- **`DELETE` with a badly formed `ref`** answers `404`. Any well-formed `ref`, known or not, answers
  `200 {"deleted":true}`.
- **Callback retries:**
  - `408` and `429` from Helpdesk are treated as temporary and retried.
  - Any other `4xx` stops at once.
  - `5xx`, a timeout or a network error retries after 30 s, 60 s, 120 s and so on, up to 8 attempts.
- **Duplicates:** an inline send and a scheduled send can rarely deliver the same event twice. Helpdesk
  de-duplicates on `eventId`.
- **Demo reset:** `pnpm seed` (`reset_demo_data`) also empties `referral` and `referral_event`, because
  they hang off `service`.
- **Signature test vector** (shared with Team 14, from `tests/unit/helpdesk-referrals.test.ts`):
  - `eventId` `evt-3f2b8c1e-9d4a-4e6b-a1c7-5e8f0b2d4c69`, `ref` `hd-0123456789abcdef0123456789abcdef`,
    status `approved`, `X-Timestamp` `1794268800`, secret `test-helpdesk-webhook-secret`
  - Expected `X-Signature`: `f4af2ff2614ec6be66071d34896dea4b899c2afa78257da167d7c547f0651d2c`
