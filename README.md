# Private Wellbeing Intake & Booking — Team 16

Pod 4 (Student Support) of the University Digital Campus Platform. Students privately request a
campus health, counselling or wellbeing service, get safe urgency guidance, and book a confirmed
slot. Sensitive content is visible only to the practitioner who needs it, crisis contacts are
always one step away, and every view of request content is audited.

> **Demo data only.** This is a privacy-by-design prototype on seeded, fictional data (PRD C-11,
> BR-18). Never load real student records, and never put any record in this repo or in screenshots.

- Product requirements: [`docs/PRD.md`](docs/PRD.md)
- API contract (OpenAPI 3.1): [`openapi.yaml`](openapi.yaml)
- Operations: [`RUNBOOK.md`](RUNBOOK.md)
- Frontend-to-backend handoff: [`docs/FRONTEND-HANDOFF.md`](docs/FRONTEND-HANDOFF.md)
- A3 data and query design: [`docs/A3-Team16-Data-and-Query-Design.md`](docs/A3-Team16-Data-and-Query-Design.md) (PDF: `pnpm docs:pdf docs/A3-Team16-Data-and-Query-Design.md`)
- A5 integration evidence: [`docs/A5-Team16-Integration-Evidence.md`](docs/A5-Team16-Integration-Evidence.md) — captures from the live deployment
- Partner integration (Team 14 — Helpdesk): [`integration/team14/`](integration/team14) — contract, Postman collection, reference client, smoke test
- **Live:** <https://wellbeing-intake.vercel.app> · API base `https://wellbeing-intake.vercel.app/api/v1`

## Stack

Next.js 16 (App Router, Route Handlers) on Vercel · Supabase Postgres + Auth · TypeScript · Zod ·
Vitest · GitHub Actions. No analytics, no telemetry (NFR-04).

```
Browser (holds NO database credential)
   │  static pages: service finder shell, /emergency (zero data dependency)
   ▼
Next.js Route Handlers — /api/v1/* — the ONLY data path
   │  src/lib/http.ts       correlation id, default-deny roles, identical 404, origin check, content-free logs
   │  src/lib/identity/     the ONLY module that verifies a credential (fixture | campus)
   │  src/lib/events/       platform envelope, data allowlist, HMAC signing, outbox dispatcher
   │  src/lib/finder/       "help me choose": LLM ranking (Groq) + deterministic keyword fallback
   ▼
Supabase Postgres — deny-all RLS (zero policies); invariants live in the database:
   partial unique indexes (no double booking) · plpgsql transactions (booking, cancel,
   audit-on-read) · append-only triggers · immutable request content · transactional outbox
```

## Run it locally

### UI-only preview (no database)

For frontend work, add `UI_PREVIEW=true` to `.env.local` and run `npm run dev`.
The homepage shows fictional sample services, and their request buttons open the form without
sign-in. The helper uses local word matching. Form validation, an urgent state, and a fictional
dashboard with sample booking and cancellation are clickable; nothing is sent or saved.
Use the navigation's **My requests** link to jump to `/preview/requests`.
This mode only runs in development;
production always uses the real API. Remove the flag to use the normal backend flow.

The preview and connected `/requests` route render the same `RequestsDashboard`,
`StudentRequestCard`, `BookingTimePicker`, and `AppointmentSummary` components. Only the data
source changes: preview uses isolated in-memory fixtures; production calls `/api/v1`.
The preview does not store request content, credentials, or browser data. Appointment duration,
end time, and location are omitted because the current API does not supply them.
Cancellation does not reopen a handled request; both modes offer a new-request action afterward.

Prerequisites: Node 22.12+ (or 24), pnpm 10, Docker Desktop (running).

```bash
pnpm install
pnpm db:start                 # local Supabase stack; applies supabase/migrations
pnpm db:env                   # prints API_URL, ANON_KEY, SERVICE_ROLE_KEY
cp .env.example .env.local    # paste those three values in, and generate the three secrets
                              # (HUB_SIGNING_SECRET, HUB_INBOUND_SECRET, DISPATCH_TOKEN): openssl rand -hex 24
pnpm seed                     # destroys the dataset and loads demo fixtures (NFR-09 reset)
pnpm dev                      # http://localhost:3000
```

Demo accounts (password = `SEED_PASSWORD`, default `demo-password-16`):

| Role | Email |
| --- | --- |
| Student | `student.a@demo.test`, `student.b@demo.test`, `student.c@demo.test` |
| Practitioner — Counselling | `counsellor.1@demo.test`, `counsellor.2@demo.test` |
| Practitioner — Health clinic | `nurse.1@demo.test` |
| Practitioner — Physiotherapy | `physio.1@demo.test` |
| Practitioner — Wellbeing advising | `wellbeing.1@demo.test` |
| Intake coordinator | `coordinator@demo.test` |

