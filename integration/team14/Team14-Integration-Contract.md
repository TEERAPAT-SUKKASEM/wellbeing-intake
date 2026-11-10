# API Contract — Wellbeing (Team 16) → Helpdesk (Team 14)

**Contract version:** 2.0 (2026-11-10) · **Replaces:** 1.2 (2026-09-21) · **Status:** published by Team 16, waiting for Team 14 to confirm (§12)

Every value below was checked against the live system on 2026-11-10. Nothing here is planned or
assumed. Items that do not exist are marked **N/A** with the reason.

| | |
| --- | --- |
| Provider | Team 16 — Wellbeing (anonymous counselling booking) |
| Consumer | Team 14 — Helpdesk |
| Full machine-readable contract | [`openapi.yaml`](openapi.yaml) (OpenAPI 3.1; you only need `GET /services` and `GET /health`) |
| Source | <https://github.com/TEERAPAT-SUKKASEM/wellbeing-intake> |
| Contact | Teerapat Sukkasem (Team 16) |

---

## 0. What changed since 1.2, and an apology

After our instructor's review, Team 16 rebuilt Wellbeing to a new product design: students now book
counselling **anonymously**, with no login at all. The service catalogue was rebuilt with it, and
`GET /services` changed shape **on the same `/api/v1` path**.

Contract 1.2 (§9) promised that a breaking change would ship as `/api/v2` with notice. We did not keep
that promise: the new design specifies these exact `/api/v1` paths for our own web app, and the change
went live on **2026-11-09** before we told you. We are sorry for the short notice. From now until the
presentations we will not change `GET /services` again; any later change will only add fields.

| | 1.2 (old) | 2.0 (now) |
| --- | --- | --- |
| Response | an object: `{ "services": [ … ] }` | **a plain array**: `[ … ]` |
| Unique ID to store | `slug` (e.g. `counselling`); `id` was a UUID that changed on reseed | **`id`** (e.g. `srv_academic_stress`). It is fixed and never changes. There is no `slug` |
| Fields | `id`, `slug`, `name`, `whatFor`, `firstSession`, `whoWillKnow` | `id`, `name`, `description`, `duration_minutes`, `is_active` |
| Services | 4: counselling, health clinic, physiotherapy, wellbeing advising | 3: Academic Stress Counselling, General Counselling, Urgent Drop-in |
| Illness and injury | routed to the health clinic or physiotherapy | **no longer ours**: there is no medical service now |
| Your test 3 (auth failure) | `GET /requests/me` → `401` | **`GET /practitioner/queue` → `401`** (`/requests/me` now answers `404`) |
| Unchanged | | `GET /health`, `405` for a wrong method, `404` for an unknown path, no CORS, correlation IDs, no webhooks to Helpdesk |

**What you need to change:**
1. Parse a plain array instead of `body.services`.
2. Store `id` instead of `slug`.
3. Replace any stored old slug with one of the three new IDs (§5).
4. Show `description` where you showed `whatFor`.
5. Point test 3 at `/practitioner/queue`.

The updated [`wellbeing-client.mjs`](wellbeing-client.mjs) already does steps 1, 2 and 4.

## 1. Roles

```text
Helpdesk (Team 14) ───── GET /api/v1/services ─────▶ Wellbeing (Team 16)

Helpdesk  = Consumer
Wellbeing = Provider
```

There is **no webhook** from Wellbeing to Helpdesk (see §8).

## 2. What Wellbeing shares, and what it never will

Wellbeing handles counselling requests. Our product rule is that **the fact that a student asked for
counselling is itself private**. Students book anonymously: no login, no name, no student ID. They get
a private access key, which only they hold, to check or cancel their request.

So the integration is deliberately limited to **public information**:

| Wellbeing data | Shared with Helpdesk? |
| --- | --- |
| **Service catalogue**: each service's name, what it is for and how long a session is | **Yes**: this is the contract |
| Service health (`up` / `down`) | **Yes** |
| A student's request, appointment, status, urgency, access key, or whether one exists | **Never.** No endpoint, no event, no ID. |

**What this means for your design.** A Helpdesk ticket can record *"we pointed this student to
General Counselling"* by storing a **service ID**. It cannot, and should not, record *"this student
has a wellbeing appointment"*. That reference would itself be a disclosure. Please do not add a
`case_id`, `appointment_id` or `access_key` field; there is nothing on our side to link it to.

