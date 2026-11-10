# Wellbeing: code guide for the team

This guide helps every team member explain how our system works: what each part does, why we built it
that way, and how to answer a teacher's "what does this do?". Every source file also starts with a short
plain-English header comment, so you can open any file and read its first lines.

**How to study it:**
1. Read section 1 (the one-minute version) and section 2 (the big picture) until you can say them without
   reading.
2. Read the journey in section 4 that matches the part you will demo.
3. Practise the questions in section 9 out loud.
4. If the teacher points at a file, open it and read its header comment first.

---

## 1. The project in one minute

**What it is.** Wellbeing is a campus counselling booking site. A student can ask for a private counselling
appointment **without logging in and without giving their name**. After sending the request, the student
gets a **Private Access Key** (like `WB-7K3M-9QXP-2ZTF`). They use it to check the status or cancel.

**Three rules make it special:**
1. **Anonymous.** No student account, no email, no student ID. An optional nickname is all.
2. **15-minute privacy buffer.** After every session the next 15 minutes are blocked on **one shared
   calendar**, so two students never meet in the waiting room.
3. **Safe urgency triage.** Each request is ROUTINE or URGENT. It is URGENT if **any** of three say so:
   the AI (only if the student agrees to use it), a crisis-phrase list (English and Thai), or the
   student's own choice. If the AI fails, the fixed rules still work.

**Who uses it:**

| Role | Signs in? | Can do |
| --- | --- | --- |
| Student | No | Browse services, book, track and cancel with the access key, optional AI helpers |
| Practitioner | Yes (staff account) | See the review queue and schedule; approve, reject, reschedule, cancel |
| Admin | Yes (staff account) | Edit services (name, length, description, on/off) and weekly opening hours |

**Technology:**

| Part | What we use | Why |
| --- | --- | --- |
| Web app and API | Next.js 16 (App Router), React 19, TypeScript | One project for screens and API; types catch mistakes |
| Styling | Tailwind CSS 4 + daisyUI | Fast, consistent design tokens |
| Database and staff login | Supabase (PostgreSQL + Auth) | Real SQL with constraints, functions and row-level security |
| Input checking | Zod | Every request body is checked against a strict schema |
| AI | Groq, model `openai/gpt-oss-20b` | Fast and free tier; always optional |
| Tests | Vitest (unit + integration), GitHub Actions CI | Every pull request is checked automatically |
| Hosting | Vercel (Singapore), auto-deploys `main` | Free, simple, close to Thailand |

**Live site:** <https://wellbeing-intake.vercel.app>

---

## 2. The big picture

```text
 Browser (React pages in src/app, components in src/components)
    │  fetch("/api/v1/...")  same website only, no secrets in the browser
    ▼
 API routes (src/app/api/v1/**/route.ts)
    │  every route goes through route() in src/lib/http.ts:
    │  check ids → sign-in → role → same-origin → validate body → handler → one log line (no content)
    ▼
 Logic (src/lib)
    │  slots/       which times are free (with the 15-minute buffer)
    │  urgency/     ROUTINE or URGENT (phrases + optional AI + student's choice)
    │  matching/    "Get a suggestion" service helper
    │  access-key   make and hash the Private Access Key
    │  events/      webhook contract, signing and sending
    ▼
 Supabase PostgreSQL (supabase/migrations)
    │  tables + database functions that do the booking, cancelling and deciding
    │  an exclusion constraint makes double booking impossible
    │  an "outbox" table holds webhook events until they are delivered
    ▼
 Notification Hub (another system)  ◀── signed webhook: appointment.confirmed / appointment.cancelled
 Groq AI                            ◀── only the student's note (only with consent), answer is one fixed value
```

**One sentence:** the browser calls our API; every API call passes the same security wrapper; the
important rules are enforced **in the database itself**; anything sent to other systems is minimal,
signed and retried safely.

---

## 3. Folder map

