# Runbook — Wellbeing Intake & Booking (Team 16)

## Ownership

| Area | Owner | Backup |
| --- | --- | --- |
| Service overall / demo lead | Teerapat Sukkasem | Dechawat Wetprasit |
| Database, migrations, seed (Supabase project `jtwrgfcmfghfklddyatv`) | Teerapat Sukkasem | Thiraphot Punkham |
| Identity adapter, sessions | Dechawat Wetprasit | Nithikorn Suttanu |
| Webhooks, outbox dispatcher, mock hub | Thiraphot Punkham | Nithanthip Kulmong |
| AI helper (Groq key, daily budget, fallback matcher) | Nithanthip Kulmong | Teerapat Sukkasem |
| Tests, CI, accessibility checks | Nithikorn Suttanu | Dechawat Wetprasit |
| Vercel project owner (Hobby is single-owner — env vars bottleneck here) | Teerapat Sukkasem | — |
| GitHub repository owner (Actions secrets `APP_URL`, `DISPATCH_TOKEN`) | Teerapat Sukkasem | — |

Team 16: Dechawat Wetprasit (6731503011) · Thiraphot Punkham (6731503014) · Teerapat Sukkasem
(6731503015) · Nithanthip Kulmong (6731503018) · Nithikorn Suttanu (6731503019).

**Single points of failure:** the Vercel, Supabase, Groq and GitHub accounts all belong to Teerapat.
If he is unavailable on demo day nobody else can change an environment variable or redeploy — add a
second member to the Supabase organisation (free) and as a GitHub collaborator before the demo.

Partner contact: **Team 14 — Helpdesk** — Pupattararak Masomjit (6731503115) (they consume `GET /api/v1/services`).
We are not paired with Team 01 Identity, Team 20 Notification Hub or Team 23 Gateway: identity runs
in fixture mode and webhooks go to the built-in contract mock.

Acute-flagged requests (BR-04): owned by the intake coordinator until a practitioner marks them
Escalated. Demo-world response time — **acknowledged within 1 hour during staffed demo
sessions; policy owner Teerapat Sukkasem (confirmed for demo operations, BR-04).** The app itself
never promises a response time: the Urgent path always shows the emergency contacts first.

## Health check

```bash
curl -s https://wellbeing-intake.vercel.app/api/v1/health
# {"status":"ok","service":"wellbeing","version":"<sha>","database":"up"}   -> 200
# {"status":"degraded", ... "database":"down"}                              -> 503
```

`/emergency` and the home page shell are static: they stay up even when this returns 503.

Every log line is one JSON object with `cid` (correlation id). To trace one request end to end,
filter Vercel function logs by that `cid`; webhook deliveries log `kind:"webhook"` with `eventId`,
`attempt`, `status`, `outcome`.

## Failure recovery

### Database paused (Supabase Free pauses after ~7 days idle) — most likely failure
Symptom: health 503, every screen except `/` shell and `/emergency` errors.
1. Supabase dashboard → project → **Restore**. Wait until active.
2. `pnpm seed` against it if data was lost or stale.
3. Confirm health 200. Check the *Dispatch & keep-alive* workflow is green — it is what prevents this.

### Webhook deliveries failing / parked
Symptom: logs show `outcome:"retry_scheduled"` or `"parked"`; bookings still succeed (by design).
```sql
select event_id, type, attempts, last_status, next_attempt_at, failed_at
  from outbound_event where delivered_at is null order by occurred_at;
```
- Retrying rows recover on their own once the Hub is back (exponential backoff).
- Replay parked rows after the Hub is fixed:
  ```sql
  update outbound_event set failed_at = null, next_attempt_at = now()
   where failed_at is not null and delivered_at is null;
  ```
  then trigger a dispatch (below). `eventId` is unchanged, so the Hub de-duplicates.
- A reminder whose appointment time has passed is pointless: leave it parked.

