# A5 — Integration Evidence · Team 14 (Helpdesk) × Team 16 (Wellbeing)

**Joint record of one cross-team integration, structured on the six proofs of the _Evidence Audit for A5 Submission_.**

|                      | Team 14 — Helpdesk                                                    | Team 16 — Wellbeing                                                                                |
| -------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Role in this pairing | **Consumer**                                                          | **Provider**                                                                                       |
| Deployed base URL    | `https://helpdesk-api.team-helpdesk.workers.dev` (Cloudflare Workers) | `https://wellbeing-intake.vercel.app/api/v1` (Vercel, region `sin1`; Supabase Postgres, Singapore) |
| Contact              | Pupattararak Masomjit (6731503115)                                    | Teerapat Sukkasem (6731503015)                                                                     |

**Contract:** [`integration/team14/Team14-Integration-Contract.md`](../integration/team14/Team14-Integration-Contract.md) v1.2 — `GET /services` and `GET /health`, public, read-only.
**Evidence captured:** 2026-09-21. Timestamps are ISO-8601 **UTC** (`Z`); add 7 h for local time (UTC+7).
**Correlation-ID labels:** `team14-a5-0001` (the evidenced call), `team14-a5-0003` (recovery call), `team14-a5-idem-check` (second idempotency call). Each was sent once.

> **How to read this document.** Every proof below has a part for each team, and says plainly whose
> system the evidence comes from. Where a proof does not exist between the two teams it is marked
> **N/A with the reason** — not skipped. Team 16's webhook proofs (3, 4) are real captures from its
> deployed system run against its own contract mock, because neither team is paired with a
> Notification Hub; they are labelled as self-run and are not presented as a partner's confirmation.
> All data is seeded and fictional. No secret, token, or student record appears in any capture.

## Summary

| #   | Proof            | Between the two teams                | Team 14 (Helpdesk)     | Team 16 (Wellbeing)                                      |
| --- | ---------------- | ------------------------------------ | ---------------------- | -------------------------------------------------------- |
| 1   | Consumer         | Team 14 → `GET /services`            | **Done**               | N/A — no consumer role                                   |
| 2   | Provider         | Team 16 serves Team 14               | N/A — no provider role | **Done**                                                 |
| 3   | Webhook receiver | **N/A** — privacy boundary           | N/A                    | Done (self-run)                                          |
| 4   | Webhook sender   | **N/A** — privacy boundary           | N/A                    | Done (self-run, contract mock)                           |
| 5   | Idempotency      | Repeated `GET` is read-only          | **Done**               | **Done** — `submission_key`, `eventId`, with DB proof    |
| 6   | Degradation      | Helpdesk survives a Wellbeing outage | **Done**               | **Done** — hub outage and LLM outage, automatic recovery |

---

## 1. Consumer Proof

_Required: partner URL, request timestamp, response body screenshot._

### Team 14 — consumes Wellbeing's API

| Field             | Value                                                                                                                                                                                                                                                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Partner URL       | `https://wellbeing-intake.vercel.app/api/v1/services` (Postman variable `wellbeing_base`)                                                                                                                                                                                                                                                                       |
| Method · header   | `GET` · `X-Correlation-Id: team14-a5-0001`                                                                                                                                                                                                                                                                                                                      |
| Request timestamp | `2026-09-21T11:35:49.718Z` (18:35:48 UTC+7) — server time from the provider's log, §2                                                                                                                                                                                                                                                                           |
| HTTP status       | `200 OK` — 1.4 KB in 1.44 s                                                                                                                                                                                                                                                                                                                                     |
| Calling code      | As described by Team 14: the Helpdesk Worker's `GET /wellbeing/services` and `GET /tickets/:id/wellbeing-suggestion`; keyword matching runs **locally** in the Worker (`matchWellbeingService()` in `src/index.ts`), so no ticket text is sent to Wellbeing. Consistent with Team 16's logs: every Helpdesk request seen is a bare `GET /services` with no body |

