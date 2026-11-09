# Runbook — Wellbeing Campus Counselling Platform (Team 16)

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
We have no Notification Hub partner: webhooks go to the built-in contract mock. Staff sign in with seeded demo accounts.

Urgent requests: pinned to the top of the practitioner queue. Students are anonymous, so **staff cannot contact
them**. The app never promises a response time, and an Urgent result always shows the emergency contacts first.

## Health check

```bash
curl -s https://wellbeing-intake.vercel.app/api/v1/health
# {"status":"ok","service":"wellbeing","version":"<sha>","database":"up"}   -> 200
# {"status":"degraded", ... "database":"down"}                              -> 503
```

`/emergency` is static and stays up even when this returns 503.

Every log line is one JSON object with `cid` (correlation id). To trace one request end to end, filter Vercel
function logs by that `cid`. Webhook deliveries log `kind:"webhook"` with `eventId`, `attempt`, `status` and
`outcome`; triage logs `kind:"triage"` with `mode` and `reason`. Our logs never hold a note, alias, urgency or key.
Vercel's own request logs do record full URLs, which is why the web app sends the access key in a header.

## Switching production to this version

The site runs the previous design until this is done. **Step 3 destroys the old tables and logins.**

1. Warn Team 14 first: `GET /services` changes shape and service names.
2. Make sure the new screens are ready on the same branch. The old screens do not work with this API.
3. Apply the schema to the linked project: `pnpm exec supabase db push`
4. Load fixtures, with a **private** password that is shared only inside the team:
   ```bash
   SEED_PASSWORD=<private> pnpm exec tsx --env-file=.env.vercel scripts/seed.ts --confirm-remote=jtwrgfcmfghfklddyatv.supabase.co
   ```
5. In Vercel, add `ACCESS_KEY_SECRET` (`openssl rand -hex 24`, keep it stable) and `AI_TRIAGE_ENABLED=true`.
   Remove `AI_FINDER_ENABLED` and `REMINDER_LEAD_HOURS`.
6. Merge to `main`. Vercel deploys. Then work through the pre-demo checklist below.

**To go back:** the old code is the git tag `v1-old-design`. Its database has to be rebuilt from its own two
migrations and reseeded, because step 3 removes the old tables.

## Failure recovery

### Database paused (Supabase Free pauses after ~7 days idle) — most likely failure
Symptom: health 503, every screen except `/emergency` errors.
1. Supabase dashboard, then the project, then **Restore**. Wait until active.
2. Confirm health 200. Check the *Dispatch & keep-alive* workflow is green: it is what prevents this.
3. Only if data was lost: reseed as in step 4 above.

### Webhook deliveries failing or parked
Symptom: logs show `outcome:"retry_scheduled"` or `"parked"`. Decisions still succeed (by design).
```sql
select event_id, type, reference, attempts, last_status, next_attempt_at, failed_at
  from outbound_event where delivered_at is null and payload is not null order by occurred_at;
```
- Retrying rows recover on their own once the Hub is back (exponential backoff).
- Replay rows parked by the attempt cap once the Hub is fixed. `payload is not null` matters: rows with no payload
  were deliberately neutralised by a later reschedule or cancellation and must never be sent.
  ```sql
  update outbound_event set failed_at = null, next_attempt_at = now()
   where failed_at is not null and delivered_at is null and payload is not null;
  ```
  then trigger a dispatch (below). `X-Event-Id` is unchanged, so the Hub de-duplicates.

### Trigger a dispatch by hand
```bash
curl -s -X POST https://wellbeing-intake.vercel.app/api/v1/internal/events/dispatch -H "Authorization: Bearer $DISPATCH_TOKEN"
# {"claimed":1,"delivered":1,"retrying":0,"parked":0}
```

### AI down
Nothing to do: requests still work, and the response says `triage_mode:"DETERMINISTIC_FALLBACK"`. The log line
(`kind:"triage"`) gives the reason: `not_selected`, `prompt_injection_blocked`, `disabled`, `budget_exhausted`
or `ai_unavailable`.
- Provider is Groq (free tier: about 8,000 tokens per minute and 1,000 requests per day). Hitting the per-minute
  limit returns `429` and recovers by itself within a minute.
