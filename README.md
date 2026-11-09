# Wellbeing — Campus Counselling Platform (Team 16)

Pod 4 (Student Support) of the University Digital Campus Platform. Students request a private counselling
appointment with no login and no personal details, then track it with a Private Access Key. Every session is
followed by an automatic 15-minute buffer, so students don't meet in the entryway or waiting room.

> **Demo data only.** This is a prototype. Never load real student records, and never type real personal
> problems into the deployed demo.

- Product requirements: [`docs/PRD.md`](docs/PRD.md) (the earlier design is in [`docs/archive/`](docs/archive))
- API contract (OpenAPI 3.1): [`openapi.yaml`](openapi.yaml)
- Building the screens: [`docs/BACKEND-HANDOFF.md`](docs/BACKEND-HANDOFF.md)
- Operations: [`RUNBOOK.md`](RUNBOOK.md)
- Earlier frontend notes: [`docs/FRONTEND-HANDOFF.md`](docs/FRONTEND-HANDOFF.md)
- **Live:** <https://wellbeing-intake.vercel.app> (runs the previous design until this rebuild is switched on)

Coursework A3, A5, A6/A7 and A8 in `docs/` describe the previous design and have not been updated for this rebuild.

## Stack

Next.js 16 (App Router, Route Handlers) on Vercel, Supabase Postgres and Auth, TypeScript, Zod, Vitest, GitHub
Actions, and Groq for AI triage. No analytics and no telemetry.

```
Browser (holds no database credential)
   |  static emergency page; everything else goes through the API
   v
Next.js Route Handlers: /api/v1/*, the ONLY data path
   |  src/lib/http.ts        correlation ids, staff roles, identical 404s, origin check, content-free logs
   |  src/lib/access-key.ts  Private Access Keys: shown once, stored only as a hash
   |  src/lib/slots/         slots calculated from opening hours, never stored
   |  src/lib/urgency/       AI assessment, urgency phrases, and the "URGENT if anyone says so" rule
   |  src/lib/events/        webhook contract, HMAC signing, outbox dispatcher
   v
Supabase Postgres: deny-all row level security (zero policies); the rules live in the database:
   an exclusion constraint makes overlapping sessions and buffers impossible; plpgsql transactions
   for decisions; a transactional outbox; a CHECK allowlist on webhook payloads
```

## Run it locally

### UI-only preview (no database)

For frontend work, add `UI_PREVIEW=true` to `.env.local` and run `pnpm dev`. This mode only runs in
development; production always uses the real API.

### Full stack

Prerequisites: Node 22.12+ (or 24), pnpm 10, Docker Desktop (running).

```bash
pnpm install
pnpm db:start                 # local Supabase stack; applies supabase/migrations
pnpm db:env                   # prints API_URL, ANON_KEY, SERVICE_ROLE_KEY
cp .env.example .env.local    # paste those three values in, and generate the secrets:
                              # ACCESS_KEY_SECRET, HUB_SIGNING_SECRET, HUB_INBOUND_SECRET, DISPATCH_TOKEN
                              # with: openssl rand -hex 24
pnpm seed                     # destroys the dataset and loads demo fixtures
pnpm dev                      # http://localhost:3000
```

Local demo accounts (password = `SEED_PASSWORD`, default `demo-password-16`):

| Role | Email |
| --- | --- |
| Practitioner | `practitioner.1@demo.test`, `practitioner.2@demo.test` |
| Administrator | `admin@demo.test` |

Students don't have accounts. A hosted database needs a private `SEED_PASSWORD`, and `pnpm seed` refuses the
default there, because anyone can post a note and staff logins can read notes.

## Checks

| Command | What it proves |
| --- | --- |
| `pnpm test` | Unit: slot and buffer rules, access keys, urgency rule, AI path with the network stubbed, webhook contract |
| `pnpm test:integration` | Real route handlers against the local database, including the PRD's `TEST-01` to `TEST-07`. Reseeds first. |
| `pnpm eval:ai` | The urgency rule on the 12-case golden set (`eval/eval-cases.json`), with no key or network |
| `pnpm eval:ai:live` | The same set against the real model. Run by hand; needs a key in `.env.vercel` |
| `pnpm typecheck`, `pnpm lint` | Types and lint |
| `pnpm check:openapi` | Every implemented route is in `openapi.yaml`, and vice versa |
| `pnpm build && pnpm scan:bundle` | No server secret reached the client bundle |

The PRD's 7 test paths are in `tests/integration/test-plan.test.ts`, one `describe` block per test ID.

## How the core rules work

- **15-minute buffer:** each request stores `slot_start`, `slot_end` and `buffer_end`. A Postgres exclusion
  constraint on `[slot_start, buffer_end)` makes it impossible for two live requests to overlap on the one shared
  calendar, however many clients race. Cancelling or rejecting releases the time at once.
- **Access keys:** `WB-XXXX-XXXX-XXXX` has 60 bits of randomness, is unrelated to the request id, and only its
  SHA-256 hash is stored. A wrong key and an unknown request return the same `404`.
- **Urgency:** a request is `URGENT` if the AI, the urgency phrases or the student says so. Nothing lowers a
  student's own choice. The AI only runs if the student opts in, and any AI failure falls back without blocking.
  The answer is reduced to `ROUTINE` or `URGENT`, so model-written text can never reach a screen.
- **Webhook:** `appointment.confirmed` carries only `event_type`, `appointment_id`, `scheduled_time` and
  `privacy_buffer_end`. An outage delays delivery but never blocks a decision.

## Integration points

| Direction | Partner | What | Where |
| --- | --- | --- | --- |
| We provide | **Team 14 Helpdesk** | `GET /api/v1/services`, `GET /api/v1/health` | `openapi.yaml`, [`integration/team14/`](integration/team14) (still describes the previous contract) |
| We send | Notification Hub | `appointment.confirmed`, `appointment.cancelled`, signed | `src/lib/events/` |
| We receive | Notification Hub | `notification.delivered` / `notification.failed` receipts, idempotent on `eventId` | `src/app/api/v1/webhooks/notification-hub` |

There is no Notification Hub partner, so `HUB_WEBHOOK_URL` points at the built-in contract mock
(`/api/v1/mock/hub`, only when `MOCK_HUB_ENABLED=true`), which verifies the signature and exact body over real
HTTP. `PUT /api/v1/mock/hub {"fail": true}` with `Authorization: Bearer <DISPATCH_TOKEN>` simulates an outage.

Webhook signature: `X-Signature: sha256=<hex>` is the HMAC-SHA256 of `"<X-Signature-Timestamp>.<raw body>"`;
timestamps older than 5 minutes are rejected. `X-Event-Id` stays the same across retries.

## Rules for contributors

1. **Never** call `supabase.from()` from a client component, and never give a secret a `NEXT_PUBLIC_` prefix. The
   browser holds no database credential, and row level security is deny-all on purpose.
2. Every route goes through `route()` in `src/lib/http.ts`, except the two webhook receivers, which need the raw body.
3. Never log an intake note, an alias, an urgency level or an access key. Logs carry method, path, status, role,
   timing and correlation id. The path is logged without its query string.
4. Adding a field that could identify a student to `appointment_request` or to a webhook needs the team's agreement
   first. The allowlist tests will fail until they are updated deliberately.
5. Contract changes go through `openapi.yaml`, agreed with whoever consumes them.