```text
src/
  app/                    pages (each folder = a URL) and the API
    page.tsx              /            home: services, "Get a suggestion", emergency numbers
    request/new/page.tsx  /request/new booking form
    requests/page.tsx     /requests    track or cancel with the access key
    sign-in/page.tsx      /sign-in     staff sign-in
    practitioner/page.tsx /practitioner  schedule & triage desk
    admin/page.tsx        /admin       services & opening hours
    emergency/page.tsx    /emergency   emergency numbers (static, works even if the API is down)
    api/v1/               the REST API (one route.ts per endpoint, see section 4 and openapi.yaml)
  components/             the React building blocks of the pages (RequestForm, PractitionerDesk, ...)
  lib/                    server logic (backend) and lib/client/ (browser helpers)
supabase/migrations/      the database: tables, constraints, functions (SQL)
scripts/                  seed data, checks (OpenAPI, secret scan), AI evaluations
tests/unit/               fast tests, no database
tests/integration/        real API routes against a real local database (includes PRD TEST-01..07)
eval/                     test cases and results for the AI features
integration/team14/       our API contract and tools for our partner team (Team 14, Helpdesk)
docs/                     PRD, handoffs, this guide
openapi.yaml              the API contract (20 endpoints)
.github/workflows/        CI checks and the scheduled keep-alive job
```

**API endpoints at a glance** (all under `/api/v1`, full details in `openapi.yaml`):

| Endpoint | Who | What |
| --- | --- | --- |
| `GET /services` | anyone | active services |
| `GET /slots?service_id&date` | anyone | that day's times, only "available or not" |
| `POST /requests` | anyone | book; returns the access key once |
| `GET /requests/me` | student with key | status of their request |
| `POST /requests/{id}/cancel` | student with key | cancel and free the time |
| `POST /triage/assess` | anyone | AI urgency suggestion before submitting |
| `POST /finder/suggest` | anyone (consent required) | suggest up to 2 services |
| `GET /practitioner/queue` | practitioner | pending requests, URGENT first |
| `GET /practitioner/schedule` | practitioner | sessions and buffers in a date range |
| `PATCH /requests/{id}/status` | practitioner | approve, reject, reschedule, cancel |
| `GET /admin/services`, `PATCH /admin/services/{id}` | admin | edit services |
| `GET` / `PUT /admin/availability` | admin | weekly opening hours |
| `POST` / `DELETE /session`, `GET /me` | staff | sign in, sign out, who am I |
| `GET /health` | anyone | is the app and database up |
| `POST /internal/events/dispatch` | scheduled job (machine token) | resend waiting webhooks |
| `POST /webhooks/notification-hub` | the Hub (signed) | delivery receipts |
| `POST /referrals`, `GET` / `DELETE /referrals/{ref}` | Helpdesk (token; off by default) | referrals from Helpdesk, see `docs/HELPDESK-REFERRALS.md` |
| `GET /practitioner/referrals`, `PATCH /practitioner/referrals/{ref}` | practitioner, admin | accept or decline a Helpdesk referral |

---

## 4. How the main journeys work

### 4.1 A student books an appointment

1. **Home page** (`src/app/page.tsx`, `ServiceFinder`): loads `GET /services` and shows each service with
   "Choose a time".
2. **Pick a time** (`RequestForm` → `SlotSelector` → `GET /slots`). The server builds the day's times from
   the opening hours (`src/lib/slots/grid.ts`). Times are spaced by **session length + 15 minutes**, so a
   45-minute service offers 09:00, 10:00, 11:00... A time is unavailable if it or its buffer would overlap
   any live booking or that booking's buffer, for **any** service. The answer only says
   available or not, never who or why.
3. **Write the note**, choose Routine or Urgent. Choosing Urgent opens an "Urgent support" box with
   emergency numbers right away.
4. **Optional AI check:** only after the student ticks the consent box. `POST /triage/assess`
   (`src/lib/urgency/assess.ts`) returns a suggestion and fixed safety wording.
5. **Submit** → `POST /requests` (`src/app/api/v1/requests/route.ts`):
   - checks the per-address limit and the hourly limit (anti-spam);
   - checks the service is active and the time is a real free slot within 30 days;
   - decides urgency: URGENT if the AI, a crisis phrase **or** the student says so;
   - calls the database function `create_appointment_request`, which saves the row with
     `buffer_end = slot_end + 15 minutes`. The **exclusion constraint** refuses the row if it overlaps
     another live booking, even if two students click at the same moment;
   - returns the receipt and the **access key, shown once**. Only a SHA-256 hash of the key is stored.
6. **Double click or lost Wi-Fi?** The browser sends one `Idempotency-Key` per submission. Sending it again
   returns the **same** request and the **same** key, so there is never a second booking
   (`src/lib/access-key.ts`, database column `submission_key`).