**Response body screenshot** (Team 14's Postman): the catalogue, starting `counselling` → `health-clinic` → `physiotherapy`.

![Team 14's Postman: GET services with X-Correlation-Id team14-a5-0001, 200 OK, catalogue in the body](https://raw.githubusercontent.com/TEERAPAT-SUKKASEM/wellbeing-intake/main/docs/evidence/2-partner-postman-team14-a5-0001.png)

![Team 14's Postman environment: wellbeing_base and helpdesk_base](https://raw.githubusercontent.com/TEERAPAT-SUKKASEM/wellbeing-intake/main/docs/evidence/2-partner-postman-environment.png)

**What Helpdesk does with it:** suggests a relevant Wellbeing service on a ticket and stores only the stable `wellbeing_service_slug` — never the UUID `id` (it changes when Wellbeing reseeds), and never any case, appointment or status, which Wellbeing does not share.

### Team 16 — N/A

Wellbeing has no consumer role in this pairing: Helpdesk exposes nothing the Wellbeing product needs, and we did not invent a call for the sake of this proof. (Wellbeing's designed consumer integration is Team 01 Identity; Team 16 is not paired with Team 01 and runs in fixture identity mode.)

---

## 2. Provider Proof

_Required: your endpoint URL, internal request log, partner confirmation._

### Team 16 — serves Team 14

| Field             | Value                                                                          |
| ----------------- | ------------------------------------------------------------------------------ |
| Endpoint URL      | `https://wellbeing-intake.vercel.app/api/v1/services`                          |
| Calling partner   | Team 14 — Helpdesk, from Postman (`User-Agent: PostmanRuntime/7.56.1`)         |
| Request timestamp | `2026-09-21T11:35:49.718Z`                                                     |
| Correlation ID    | `team14-a5-0001` — sent by Team 14, echoed in the response, written to the log |
| HTTP status       | `200` · deploy `f2b620c`, received in Singapore (`sin1`)                       |

**Internal request log** (Vercel function log — no body is ever logged):

```json
{
  "t": "2026-09-21T11:35:49.718Z",
  "svc": "wellbeing",
  "cid": "team14-a5-0001",
  "method": "GET",
  "path": "/api/v1/services",
  "status": 200,
  "role": "visitor",
  "ms": 476
}
```

The log search for `team14-a5-0001` returns this one request only. `role: "visitor"`: the endpoint is public, so Helpdesk receives exactly what a signed-out visitor receives.

![Vercel log: GET /api/v1/services, status 200, cid team14-a5-0001, User-Agent PostmanRuntime](https://raw.githubusercontent.com/TEERAPAT-SUKKASEM/wellbeing-intake/main/docs/evidence/2-provider-log-team14-a5-0001.png)

**Partner confirmation:** Team 14's Postman capture in §1 — same URL, same `team14-a5-0001`, same `200`.

**Also seen — Team 14's deployed backend, not only a manual test.** Team 14's Worker proxies our catalogue and, per their evidence plan, generates its own correlation ID (`team14-a5-<uuid>`) per call. This request carries such an ID and no browser or Postman user agent — a server-to-server call, which is how the contract asks to be called (we send no CORS headers):

```json
{
  "t": "2026-09-21T11:19:24.677Z",
  "svc": "wellbeing",
  "cid": "team14-a5-c006d636-c04e-4d40-9653-2c1138a03ad4",
  "method": "GET",
  "path": "/api/v1/services",
  "status": 200,
  "role": "visitor",
  "ms": 371
}
```

![Vercel log: request from Team 14's backend proxy](https://raw.githubusercontent.com/TEERAPAT-SUKKASEM/wellbeing-intake/main/docs/evidence/2-provider-log-team14-backend-proxy.png)

Checked from Team 16's side the same day: `GET https://helpdesk-api.team-helpdesk.workers.dev/wellbeing/services` → `200`, `"degraded": false`, all four services.

### Team 14 — N/A

Helpdesk is consumer-only in this pairing; Wellbeing calls no Helpdesk endpoint.

---

## 3. Webhook Receiver

_Required: incoming payload, secret verification result, stored log._

### Between the two teams — N/A (a deliberate boundary, not a missing feature)

Wellbeing sends Helpdesk **no event**. Wellbeing's only outbound events, `appointment.reminder` and `appointment.cancelled`, go to the platform Notification Hub addressed to the individual student. The reason is privacy: _"the fact that a student contacted a wellbeing service is itself private"_ (contract §2). Any per-student event reaching Helpdesk — even a timestamp with an opaque ID — would disclose that the student uses Wellbeing. So Helpdesk has no webhook receiver **for the Wellbeing pairing**, no payload shape, no secret, and nothing to test. _(Team 14, C1.)_

### Team 16 — its own receiver, self-run

`POST /api/v1/webhooks/notification-hub` receives Notification Hub delivery receipts. Signed by Team 16 with its own inbound secret (no Hub partner). Deploy `27d4920`.

**Incoming payload** (exactly as received):

```json
{
  "eventId": "d277ab91-6e47-40d8-9c63-d65d8e46dc71",
  "type": "notification.delivered",
  "occurredAt": "2026-09-21T00:56:16Z",
  "source": "notification-hub",
  "subject": "reference:demo",
  "data": { "reference": "02193392-d6f3-48fc-af68-d887ddaa7349" }
}
```

**Secret verification result** — HMAC-SHA256 over `"<timestamp>.<raw body>"`:

| Case                                        | cid · server time                  | `signature`                   | Status                                      | Work done                                                        |
| ------------------------------------------- | ---------------------------------- | ----------------------------- | ------------------------------------------- | ---------------------------------------------------------------- |
| Valid signature (`sha256=a71e8c…`, masked)  | `a5r-3-valid` · `00:56:20.217Z`    | `verified`                    | `200` `{"received":true,"duplicate":false}` | one database write                                               |
| Body changed by one character after signing | `a5r-3-tampered` · `00:56:20.658Z` | `rejected`, reason `mismatch` | `401` `{"error":"invalid_signature"}`       | **no outgoing requests** — rejected in 9 ms, before the database |

**Stored log** — the row in `inbound_event` on the deployed database:

```json
[
  {
    "event_id": "d277ab91-6e47-40d8-9c63-d65d8e46dc71",
    "source": "notification-hub",
    "type": "notification.delivered",
    "reference": "02193392-d6f3-48fc-af68-d887ddaa7349",
    "received_at": "2026-09-21T00:56:20.136655+00:00"
  }
]
```

![Vercel log: signature verified, status 200](https://raw.githubusercontent.com/TEERAPAT-SUKKASEM/wellbeing-intake/main/docs/evidence/3-log-valid.png)

![Vercel log: signature rejected, reason mismatch, status 401, no outgoing requests](https://raw.githubusercontent.com/TEERAPAT-SUKKASEM/wellbeing-intake/main/docs/evidence/3-log-tampered.png)

---

## 4. Webhook Sender

_Required: internal trigger action, outgoing payload, partner response log._

### Between the two teams — N/A

Helpdesk sends Wellbeing no webhook either. The integration is one-way and read-only: nothing on the Helpdesk side (a ticket created, resolved…) is Wellbeing's business, Wellbeing exposes no endpoint that accepts Helpdesk events, and the contract (§2.1) asks Helpdesk not to forward ticket text — a wellbeing request must be written and submitted by the student. In the other direction the catalogue is static seed data with no "service changed" event. _(Team 14, C2.)_

### Team 16 — its own sender, self-run against the contract mock

The receiver here is Team 16's built-in contract mock hub (`/api/v1/mock/hub`), which verifies the HMAC signature, the platform envelope and the `data` allowlist over real HTTP before answering `202`. Deploy `27d4920`.

**Internal trigger action:** a student books an appointment (`POST /api/v1/appointments`); the reminder is due, so it is dispatched inline.

| Step            | Server time (UTC)      | cid             | Evidence                                                                                                             |
| --------------- | ---------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------- |
| Booking created | `2026-09-21T00:56:24Z` | `a5r-4-booking` | `201` `{"id":"65132edf-0d2d-4882-9a4e-c340fec2f2b5","startAt":"2026-09-21T06:56:19.269+00:00","status":"confirmed"}` |
| Sender          | `00:56:24.170Z`        | `a5r-4-booking` | `kind:"webhook"`, `type:"appointment.reminder"`, `attempt:1`, `status:202`, **`outcome:"delivered"`**                |
| Receiver        | `00:56:24.139Z`        | `a5r-4-booking` | `svc:"mock-hub"`, same `eventId` `6e6f17f3-9038-449b-b757-9220dfe9ef77`, **`accepted:true`**                         |

**Outgoing payload** — `data` has exactly three fields; no service, practitioner, reason or urgency level. Read from the outbox of the identically-built reminder in §6 while it was still pending, because a delivered row is nulled:

```json
{
  "message": "You have an appointment.",
  "reference": "fcbe8a2f-0847-4ac3-8a67-1a6f97d825c1",
  "appointmentAt": "2026-09-21T08:01:25Z"
}
```

**Partner response log:** `202` from the mock hub. After delivery the outbox row has `delivered_at` set and `subject` / `payload` nulled:

```json
[
  {
    "event_id": "6e6f17f3-9038-449b-b757-9220dfe9ef77",
    "type": "appointment.reminder",
    "reference": "65132edf-0d2d-4882-9a4e-c340fec2f2b5",
    "attempts": 1,
    "last_status": 202,
    "delivered_at": "2026-09-21T00:56:24.113613+00:00",
    "failed_at": null,
    "subject": null,
    "payload": null
  }
]
```

![Vercel log, sender side: booking 201 and the webhook line with outcome delivered](https://raw.githubusercontent.com/TEERAPAT-SUKKASEM/wellbeing-intake/main/docs/evidence/4-log-booking-sender.png)

![Vercel log, receiver side: the mock hub accepted the same eventId](https://raw.githubusercontent.com/TEERAPAT-SUKKASEM/wellbeing-intake/main/docs/evidence/4-log-mock-hub-receiver.png)

---

## 5. Idempotency Proof

_Required: Req 1 vs Req 2 payloads, showing DB proof of single creation._

### Team 14 — the same `GET` twice

|                    | Req 1                                                                                              | Req 2                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Request            | `GET /api/v1/services`                                                                             | `GET /api/v1/services`                                                                |
| `X-Correlation-Id` | `team14-a5-0001`                                                                                   | `team14-a5-idem-check`                                                                |
| Status · time      | `200` · 1.44 s                                                                                     | `200` · 256 ms                                                                        |
| Body               | catalogue — `counselling` `689dfeea-…`, `health-clinic` `e82330e2-…`, `physiotherapy` `e9af0c7e-…` | **the same** — same ids, same order, same text in everything visible in both captures |

Req 1 is the screenshot in §1; Req 2:

![Team 14's Postman: the repeated GET with team14-a5-idem-check, 200 OK, the same catalogue](https://raw.githubusercontent.com/TEERAPAT-SUKKASEM/wellbeing-intake/main/docs/evidence/5-team14-postman-idem-check.png)

**DB proof of single creation — nothing is created at all.** The provider's log for Req 1 (§2) shows the only outgoing call the request made: one `GET` to the database (Vercel's _External APIs_ panel) — a single `SELECT`, no write. A `GET` on this API cannot create a row however many times it is repeated, and Helpdesk stores only a slug, so repeating the call creates nothing on either side.

### Team 16 — writes that must not duplicate

**5a. The same `POST /requests` twice with one `submission_key`** (deploy `818596e`). The body is byte-identical both times and uses an obviously fake description:

```json
{
  "serviceId": "689dfeea-2a43-4aa9-87b4-55cfacaf29bc",
  "structuredDescription": "demo-sentinel-A5",
  "preferredTimes": "any",
  "triageLevelId": 1,
  "submissionKey": "19267117-022d-4128-a196-1348548429b3"
}
```

|                  | Req 1                                  | Req 2 (replay)             |
| ---------------- | -------------------------------------- | -------------------------- |
| Time (UTC) · cid | `2026-09-20T22:33:09Z` · `a5-5a-req1`  | `22:33:10Z` · `a5-5a-req2` |
| Status           | `201 Created`                          | `200 OK`                   |
| Returned id      | `a9e01cc4-fac0-4851-9336-3007f9d0380d` | **same id**                |
| `created`        | `true`                                 | `false`                    |

DB proof: `select count(*) from request where submission_key = '19267117-022d-4128-a196-1348548429b3';` → exact count from the deployed database: **1** (`Content-Range: 0-0/1`).

**5b. The same inbound event twice** (the event of §3): first delivery `{"received":true,"duplicate":false}`, second `{"received":true,"duplicate":true}`; `inbound_event` holds **one** row for that `eventId` — its primary key makes a second insert impossible.

![Vercel log: the duplicate delivery, signature verified, duplicate true](https://raw.githubusercontent.com/TEERAPAT-SUKKASEM/wellbeing-intake/main/docs/evidence/3-log-duplicate.png)

---

## 6. Degradation Proof

_Required: breakage timestamp, fallback JSON output, automatic recovery log._

### Team 14 — Wellbeing unavailable, Helpdesk keeps working

**How it was broken:** Team 14 ran its Worker locally (`wrangler dev`, `localhost:8787`) with `WELLBEING_API_URL` pointed at an unreachable host, so the live deployments of both teams were untouched.

| Moment                                 | Time                                        | Evidence                                                                                                |
| -------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Breakage                               | `Team 14 — time of the degraded call`  | `GET /wellbeing/services` still answers **`200`** in 1.18 s                                             |
| Fallback JSON                          | —                                           | `{"services":[],"degraded":true}` — the Wellbeing suggestion is hidden; tickets are never blocked       |
| Recovery                               | `Team 14 — time of the recovered call` | URL restored → `200`, `services [4]`, `"degraded": false`; no repair beyond restoring the configuration |
| First call reaching the provider again | `2026-09-21T12:11:39.631Z` (19:11:38 UTC+7) | Team 16's log, cid `team14-a5-0003`                                                                     |

![Team 14's proxy during the simulated outage: 200 with services empty and degraded true](https://raw.githubusercontent.com/TEERAPAT-SUKKASEM/wellbeing-intake/main/docs/evidence/6-team14-proxy-degraded-true.png)

![Team 14's proxy after recovery: services 4, degraded false](https://raw.githubusercontent.com/TEERAPAT-SUKKASEM/wellbeing-intake/main/docs/evidence/6-team14-proxy-recovered.png)

**Recovery log, from the provider's side.** The outage never reaches Wellbeing by design, so Wellbeing's log can only show the recovery — and it does:

```json
{
  "t": "2026-09-21T12:11:39.631Z",
  "svc": "wellbeing",
  "cid": "team14-a5-0003",
  "method": "GET",
  "path": "/api/v1/services",
  "status": 200,
  "role": "visitor",
  "ms": 537
}
```

![Vercel log: GET /api/v1/services, status 200, cid team14-a5-0003](https://raw.githubusercontent.com/TEERAPAT-SUKKASEM/wellbeing-intake/main/docs/evidence/2-provider-log-team14-a5-0003.png)

### Team 16 — two dependencies break, the product keeps working, both recover by themselves

**6a. Notification Hub unreachable** (deploy `818596e`). Broken by switching the hub target into outage mode, so every delivery got `503` over real HTTP. One event throughout: `7639a8f8-ba9a-426a-b960-ab9be25715b0`.

| Moment                    | Time (UTC)               | Evidence                                                                                                                                                                                                  |
| ------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Breakage                  | `2026-09-20T22:51:05Z`   | cid `a5-6a-break` → `{"fail":true}`                                                                                                                                                                       |
| Booking during the outage | `22:51:06Z`              | **`201`** `{"id":"fcbe8a2f-0847-4ac3-8a67-1a6f97d825c1","startAt":"2026-09-21T08:01:25.449+00:00","status":"confirmed"}` — the fallback JSON: identical to a normal booking, the student is never blocked |
| Attempt 1, then 2         | `22:51:06Z`, `22:51:49Z` | `503`, `503`; retry intervals grow (≈ 30 s, then ≈ 70 s); same `event_id`                                                                                                                                 |
| Restored                  | `22:52:17Z`              | cid `a5-6a-restore` → `{"fail":false}`                                                                                                                                                                    |
| Automatic recovery        | `22:53:07Z`              | dispatcher: `{"claimed":1,"delivered":1,"retrying":0,"parked":0}`; outbox: `attempts 3`, `last_status 202`, `delivered_at 22:53:21Z`                                                                      |

No row was edited and nothing was re-queued by hand; recovery was the ordinary dispatcher call made when the row's next attempt came due (in production, the scheduled `dispatch.yml` workflow). The appointment stayed `confirmed` throughout.

**6b. LLM provider unavailable** (deploy `73b18dc`). Groq's per-minute token quota was exhausted from outside the app, so Groq answered `429 rate_limit_exceeded` (`retry-after: 55`) — a real provider-side failure. Request body in every call: `{"text":"trouble sleeping before exams"}`.

| Moment             | Server time (UTC)      | cid               | Result                                                                                 |
| ------------------ | ---------------------- | ----------------- | -------------------------------------------------------------------------------------- |
| Before             | `2026-09-21T00:33:29Z` | `a5-6b-before`    | `200`, `mode:"ai"`                                                                     |
| Breakage           | `00:33:30Z`            | —                 | Groq → `429`, `retry-after: 55`                                                        |
| During             | `00:33:35.913Z`        | `a5-6b-during`    | **`200`**, `mode:"fallback"`, reason `ai_unavailable`, 112 ms                          |
| Automatic recovery | `00:34:45.502Z`        | `a5-6b-recovered` | `200`, `mode:"ai"`, 920 ms — no redeploy, no configuration change, no action by anyone |

Fallback JSON — a ranked list of seeded service IDs from the deterministic keyword matcher; the visitor gets an answer, not an error:

```json
{ "mode": "fallback", "serviceIds": ["6c940476-f362-4090-b96a-40d75ed2564b"] }
```

After recovery — the model ranks a second relevant service:

```json
{
  "mode": "ai",
  "serviceIds": [
    "6c940476-f362-4090-b96a-40d75ed2564b",
    "689dfeea-2a43-4aa9-87b4-55cfacaf29bc"
  ]
}
```

In both modes the response carries only seeded service IDs; model-written text never reaches a screen. The log lines carry mode, reason and latency only — never the typed text.

![Vercel log during the LLM outage: mode fallback, reason ai_unavailable](https://raw.githubusercontent.com/TEERAPAT-SUKKASEM/wellbeing-intake/main/docs/evidence/6b-log-during-1.png)

![Vercel log after recovery: mode ai](https://raw.githubusercontent.com/TEERAPAT-SUKKASEM/wellbeing-intake/main/docs/evidence/6b-log-recovered.png)

---

## Sign-off

Both teams confirm that the evidence above attributed to their own system is a real capture from that system, and that the contract (v1.2) is agreed.

| Team                | Name                               | Confirms                         | Date       |
| ------------------- | ---------------------------------- | -------------------------------- | ---------- |
| Team 16 — Wellbeing | Teerapat Sukkasem                  | §2, and Team 16's parts of §3–§6 | 2026-09-21 |
| Team 14 — Helpdesk  | Pupattararak Masomjit (6731503115) | §1, and Team 14's parts of §5–§6 | 2026-09-21 |

Team 16's full evidence, with raw captures: [`A5-Team16-Integration-Evidence.md`](A5-Team16-Integration-Evidence.md) and [`evidence/`](evidence).