Suggested use: when a Helpdesk ticket is about stress, exams, low mood, worries or relationships, show
the student the matching Wellbeing service and link them to <https://wellbeing-intake.vercel.app>.
The student then books themselves, privately and anonymously.

### 2.1 How this fits the Helpdesk PRD

| In your PRD | With Wellbeing |
| --- | --- |
| §8.3: AI triage proposes a **Route** | Add **`Route: Wellbeing`** for tickets about exam or study stress, low mood, anxiety, loneliness, relationships, family, grief, sleep or money worries. **Not** for illness or injury any more |
| §8.2: AI input "available routing/assignment options" | Our three services (`name` + `description`) are those options. Validate the AI's choice against our `id` list, as §8.6 requires for categories |
| §8.5: deterministic fallback | Works unchanged: map your keyword rules to an `id` (§5). If *we* are unavailable, fall back to a plain "Wellbeing" route with a link to our site |
| §6.1 / BR-04: store only a reference, never copy the record | Same pattern: store only **`wellbeing_service_id`**. Fetch `name` and `description` from us when you display it |
| §12: server-side API logic (Next.js Route Handlers) | Call us from a Route Handler. `wellbeing-client.mjs` in this bundle drops straight in |
| §6.3: you *consume* `maintenance.status_changed` | **No equivalent from us.** A Wellbeing status event would reveal that a student has a request (§8) |

A suggested flow:

```text
Requester creates ticket: "Exams are next week and I can't sleep"
        │
        ▼
AI / fallback suggests   Route: Wellbeing  ·  service: srv_academic_stress
        │
        ▼
Helpdesk shows the student our card for that service (name, description, session length)
and a link to https://wellbeing-intake.vercel.app
        │
        ▼
Ticket stores  wellbeing_service_id = "srv_academic_stress"   ← the only thing you keep
        │
        ▼
The student decides whether to book. On our site, anonymously, with no login
```

Four boundaries we ask you to respect:

1. **Immediate danger comes first.** If a ticket suggests that someone may hurt themselves or others,
   or is in an emergency, show the emergency numbers straight away: **1669** (emergency medical
   services) and **1323** (mental health hotline, 24 hours). Do not only point to a Wellbeing service.
   Our services, including Urgent Drop-in, are **appointments, not crisis support**. Our page
   <https://wellbeing-intake.vercel.app/emergency> lists the same numbers.
2. **Do not forward the ticket's subject or description to us.** We have no endpoint that accepts a
   request on a student's behalf, deliberately: a counselling request must be written and submitted by
   the student themselves. (Our site's own "Get a suggestion" helper, `POST /finder/suggest`, is not
   part of this contract. It runs only on the student's own consent on our site. Please do not send
   ticket text to it.)
3. **Never ask a student for their Wellbeing access key**, and never store one. It is the only thing
   that proves a request is theirs.
4. **A stored service ID means "we suggested this service", nothing more.** Please do not show it, in
   the agent queue or anywhere else, as "this student is a Wellbeing client". You cannot know that,
   and neither should an agent.

## 3. Checklist answers

| # | Item | Answer |
| --- | --- | --- |
| 1 | API Base URL | `https://wellbeing-intake.vercel.app/api/v1` |
| 2 | Endpoint(s) | `GET /services` · `GET /health` |
| 3 | HTTP Method | `GET` only |
| 4 | Request Headers | None required. Optional: `X-Correlation-Id` (§6) |
| 5 | Request Body | None |
| 6 | Response Body | §4 |
| 7 | HTTP Status Codes | §7 |
| 8 | Error Response | §7 |
| 9 | Main Resource | **Service** |
| 10 | Resource Unique ID | **`id`**, e.g. `srv_academic_stress`. Fixed; never changes (§5) |
| 11 | Status Values | **N/A**: a service is either listed (offered now) or not. Request and appointment statuses exist but are private (§2) |
| 12 | Status Meaning | N/A |
| 13 | Authentication Method | **None**: both endpoints are public and return no personal data |
| 14 | Webhook / Event | **N/A** (§8) |
| 15 | Event Trigger | N/A |
| 16 | Event Payload | N/A |
| 17 | Event ID | N/A |
| 18 | Retry Behavior | Yours to choose. `GET` is safe to retry. Recommendation in §9 |
| 19 | Idempotency Behavior | `GET` is idempotent by definition: calling it any number of times changes nothing on our side |
| 20 | Test Environment / URL | The base URL above. It is a demo deployment on **seeded, fictional data**, safe to call freely |
| 21 | Test Data | §5: three seeded services |
| 22 | Test Account / Credential | Not needed for this contract |