### 4.2 A student checks the status or cancels

- `/requests` page (`RequestsDashboard`). The key travels in the `X-Access-Key` **header**, not in the URL,
  so it never lands in browser history or server logs.
- `GET /requests/me`: the key is hashed and looked up. A wrong key, a malformed key and a missing request
  all get the **identical 404**, so a guesser learns nothing. Too many wrong keys from one address → 429.
- Cancel: `POST /requests/{id}/cancel` with the key. The status becomes CANCELLED and the time **and its
  buffer** become free at once (the overlap rule only counts PENDING and CONFIRMED). If the appointment
  was already confirmed, an `appointment.cancelled` webhook tells the Hub.

### 4.3 A practitioner reviews and decides

- Sign-in (`/sign-in`, `POST /session`): Supabase Auth checks email and password; the session is an
  **HttpOnly cookie** (JavaScript cannot read it). The role comes **only** from our `staff` table
  (`src/lib/authz.ts`), not from anything the browser sends.
- Desk (`PractitionerDesk`): **Schedule** tab (`GET /practitioner/schedule`) draws each session plus a
  separate "Privacy buffer" block; **Review requests** tab (`GET /practitioner/queue`) lists PENDING
  requests, URGENT first. Staff never see access keys.
- Every action asks for confirmation, then `PATCH /requests/{id}/status` runs the database function
  `decide_request`. Reschedule = confirm at a new time (the buffer rule is checked again).
- Security: not signed in → 401; signed in with the wrong role → 404 (hides that the page exists); a
  cookie-signed change from another website → 403 (stops CSRF).

### 4.4 The webhook to the Notification Hub

- When a practitioner confirms (or later cancels/reschedules), the database writes an event into the
  **outbox** table **in the same transaction** as the decision. Either both happen or neither.
- `src/lib/events/dispatcher.ts` sends it at once; if the Hub is down, the event waits and the scheduled
  job (`.github/workflows/dispatch.yml`, every 3 hours) or the next decision retries it, with growing
  delays (30 s, 60 s, 120 s, ...). After 6 failures it is "parked". **The decision is never blocked.**
- The body has **exactly** the PRD's fields: `event_type`, `appointment_id`, `scheduled_time`,
  `privacy_buffer_end`. No name, note, urgency or service. Checked by a strict schema
  (`src/lib/events/contract.ts`) **and** by a database check.
- Each message is signed with **HMAC-SHA256** over `timestamp.body` with a shared secret; the receiver
  rejects old timestamps (over 5 minutes) and duplicates (`X-Event-Id`). After delivery the stored payload
  is deleted.

### 4.5 An admin edits services and opening hours

- `/admin` (`AdminWorkspace`): edit a service's name, length (15–120 min), description, on/off →
  `PATCH /admin/services/{id}` (duplicate name → 409). Existing bookings keep their times.
- Weekly opening hours with hour/minute wheels → `PUT /admin/availability` replaces the whole week in one
  transaction and refuses overlapping windows. Slots are **calculated, never stored**, so new hours apply
  immediately.

### 4.6 "Get a suggestion" (service matcher)

- Optional helper on the home page (`ServiceMatcher` → `POST /finder/suggest`, `src/lib/matching/`).
- Needs `ai_opt_in: true` (consent) or nothing runs. Order of checks (`suggest.ts`):
  1. **crisis phrase** → emergency guidance, no service suggestion, no AI call;
  2. **AI**, only if switched on, the text is not an attack, and the daily budget allows;
  3. otherwise the **keyword matcher** (`rules.ts`), which returns an empty list rather than guess.
- The AI may only pick ids from **our own list of active services** with a reason code that fits that
  service. One invalid value → the whole answer is thrown away. The screen shows only fixed reason
  sentences, never AI-written text. Nothing is stored or logged.

### 4.7 Emergency and urgent guidance

- Emergency numbers (1669 medical, 1323 mental health hotline) are hard-coded in `src/lib/emergency.ts`,
  so they show **even if the API or database is down**. `/emergency` is a static page.
- Choosing Urgent, or an urgent AI result, opens an "Urgent support" dialog. The app always says it is an
  appointment service, **not** crisis support, and that staff cannot contact an anonymous student.

---