- Our own cap is `AI_DAILY_BUDGET` (200 calls per day); it resets at midnight UTC.
- If Groq retires the model, triage falls back silently: check https://console.groq.com/docs/models and set
  `LLM_MODEL` in Vercel to a current one (default `openai/gpt-oss-20b`), then redeploy.
- To turn AI off: set `AI_TRIAGE_ENABLED=false` in Vercel and redeploy.

### The calendar is being flooded
Symptom: slots disappear and the queue fills with junk. Anonymous submitting is limited per address and to
`RATE_REQUESTS_PER_HOUR` (60) overall, but a determined script can still hold some slots.
- Practitioners can reject junk requests from the queue, which frees the times immediately.
- To clear them all at once:
  ```sql
  update appointment_request set status = 'REJECTED' where status = 'PENDING' and created_at > '<when it started>';
  ```
- Lower `RATE_REQUESTS_PER_HOUR` in Vercel and redeploy.

### A student lost their access key
It cannot be recovered: only its hash is stored, and the student is anonymous. They can submit a new request. The
old request keeps its time until a practitioner rejects it or the time passes.

### A secret leaked (service-role key, signing secret, dispatch token, access key secret, LLM key)
1. Rotate it at the source (Supabase API settings; Groq console, API Keys; `openssl rand -hex 24` for the others).
2. Update Vercel env vars **and** GitHub Actions secrets. Redeploy.
3. `pnpm build && pnpm scan:bundle` to confirm the client bundle is clean.
4. Rotating `ACCESS_KEY_SECRET` does not stop existing keys working. It only means a retry of an earlier submission
   gets a key that does not match, so rotate it when no form is mid-submission.

### Reset the whole dataset
Local: `pnpm seed`, or `pnpm db:reset` for a full rebuild. Hosted: step 4 above. Either way it truncates every
table, deletes every auth user and reloads fixtures. A hosted database refuses the command unless the host is
confirmed and the password is private.

## Deploy

Vercel auto-deploys `main`; pull requests get previews (they share the one hosted database). Schema changes: add a
migration under `supabase/migrations`, then `pnpm exec supabase db push` against the linked project **before**
merging code that needs it.

Required Vercel env vars: everything in `.env.example` (no `NEXT_PUBLIC_` prefixes). The app refuses empty or
placeholder secrets. `MOCK_HUB_ENABLED=true` and `HUB_WEBHOOK_URL=<app>/api/v1/mock/hub` on the deployment (no
Notification Hub partner); while it is true, the mock's outage switch (`PUT`) requires the `DISPATCH_TOKEN` bearer.

In the hosted Supabase project, **disable sign-ups** (Authentication, Sign In / Providers, turn off "Allow new users
to sign up"). Staff accounts come from the seed only; an account with no `staff` row gets no access.

Required GitHub Actions secrets: `APP_URL`, `DISPATCH_TOKEN`.

## Pre-demo checklist

Not yet run on this version. **Check everything on demo day.**

- [ ] Supabase project active; fixtures loaded with a private password; health 200
- [ ] `pnpm test && pnpm test:integration` green; CI green on `main`
- [ ] `pnpm build && pnpm scan:bundle` clean
- [ ] Student journey on the live site: pick a time, submit, save the key, check status, cancel
- [ ] Practitioner journey: sign in, see Urgent first, approve, reschedule, reject
- [ ] Buffer shown: book a time and see the next slot only after the buffer, on the student and practitioner screens
- [ ] AI checked twice: `triage_mode:"AI_ASSISTED"`, and `DETERMINISTIC_FALLBACK` with the flag off
- [ ] Urgent path: emergency contacts appear straight away
- [ ] One `appointment.confirmed` delivered to the Hub target with a valid signature; no parked rows
- [ ] Hosted Supabase: "Allow new users to sign up" turned off
- [ ] No Vercel Analytics or Speed Insights enabled
- [ ] Screens checked for demo-only data before any screenshot is taken