**The demo journey:** browse `/` signed out → try "help me choose" → request a service → sign in as
a student → submit → sign in as that service's practitioner, open the request (logged; status
becomes *In review*) → back as the student, book a time → cancel it. For the escalation edge case
choose **Urgent** on the form.

No Docker? Create a free Supabase project, put its URL and keys in `.env.local`, run
`pnpm exec supabase link` and `pnpm exec supabase db push`, then `pnpm seed`.

## Checks

| Command | What it proves |
| --- | --- |
| `pnpm test` | Unit: payload allowlist, envelope, signing, fallback matcher, the AI path with the network stubbed (no database needed) |
| `pnpm test:integration` | The seven mandated areas + event contract, AI fallback, platform conventions — real route handlers against the local stack. Reseeds first. |
| `pnpm typecheck` · `pnpm lint` | Types and lint |
| `pnpm check:openapi` | Every implemented route is in `openapi.yaml`, and vice versa |
| `pnpm build && pnpm scan:bundle` | No server secret reached the client bundle (PRD R-2) |

Test areas → files: Request, Privacy, Role boundary, Booking, Cancellation, Urgent escalation →
`tests/integration/journey.test.ts`; Reminder, retraction, inbound webhook →
`tests/integration/events.test.ts`; AI + fallback, health, correlation ids, no-analytics →
`tests/integration/platform.test.ts`.

## Integration points

| Direction | Partner | What | Where |
| --- | --- | --- | --- |
| We consume | Team 01 Identity | Access-token verification (`IDENTITY_MODE=campus`) | `src/lib/identity/adapter.ts` |
| We provide | **Team 14 Helpdesk (live)** · any team / Team 23 gateway | `GET /api/v1/services`, `GET /api/v1/health` | `openapi.yaml`, [`integration/team14/`](integration/team14) |
| We send | Team 20 Notification Hub | `appointment.reminder`, `appointment.cancelled` — signed webhook, platform envelope | `src/lib/events/` |
| We receive | Team 20 Notification Hub | `notification.delivered` / `notification.failed` receipts, idempotent on `eventId` | `src/app/api/v1/webhooks/notification-hub` |

This table is the platform design. The deployment is paired with Team 14 only: identity runs in
fixture mode and, until Team 20's endpoint exists, `HUB_WEBHOOK_URL` points at the built-in contract mock
(`/api/v1/mock/hub`, only when `MOCK_HUB_ENABLED=true`), which verifies the signature and envelope
over real HTTP. `PUT /api/v1/mock/hub {"fail": true}` with `Authorization: Bearer <DISPATCH_TOKEN>` simulates an
outage for the degradation proof.

Signature scheme (placeholder until Teams 20/23 fix the platform's): `X-Signature: sha256=<hex>` =
HMAC-SHA256 of `"<X-Signature-Timestamp>.<raw body>"`; timestamps older than 5 minutes are rejected.

## Rules for contributors

1. **Never** call `supabase.from()` from a client component, and never give a secret a
   `NEXT_PUBLIC_` prefix. The browser holds no database credential; RLS is deny-all on purpose.
2. Every route goes through `route()` in `src/lib/http.ts`. Do not hand-roll auth in a handler.
3. Request content is returned by exactly one path (`content-views`). Do not add a second.
4. Never log a request body. Logs carry method, path, status, role, timing, correlation id.
5. Any new field on `app_user` or `request` needs a recorded privacy re-review (NFR-03) — the
   allowlist tests will fail until you update them deliberately.
6. Contract changes go through a versioned `openapi.yaml` / event-schema pull request agreed with
   the affected teams first.

## AI capability

The only AI in the product is the pre-login "help me choose" helper (FR-23). It sends the typed
text plus the public catalogue to a language model and accepts back **only** a list of seeded
service ids — model-written text never reaches a screen. It is off unless `AI_FINDER_ENABLED=true`
and `LLM_API_KEY` is set; on any error, 3 s timeout, invalid output, or exhausted daily budget, the
deterministic keyword matcher answers. Triage is never AI-assisted.

**Provider: Groq** (`src/lib/finder/ai.ts`), through its OpenAI-compatible API — chosen because its
free tier needs no card, which the 0 THB constraint requires (PRD C-04). `LLM_MODEL` defaults to
`openai/gpt-oss-20b`: the task is picking up to three ids out of four, so a small fast model fits
the 3 s budget. `LLM_BASE_URL` can point at any other API of the same format without a code change.

What leaves our server is asserted by `tests/unit/finder-ai.test.ts`: the
typed text and the public catalogue — no cookie, token, identity or request field (NFR-10).