## 5. The rules that keep it safe

| Rule | How it is done | Where |
| --- | --- | --- |
| No student identity | The request table has no column for name, email or student ID; extra fields are rejected | `rebuild_schema.sql`, `requests/route.ts` |
| Key cannot be stolen from the database | Only a SHA-256 hash of the 60-bit key is stored | `src/lib/access-key.ts` |
| Key not in URLs | Sent in a header or POST body; never saved in the browser | `RequestsDashboard`, `lib/client/contracts.ts` |
| Nothing leaks through errors | One identical 404 for "missing", "wrong key" and "wrong role" | `src/lib/http.ts` |
| Logs hold no content | One line per request: method, path, status, role, time; never bodies or notes | `src/lib/http.ts`, `logTriage`, `logMatch` |
| Anti-guessing and anti-spam | Per-address limits in memory only (IP never stored), plus a database-wide hourly cap | `src/lib/rate-limit.ts` |
| Staff roles are real | Role only from our `staff` table; wrong role → 404 | `src/lib/authz.ts` |
| CSRF | Cookie-signed staff changes must come from our own website (Origin check) | `src/lib/http.ts` |
| Browser cannot read the database | Row-level security on with **zero** policies; browser roles have no rights | `rebuild_schema.sql` |
| No secrets in the browser | No `NEXT_PUBLIC_` secrets; CI scans the built files for every secret | `scripts/scan-bundle.mjs` |
| Security headers | no framing, no referrer, nosniff, no camera/mic/location | `next.config.ts` |
| AI cannot harm | Opt-in only; injection guard; answer reduced to fixed values; any failure → fixed rule | `src/lib/urgency/`, `src/lib/matching/` |
| Webhooks are trustworthy | Strict 4-field payload, HMAC signature, timestamp, de-duplication | `src/lib/events/contract.ts` |

---

## 6. AI in this project

**Two AI features, both optional:**

| Feature | Endpoint | AI answers | Fallback |
| --- | --- | --- | --- |
| Urgency triage | `POST /triage/assess` and inside `POST /requests` | only `ROUTINE` or `URGENT` | crisis phrases + student's choice |
| Service matcher | `POST /finder/suggest` | up to 2 service ids + fixed reason codes | keyword matcher |

**Shared protections:**
- **Consent:** the student must tick a box first; without it the AI is never called.
- **Prompt-injection guard** (`keywords.ts`): text like "ignore previous instructions" skips the AI before
  any budget is spent; the crisis phrases still run on the same text.
- **Strict answers:** anything except the allowed values counts as a failure. Model text never reaches a
  screen.
- **Limits:** one attempt, 3-second timeout (`src/lib/llm.ts`), shared daily budget of 200 calls.
- **The AI can only raise urgency, never lower it.** A calm AI answer cannot cancel a crisis phrase or the
  student's Urgent choice.

**How we measured it** (fictional cases in `eval/`):

| Check | Command | Result (2026-11-10) |
| --- | --- | --- |
| Fixed phrase rule vs the PRD's 3 keywords, no network (CI gate) | `pnpm eval:ai` | our rule 13/15 (the 2 misses are indirect warning signs only the AI can catch); PRD keywords 6/15 |
| Real model, urgency | `pnpm eval:ai:live` | model 13/13, final 15/15, median 558 ms |
| Real model, service matcher | `pnpm eval:matcher:live` | model 14/15, final 18/19, median 934 ms |

Honest limits: we wrote the test cases ourselves, so they are a regression guard, not independent proof;
without the AI, the phrase list cannot catch indirect wording such as "giving my things away".

---

## 7. Testing and quality

**Two kinds of tests:**
- **Unit tests** (`pnpm test`, 180 tests, about 1 second): single functions with the database and network
  faked: slot grid, access keys, urgency rule, AI answer checking, webhook contract, matcher.
- **Integration tests** (`pnpm test:integration`, 94 tests): the real API route code against a real
  PostgreSQL started in Docker, reseeded first. A fake AI server and a fake Hub run on `127.0.0.1`.

**The PRD's seven required tests** (all in `tests/integration/test-plan.test.ts`):