## 4. `GET /services`

Returns every service we offer right now, ordered by name, as a **plain JSON array**. No parameters,
no pagination.

```bash
curl -i https://wellbeing-intake.vercel.app/api/v1/services -H "X-Correlation-Id: team14-v2-0001"
```

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Cache-Control: no-store
X-Correlation-Id: team14-v2-0001
```

```json
[
  {
    "id": "srv_academic_stress",
    "name": "Academic Stress Counselling",
    "description": "Talk through exam pressure, deadlines, study worries or feeling behind.",
    "duration_minutes": 45,
    "is_active": true
  }
]
```

The full live response is in [`examples/services.200.json`](examples/services.200.json).

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string, `srv_` + lowercase letters, digits and `_` | **Stable unique identifier.** Store this |
| `name` | string | Display name |
| `description` | string | What the service helps with. May be empty, never `null` |
| `duration_minutes` | integer, 15–120 | Length of one session. Each session is followed by a 15-minute privacy buffer, so students do not meet in the waiting area |
| `is_active` | boolean | Always `true` in this list: services that are switched off are left out |

All fields are always present. All text is English. Ignore any field we add later.

## 5. Test data and the unique ID

| `id` (store this) | `name` | Suggested for |
| --- | --- | --- |
| `srv_academic_stress` | Academic Stress Counselling | exams, deadlines, study worries, falling behind |
| `srv_general_counselling` | General Counselling | low mood, anxiety, loneliness, relationships, family, grief, sleep, money worries |
| `srv_urgent_drop_in` | Urgent Drop-in | a student who wants to talk to someone **sooner**. Still an appointment, not crisis support (§2.1) |

**The IDs never change.** Our administrators can rename a service, edit its description or session
length, or switch it off, but they cannot change its `id`. So:

- Display the current `name` and `description` from our response. Do not copy them onto your ticket.
- A stored `id` that is **missing** from the list means "not offered right now" (switched off, or not a
  real ID). Treat it as your *not found* case and hide the suggestion.

If you stored old 1.2 slugs, map them like this: `counselling` and `wellbeing-advising` →
`srv_general_counselling`. `health-clinic` and `physiotherapy` have **no replacement**: clear them.

Suggested Helpdesk column: `wellbeing_service_id` (text, nullable).

There is no `GET /services/{id}` endpoint. To resolve a stored ID, fetch the list and match on `id`.

## 6. Correlation ID

Send `X-Correlation-Id` and we echo it back unchanged and write it on our server log line, so one
request can be traced across both teams' logs.

**Format:** 8–128 characters from `A–Z a–z 0–9 _ . : -`. A value that does not match (too short,
contains spaces or `#`) is silently replaced with a random UUID.

| Sent | Returned |
| --- | --- |
| `team14-v2-0001` | `team14-v2-0001` |
| `probe-1` (7 characters) | a random UUID |
| `T14 ticket #5` (space, `#`) | a random UUID |

**Where the ID is echoed.** On every response produced by our API code: `200`, `401`, `404` with a
JSON body, `500`, `503`. The two framework-level responses, **`405` (wrong method) and `404` for an
unknown path (an HTML page)**, never reach our code. They carry no `X-Correlation-Id` and leave no
structured log line on our side. Evidence them from your side only.

## 7. Status codes and errors

Errors from our code are always `{"error": "<code>"}`: a stable machine-readable code, never a
free-text message.

| Situation | Status | Body |
| --- | --- | --- |
| Success | `200` | §4 |
| Wrong method (e.g. `POST /services`) | `405` | empty |
| Unknown path (e.g. `/services/dentistry`) | `404` | not JSON: a generic not-found page |
| Our database is unavailable | `500` | `{"error":"internal_error"}` |
| (Not part of this contract) a staff-only endpoint without signing in, e.g. `GET /practitioner/queue` | `401` | `{"error":"unauthenticated"}` |