### Trigger a dispatch by hand
```bash
curl -s -X POST https://wellbeing-intake.vercel.app/api/v1/internal/events/dispatch -H "Authorization: Bearer $DISPATCH_TOKEN"
# {"enqueued":0,"claimed":1,"delivered":1,"retrying":0,"parked":0}
```

### AI helper down
Nothing to do: the keyword fallback answers automatically and the response says `mode:"fallback"`;
the log line (`kind:"finder"`) gives the reason — `disabled`, `budget_exhausted` or `ai_unavailable`.
- Provider is Groq (free tier: about 8,000 tokens per minute and 1,000 requests per day). Hitting the
  per-minute limit returns `429` and recovers by itself within a minute (proven in A5 §6b).
- Our own cap is `AI_DAILY_BUDGET` (200 calls per day); it resets at midnight UTC.
- If Groq retires the model, the helper falls back silently: check https://console.groq.com/docs/models
  and set `LLM_MODEL` in Vercel to a current one (default `openai/gpt-oss-20b`), then redeploy.
- To force fallback (misbehaviour): set `AI_FINDER_ENABLED=false` in Vercel and redeploy.

### Identity
The deployment runs `IDENTITY_MODE=fixture` (seeded demo accounts); we are not paired with Team 01.
State this openly at the demo. `campus` mode is untested against real Team 01 tokens.

### A secret leaked (service-role key, signing secret, dispatch token, LLM key)
1. Rotate it at the source (Supabase → API settings; Groq console → API Keys; `openssl rand -hex 24` for the signing secrets and dispatch token).
2. Update Vercel env vars **and** GitHub Actions secrets. Redeploy.
3. `pnpm build && pnpm scan:bundle` to confirm the client bundle is clean.
4. Because data is seeded and disposable, run `pnpm seed` to discard anything written meanwhile.

### Reset the whole dataset (NFR-09)
`pnpm seed` — truncates every table, deletes every auth user, reloads fixtures. Local full rebuild:
`pnpm db:reset`.

## Deploy

Vercel auto-deploys `main`; pull requests get previews (they share the one hosted database — reseed
after testing on a preview). Schema changes: add a migration under `supabase/migrations`, then
`pnpm exec supabase db push` against the linked project **before** merging code that needs it.

Required Vercel env vars: everything in `.env.example` (no `NEXT_PUBLIC_` prefixes). Generate fresh
values for `HUB_SIGNING_SECRET`, `HUB_INBOUND_SECRET` and `DISPATCH_TOKEN` (`openssl rand -hex 24`) —
the app refuses empty or placeholder values. `MOCK_HUB_ENABLED=true` and `HUB_WEBHOOK_URL=<app>/api/v1/mock/hub` on the deployment (no Notification
Hub partner); while it is true, the mock's outage switch (`PUT`) requires the `DISPATCH_TOKEN` bearer.

In the hosted Supabase project, **disable sign-ups** (Authentication → Sign In / Providers → turn off
"Allow new users to sign up"). Accounts come from `pnpm seed` only (BR-21); the identity adapter also
ignores any account that lacks the seeded `app_metadata.kind`.

Required GitHub Actions secrets: `APP_URL`, `DISPATCH_TOKEN`.

## Pre-demo checklist

Last verified 2026-09-21 on https://wellbeing-intake.vercel.app — **re-check everything on demo day.**

- [x] Supabase project active; `pnpm seed` run; health 200
- [x] `pnpm test && pnpm test:integration` green; CI green on `main`
- [x] `pnpm build && pnpm scan:bundle` clean
- [x] Identity mode decided (fixture) and one sign-in tested in it
- [x] One reminder delivered to the Hub target with a valid signature; no parked outbox rows
- [x] Helper checked twice: `mode:"ai"` and `mode:"fallback"` (flag off, and provider rate-limited)
- [ ] Hosted Supabase: "Allow new users to sign up" turned off
- [ ] No Vercel Analytics or Speed Insights enabled (NFR-04)
- [ ] Scripted journey + urgent-escalation edge case rehearsed with zero failures
- [ ] Screens checked for demo-only data before any screenshot is taken