| PRD test | What we prove |
| --- | --- |
| TEST-01 Privacy boundary | Booking works with no login; email, student ID or legal name are rejected; the table has nowhere to store them; the key is stored only as a hash |
| TEST-02 15-minute buffer | Booking 10:00–10:45 blocks every service from 10:00 to 11:00; a direct database insert at 10:45 is refused by the constraint |
| TEST-03 Status by key | The right key returns the exact request; wrong, malformed and missing keys give byte-identical 404s |
| TEST-04 Anonymous cancel | Status becomes CANCELLED and the same time can be booked again immediately; a wrong key changes nothing |
| TEST-05 Role boundary | No login → 401; an admin gets 404; a practitioner sees the queue, URGENT first, with no keys |
| TEST-06 AI failure | With the fake AI returning errors, booking still succeeds using the student's choice and emergency links; the budget limit really works |
| TEST-07 Webhook | The fake Hub receives exactly the 4 PRD fields, no personal text, and a valid signature; outages never block the decision |

**CI on every pull request** (`.github/workflows/ci.yml`), stopping at the first failure:
1. install exact package versions;
2. lint;
3. typecheck;
4. OpenAPI matches the code;
5. unit tests;
6. AI rule gate;
7. start a real database and apply all migrations;
8. integration tests;
9. production build;
10. secret scan of the browser files.

**Manual end-to-end check (2026-11-10):** a fictional booking went through the live screens. It was
approved by a practitioner, rescheduled, cancelled by the student, then deleted. Three webhooks were
delivered on the first try.

---

## 8. Deployment and operations

- **Vercel** builds and deploys `main` automatically (Singapore region). Pull requests get preview builds.
- **Supabase** hosts the database; schema changes are SQL migrations in `supabase/migrations`, pushed with
  `supabase db push`.
- **Secrets** (database keys, AI key, signing secrets) live only in Vercel environment variables and two
  GitHub secrets. `.env.example` lists every variable with no real values.
- **Keep-alive job** (`dispatch.yml`, every 3 hours): calls `GET /health` so the free database does not
  pause, then resends any waiting webhooks.
- **Seed safety:** `pnpm seed` wipes and reloads demo data, so it **refuses** any non-local database unless
  you type `--confirm-remote=<exact host>`, and a hosted database also needs a private password.
- **Partner integration with Team 14 (Helpdesk), in both directions:**
  - **Helpdesk → us:** they read our public `GET /services` (contract 2.0 in `integration/team14/`).
    Their calls `team14-v2-0001`, `-0003`, `-0005` and `-0006` were seen in our logs on 2026-11-10.
  - **Us → Helpdesk:** we read their public `GET /api/v1/contacts` (campus security, counselling front
    desk) in `src/lib/partners/helpdesk.ts`. Their numbers replace our two placeholders in the emergency
    links of the booking receipt and the AI check, shown as "(demo)" while unverified. It is switched on
    by the `HELPDESK_API_BASE_URL` setting. It waits at most 3 seconds and caches for 5 minutes, and on
    any problem we show our hard-coded numbers. The national hotlines 1669 and 1323 are never replaced.
    Every call writes a log line with `"kind":"partner"` and a `team16-…` correlation id that also
    appears in Helpdesk's logs.
  - **Referrals (Helpdesk → us, and a webhook back), switched off until `REFERRALS_ENABLED=true`:**
    1. A student on a Helpdesk ticket consents and presses "Send to Wellbeing". Helpdesk then calls our
       `POST /api/v1/referrals` with only a random `ref`, a service id and the consent time, using a
       secret token.
    2. Our staff see it in the **Helpdesk referrals** tab of the practitioner desk and accept or decline it.
    3. We send a signed webhook (`X-Timestamp`, HMAC `X-Signature`) to Helpdesk with only the `ref` and the
       status. It is retried with the same `eventId` if Helpdesk is down.
    - Referrals are never linked to bookings, and are deleted on withdraw or after 30 days.
    - Code: `src/lib/referrals.ts`, `src/lib/partners/helpdesk-referrals.ts`, `src/app/api/v1/referrals/`,
      `src/app/api/v1/practitioner/referrals/` and `src/components/HelpdeskReferrals.tsx`.
    - Full design: `docs/HELPDESK-REFERRALS.md`.

---

## 9. Teacher questions and answers

**Product**

1. **Why no student login?** The PRD's main rule is zero stigma: asking for counselling should not
   create a record tied to your identity. The access key lets the student come back without an account.