`GET /health` tells you whether we are up before you rely on us:

```bash
curl -s https://wellbeing-intake.vercel.app/api/v1/health
```

| State | Status | Body |
| --- | --- | --- |
| Healthy | `200` | `{"status":"ok","service":"wellbeing","version":"<commit>","database":"up"}` |
| Database down | `503` | `{"status":"degraded", … ,"database":"down"}` |

## 8. Webhooks / events: N/A

Wellbeing sends **no** event to Helpdesk. Our only outbound events, `appointment.confirmed` and
`appointment.cancelled`, go to the platform Notification Hub. They carry an opaque appointment
reference and times, and nothing about the student. Sending any per-student event to Helpdesk would
disclose that the student asked for counselling (§2). Changes to the catalogue are rare and need no
event: just re-read the list (§9).

Consequently your Test 5 (webhook) and Test 6 (duplicate event) do not apply to this pairing.

## 9. Operational notes

| Topic | Value |
| --- | --- |
| Call from | **Your server only.** We send no CORS headers, so a browser on another origin cannot read the response. Call us from your backend and pass the data to your frontend |
| Rate limit | None on `GET /services` or `GET /health`. Hosting is a free tier: please cache rather than call on every page view |
| Caching | We send `Cache-Control: no-store`, but the catalogue rarely changes. Caching it for **up to 10 minutes** is safe and recommended (our administrators can edit or switch off a service) |
| Typical latency | About 0.2–0.6 s (server in Singapore) |
| Timeout | We suggest 3 s |
| If we are down | Keep working: serve your cached copy, or hide the Wellbeing suggestion. Never block a Helpdesk ticket on us |
| Retry | Safe (`GET`). One or two retries with a short back-off is plenty |
| Versioning | Path `/api/v1`. See §0: 2.0 broke 1.2's promise. From 2.0 on, `GET /services` only gains fields; we will not remove or rename one, and will tell you first if anything else ever has to change |
| Data | Seeded, fictional, demo-only. No real student record exists in our system |

## 10. Your test plan, mapped to this contract

| Team 14 test | How to run it against us |
| --- | --- |
| 1 — Valid request | `GET /services` → `200`, a JSON array of the services in §5 |
| 2 — Invalid request | `POST /services` → `405` |
| 3 — Authentication failure | N/A for this contract (public). To demonstrate one: `GET /practitioner/queue` without signing in → `401 {"error":"unauthenticated"}` |
| 4 — Unknown resource | Look up an ID that is not in the list (e.g. `srv_dentistry`) → your code reports *not found*. Or `GET /services/dentistry` → `404` |
| 5 — Webhook | N/A (§8) |
| 6 — Duplicate event | N/A (§8) |
| 7 — Partner failure | Point your client at a wrong host, or set a 1 ms timeout, and show Helpdesk still works (cached copy or hidden suggestion). We will not take the demo deployment down |
| 8 — Recovery | Restore the correct URL / timeout → the next call succeeds, no manual repair |

[`smoke-test.mjs`](smoke-test.mjs) runs tests 1–4, 7 and 8 against the live API: `node smoke-test.mjs`.

## 11. Checking the new version together

Our A5 evidence was captured on contract 1.2 (2026-09-21) and stays as it is. To confirm the switch to
2.0 on both sides:

1. Run your first call on 2.0 with **`X-Correlation-Id: team14-v2-0001`**.
2. **Tell us just before you run it.** Our hosting keeps server logs for only about an hour, and we will
   send you our log line for that ID: evidence, from the provider's side, that your request arrived.

## 12. Contract lock

| Version | Team | Name | Agreed on |
| --- | --- | --- | --- |
| 1.2 | Team 16 — Wellbeing | Teerapat Sukkasem | 2026-09-21 |
| 1.2 | Team 14 — Helpdesk | Pupattararak Masomjit (6731503115) | 2026-09-21 |
| **2.0** | Team 16 — Wellbeing | Teerapat Sukkasem | 2026-11-10 |
| **2.0** | Team 14 — Helpdesk | | *waiting for Team 14* |