2. **What is the 15-minute buffer for?** So two students never meet in the entryway or waiting room. It
   applies to one shared calendar for all services.
3. **What happens if a student loses the key?** It cannot be recovered, because we only store its hash.
   That is the price of anonymity, and the receipt warns them clearly.

**Booking and the buffer**

4. **How do you stop two students booking the same time?** The database has an exclusion constraint on
   the time range from session start to buffer end. If two requests arrive at the same moment, the
   database accepts one and refuses the other with `slot_unavailable`; our code cannot get it wrong.
5. **What does `[)` mean in the range?** Start included, end excluded: a session may start exactly when
   the previous buffer ends, but not one minute earlier.
6. **Why are slots not stored in a table?** They are calculated from opening hours, so they never run
   out of sync, and a cancellation frees the time instantly.
7. **What if the student double-clicks or the connection drops?** One `Idempotency-Key` per submission;
   a retry returns the same request and key, never a second booking.
8. **Can someone book 10:07?** No. The API only accepts start times that are on the real slot grid.

**Privacy and security**

9. **How strong is the access key?** 12 random symbols from a 32-letter alphabet, which is 60 bits, about
   10^18 possible keys. The alphabet leaves out 0, 1, I and O so keys are easy to read.
10. **Why hash it without salt or bcrypt?** Those protect weak human passwords. Our key is already random
    and strong, and a plain hash lets us look up the request directly.
11. **Why a 404 instead of 401/403 for a wrong key?** Different answers would tell an attacker which
    requests exist. One identical 404 reveals nothing.
12. **How do you stop key guessing?** After 20 wrong keys in 10 minutes, that address gets 429. Addresses
    are kept only in memory and never stored or logged.
13. **Can a student open the practitioner page?** The page loads, but every API call needs a staff
    cookie: no login → 401 and a redirect to sign-in; wrong role → 404. Security is on the server.
14. **What is CSRF and how do you stop it?** Another website trying to use a signed-in staff member's
    cookie. We reject cookie-signed changes whose Origin is not our own site.
15. **Can the browser read the database directly?** No. Row-level security is on with no policies, and
    browser roles have no table rights. Only our server, with a secret key, can read it.
16. **What is in your logs?** Method, path, status, role and time. Never a note, alias, key or AI text.

**AI**

17. **Is the AI required?** No. It is opt-in, and every failure falls back to the phrase list and the
    student's choice. Booking never waits for the AI.
18. **Can the AI make an urgent request routine?** No. URGENT if any of the three sources says so.
19. **What is prompt injection?** Text that tries to give the AI new orders. We detect it and skip the AI,
    but the crisis phrases still check the same text.
20. **What does the AI receive?** Only the note (or the helper text) and, for the matcher, our public
    service list. Never a name, key or request id.
21. **How did you check the AI is good?** Fictional evaluation cases in `eval/`: the real model scored
    13/13 on urgency and 14/15 on matching. We also added indirect warning signs after testing showed the
    first version missed one.
22. **Can the suggestion helper invent a service?** No. Only ids from our active list with allowed reason
    codes are accepted; one bad value discards the whole answer.

**Webhooks and integration**

23. **What if the Notification Hub is down?** The event is saved in the outbox with the decision and
    retried later with growing delays. The practitioner's decision never waits for the Hub.
24. **How does the Hub know the message is really from us?** It is signed with HMAC-SHA256 using a
    shared secret, with a timestamp so old messages are rejected and an event id so duplicates are
    ignored.
25. **Can the webhook leak student data?** No. The payload is exactly four fields, enforced by a strict
    schema and by the database.
26. **Who is your partner team?** Team 14 (Helpdesk), connected both ways. They read our public service
    list to suggest Wellbeing on helpdesk tickets. We read their campus contact list to show official
    campus numbers in our safety guidance (`src/lib/partners/helpdesk.ts`). No student data goes either
    way.
27. **What if Helpdesk is down?** Our client waits at most 3 seconds, uses its cached copy, and otherwise
    shows our hard-coded numbers. A student always sees emergency numbers, and booking never waits on it.
28. **Doesn't a referral from Helpdesk break your anonymity rule?** No. Only a random `ref`, the service
    and the consent time arrive. The student consents first. We never link a referral to a booking, and we
    refused Helpdesk's idea of putting the `ref` in booking links, because Helpdesk knows the student behind
    each `ref`. "Accepted" only closes their ticket; the student still books anonymously on our site.

**Frontend**

29. **Why isn't the key in the URL?** URLs end up in browser history and server logs. We pass it in
    memory and send it in a header. We also set `Referrer-Policy: no-referrer`.
30. **Where is the buffer shown?** Students see only "Available"/"Unavailable"; practitioners see a
    separate "Privacy buffer" block after each session on the schedule.
31. **What did you do for accessibility?** A skip link, labels on every input, keyboard tabs and time
    wheels, native dialogs that keep focus, `aria-live` updates, large click targets, and support for
    high contrast and reduced motion. Automated axe checks found 0 violations.
32. **What is preview mode?** A development-only fake student API so screens could be built without a
    database. It needs both `NODE_ENV=development` and `UI_PREVIEW=true`, so it can never run in
    production.

**Testing and DevOps**

33. **How do you test the AI failing without a real AI?** A tiny fake AI server on `127.0.0.1` returns
    errors; the test proves booking still works.
34. **What does CI check?** Lint, types, the API contract, unit tests, the AI rule gate, integration tests
    on a real database, the production build, and a secret scan. A red check blocks the merge.
35. **Could the seed script wipe production?** Not by accident: it refuses any non-local database unless
    you type the exact host, and a tested guard rejects look-alike hosts.
36. **Why is there a job every 3 hours?** The free database pauses after a week without use; the job keeps
    it awake and resends any waiting webhooks.

---

## 10. Where we differ from the PRD on purpose

| PRD says | We do | Why |
| --- | --- | --- |
| Key example `WB-9842-X` | `WB-XXXX-XXXX-XXXX` (60 bits) | The short example could be guessed; ours cannot |
| `GET /requests/me?access_key=...` | The web app sends the key in the `X-Access-Key` header (the query form still works) | Keys in URLs leak into history and logs |
| One event, `appointment.confirmed` | Also `appointment.cancelled` | Otherwise the Hub would keep reminding about a cancelled appointment |
| Screens only | Extra endpoints: `/triage/assess`, `/finder/suggest`, `/practitioner/schedule`, admin endpoints | Needed by the screens (AI widget, schedule, admin) |
| A "buffer slot" 10:45–11:00 | No separate buffer slot; times are spaced by length + 15 minutes | Same result, simpler and impossible to book by mistake |

---

## 11. Known limitations (good answers to "what would you improve?")

- The AI is only as good as our evaluation cases, which we wrote ourselves.
- Per-address rate limits live in each server's memory; only the hourly booking cap is shared by all
  servers.
- `POST /triage/assess` trusts the web app to ask for consent first; `POST /finder/suggest` checks
  consent on the server. Making both check it would be more consistent.
- Admins can edit and switch off services but cannot create new ones in the app; new categories come
  from the seed script.
- There is no Content-Security-Policy header yet.
- Staff sign-in uses demo accounts (fixture mode); a real campus identity provider mode exists in the
  code (`IDENTITY_MODE=campus`) but was not tested with a real provider.
- The Notification Hub is our own stand-in (`/api/v1/mock/hub`), not another team's real Hub.

---

## 12. Glossary

| Term | Meaning |
| --- | --- |
| Access key | The secret code a student gets after booking, used instead of a login |
| Hash (SHA-256) | A one-way fingerprint: you can check a key against it, but cannot get the key back |
| Idempotency key | A unique id for one submission, so sending it twice gives the same result |
| Exclusion constraint | A database rule that rejects two rows whose time ranges overlap |
| Row-level security (RLS) | Database rules about which rows each user may see; ours allow nothing to the browser |
| Outbox | A table where events wait until they are delivered, saved together with the decision |
| Webhook | A message our server sends to another system when something happens |
| HMAC | A signature made with a shared secret, proving who sent a message and that it was not changed |
| CSRF | An attack where another website tries to act with your logged-in cookie |
| Rate limit | A cap on how many tries one address can make in a period |
| Prompt injection | Text that tries to give an AI new instructions |
| Fallback | The fixed rule we use when the AI is off, refused or broken |
| Migration | A versioned SQL file that changes the database structure |
| CI | Automatic checks GitHub runs on every change |
| Zod schema | A rule list that checks the shape of incoming data |
