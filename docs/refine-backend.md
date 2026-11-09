# Refine backend: frontend integration handoff

This is the next-work checklist for the backend owner. The frontend is ready to share for backend refinement; this is not a claim that the full system is production-ready. Existing backend routes and database migrations were preserved during the frontend redesign.

## What to do next, in order

### 1. Start from the current database schema

- Pull this frontend work and install with `corepack pnpm install`.
- Use the migrations in `supabase/migrations`, including both November rebuild migrations. The old schema lacks `service.description` and cannot run the current seed correctly.
- On a fresh, disposable local database only, `corepack pnpm db:reset` applies migrations and runs the demo seed. It deletes existing local data and accounts; do not use it on shared data.
- Configure your own `.env.local` from `.env.example`. Do not commit credentials or copy another person's secret values. Set `UI_PREVIEW=false` for connected testing and restart the dev server.
- Keep API requests same-origin under `/api/v1`; the frontend does not currently have a separate backend-host setting. If moving the API to another host, agree on proxy, cookies and origin handling before changing paths.

### 2. Implement the missing optional service matcher

**Known implementation gap:** `POST /api/v1/finder/suggest` is called by the frontend but does not exist in the current backend. The complete contract is below. Add the route, strict validation, active-service allowlist, deterministic fallback, safety handling, bounded AI calls, rate limiting and server tests. Add its operation to `openapi.yaml` when implemented.

Do not replace or merge the existing `/triage/assess` route. Matching helps choose a service; urgency assessment has a separate contract. Students must still be able to book if matching is unavailable.

### 3. Verify the existing anonymous booking and tracking flow

These routes already exist; verify them against the new frontend before proposing API changes:

- `GET /services` and `GET /slots`: check active catalogue, closed days, minute-level opening hours, Bangkok dates, session duration and the separate 15-minute privacy buffer. The new weekly date strip/month popup still sends the existing `service_id` and `date` query parameters.
- `POST /requests`: check optional alias, required note, Routine/Urgent, AI consent, idempotency/retry, and simultaneous submissions for the same slot. Return a usable receipt and private access key without leaking either into logs.
- `GET /requests/me`: accept `X-Access-Key`; confirm invalid keys, throttling and status refresh. The student card intentionally omits internal references and private intake text. It resolves the service name using the catalogue and has a generic fallback if that lookup fails.
- `POST /requests/{id}/cancel`: check valid-key ownership and permitted status, releasing both appointment and buffer; check repeated cancellation and stale/conflicting requests.
- Verify that manual Urgent cannot be downgraded, opt-out does not call AI, provider failures use the existing safety fallback, and anonymous students are not promised staff contact. Urgent guidance now appears in a popup; its presentation does not change backend urgency rules.

### 4. Verify staff access and decisions

- Test the seeded practitioner and admin accounts locally. `/session` implements fixture sign-in; campus mode deliberately returns 404 there. If campus sign-in is required for delivery, complete the real identity-provider entry/return flow and validate its claims; the current adapter documents untested campus assumptions.
- Enforce staff roles server-side. A hidden frontend tab or link is not an access control.
- Practitioners now have separate **Schedule** and **Review requests** tabs. The count badge is `queue.length` from `GET /practitioner/queue`; it is not a new count endpoint, polling service or push notification. Verify urgent ordering, full pending queue and count changes after refresh/decisions. If pagination is introduced, agree on a total-count response with the frontend first.
- Verify approval, rejection, cancellation and rescheduling through `PATCH /requests/{id}/status`, including stale actions, concurrent staff edits and unavailable replacement times. Refreshing must remove resolved items from the queue and show the updated schedule.
- `GET /practitioner/schedule` must return the requested date range with pending/confirmed sessions and accurate buffer times. Switching UI tabs clears the displayed private note.

### 5. Verify administration and notification delivery

- `PATCH /admin/services/{id}`: save title, description, duration and active state from the numbered, expandable service list. Check duplicate names and duration validation; existing bookings retain their times.
- `PUT /admin/availability`: accept the existing `{ windows: [{ weekday, start_time, end_time }] }` payload. Scrolling time wheels select any minute, including `00` and `59`; keep `HH:mm` support and reject invalid or overlapping windows server-side. The numbered rows, text add/remove controls and green save button do not require a schema change.
- Check that future slots reflect saved windows and disabled services without moving existing appointments. Confirm correct handling of a day with no windows.
- Exercise the existing notification/outbox pipeline, configured Hub endpoint, signatures, dispatch authentication, retries and delivery receipts. Keep anonymous student contact limitations intact; distinguish local mock-Hub evidence from real integration evidence.

### 6. Run connected acceptance and update documentation

- On a disposable local database, run `corepack pnpm test:integration` (the integration workflow reseeds data). Run `corepack pnpm test`, `corepack pnpm check:openapi`, `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm build` and `corepack pnpm scan:bundle` after backend changes.
- Manually test: anonymous booking → copy key → track pending → practitioner approve/reschedule → student refresh → cancel → verify slot/buffer release. Also test service/window edits, permission failures and matching-provider outages.
- Add matcher-specific provider/fallback evaluation cases, then run the existing urgency evaluation separately. A fictional preview or mocked browser test is not proof of backend integration or AI accuracy.
- Update `docs/BACKEND-HANDOFF.md`, OpenAPI and deployment instructions to describe the final connected behavior. The A3/A5/A6–A7/A8 reports contain legacy finder contracts, services and evidence; reconcile them before treating them as current evidence. Use the contract below for the new matcher.

## Frontend verification at handoff

Production build, lint, typecheck, 123 unit tests, OpenAPI consistency (19 currently implemented operations) and the production bundle secret scan passed before this documentation handoff. Targeted browser checks covered the new student calendar, urgent popup, tracking states, admin editors/time wheels and practitioner tabs at mobile/desktop sizes; staff action checks used mocked responses.

**Not completed by this handoff:** implementing the matcher, running destructive integration/reseed commands against the user's database, testing real provider accuracy, validating campus SSO or proving real notification delivery. Treat the checklist above as backend verification work, not a list of confirmed backend defects.

## Optional AI service matching: implementation specification

Status: **frontend implemented; backend endpoint still required**. No backend routes, database schema, or existing urgency assessment were changed for this feature.

## Purpose

Help a student decide which existing counselling service fits a short description. This is service navigation, not diagnosis, urgency assessment, booking approval, or crisis support. It is optional and must never block browsing or booking.

The frontend is `src/components/ServiceMatcher.tsx`, displayed above the catalogue in a collapsed disclosure. Runtime validation and fixed reason text live in `src/lib/client/service-matching.ts`.

## Endpoint to implement

`POST /api/v1/finder/suggest`, public and anonymous, same-origin browser request.

This path existed in an older design but was removed. Implement the new contract below; do not restore the old `{ serviceIds, mode: "ai" }` response. Add the new operation and schemas to `openapi.yaml` when the route is actually implemented. The current OpenAPI file deliberately still describes only implemented backend operations.

Request, JSON, no additional fields:

```json
{
  "text": "Exams are affecting my sleep and I feel overwhelmed.",
  "ai_opt_in": true
}
```

- `text`: trimmed, nonempty string, at most 500 characters.
- `ai_opt_in`: required, literal `true`. Without consent return `400 validation_failed`; never call an AI provider.
- No service ID, student identity, access key, account, session, or intake-request ID is required or accepted.

Successful `200` response, JSON:

```json
{
  "mode": "AI_ASSISTED",
  "urgent_guidance": false,
  "recommendations": [
    {
      "service_id": "srv_academic_stress",
      "reason_code": "STUDY_SUPPORT"
    }
  ]
}
```

Exact response schema:

- `mode`: `AI_ASSISTED` or `DETERMINISTIC_FALLBACK`.
- `urgent_guidance`: boolean; required.
- `recommendations`: required array of zero, one, or two objects. Each has only `service_id` (1–64 characters) and `reason_code`.
- No additional fields in the response or recommendation objects. No model-written explanations, confidence scores, or clinical advice.
- IDs must refer to currently active services returned by `GET /services`. Remove duplicates and preserve ranked order.
- When `urgent_guidance` is true, return an empty recommendation array. The frontend suppresses appointment suggestions and points to the static emergency contacts already visible above the helper.

Allowed reason codes and the exact frontend explanations:

| Code | Displayed explanation |
| --- | --- |
| `STUDY_SUPPORT` | For concerns about exams, studying, or academic pressure. |
| `GENERAL_SUPPORT` | A broad option for talking through worries or difficult feelings. |
| `URGENT_SUPPORT` | For an urgent appointment request. This is not immediate crisis support. |
| `RELATED_SERVICE` | This service’s published description may fit what you shared. |

These codes describe catalogue fit, not a diagnosis. Choose a code consistent with the actual service description. An urgent appointment category must not substitute for immediate safety guidance.

## Suggested server pipeline

1. Use the existing `route()` wrapper with public access, strict Zod validation, the existing content-free error/logging conventions, and an appropriate per-address rate limit. Prefer existing abuse-limiting helpers; do not introduce student accounts.
2. Load the active service IDs, names, and descriptions from the server. Do not trust a catalogue supplied by the browser.
3. Check the short description against the existing safety/urgency phrase mechanism. Immediate-danger cues must return fixed emergency guidance, not only an appointment suggestion. Do not rely on AI as the sole crisis safeguard. Reuse the maintained phrase rules rather than the small illustrative frontend preview matcher.
4. If AI is enabled and available, give the model only the description and active catalogue. Treat the description as untrusted data. Request structured output limited to the allowed IDs and reason codes. No external tool calls or arbitrary URLs.
5. Validate the output against a strict schema and active-service allowlist. Never pass raw provider output through to the client. Unknown IDs, invalid codes, excessive results, malformed output, and timeout must trigger the deterministic fallback.
6. If AI is disabled, unavailable, or fails, use a deterministic matcher over service names/descriptions. Return `mode: "DETERMINISTIC_FALLBACK"`. If there is no defensible match, return an empty array rather than guessing.
7. Set `Cache-Control: no-store` on responses. Do not persist descriptions, link them to requests, or include them in logs, analytics, errors, URLs, events, or provider-debug traces. Confirm the provider configuration and user disclosure match the intended data-handling policy.

Reuse the existing AI client configuration and timeout approach, but keep service matching separate from `/triage/assess`. Do not send this description to the urgency endpoint: it has a different purpose and response contract. Booking and final intake triage remain unchanged.

## Fallback examples

No clear match or an empty catalogue:

```json
{
  "mode": "DETERMINISTIC_FALLBACK",
  "urgent_guidance": false,
  "recommendations": []
}
```

Immediate safety guidance:

```json
{
  "mode": "DETERMINISTIC_FALLBACK",
  "urgent_guidance": true,
  "recommendations": []
}
```

Keep wording and telephone contacts in the existing static emergency components; the model must not generate contact details.

## Errors and existing frontend behavior

| Status | Body | Frontend behavior |
| --- | --- | --- |
| `400` | `{ "error": "validation_failed", "fields": ["text"] }` or consent field | Helper unavailable; catalogue remains usable |
| `429` | `{ "error": "too_many_requests" }` | Ask the student to wait or choose a service directly |
| `503` | `{ "error": "service_unavailable" }` | Helper unavailable; catalogue remains usable |

Prefer a valid deterministic `200` over `503` for an AI-only failure. Existing missing-route `404`, network errors, and invalid response shapes also show a neutral unavailable message. The frontend times out after 10 seconds, so the server should finish or fall back sooner. Aborting the browser request is not a guarantee that the server stopped its provider call; apply a server-side timeout as well.

The browser sends text only after consent and an explicit submit. Editing text, revoking consent, clearing, or closing the disclosure invalidates stale suggestions and cancels the pending browser fetch. Closing the helper clears its local description and consent. Nothing is copied into the appointment note or saved in browser storage.

## Acceptance checks for the backend owner

1. Missing/false consent, empty/oversized text, and extra fields are rejected before any provider call.
2. Anonymous request succeeds; no student account or identity fields are needed.
3. A study-pressure example returns an appropriate active catalogue ID and an allowed reason code.
4. Similar descriptions can match based on meaning in AI mode; do not implement a keyword-only route while reporting `AI_ASSISTED`.
5. Provider disabled, timeout, outage, malformed output, invented IDs, and prompt injection all yield a bounded deterministic response.
6. Zero recommendations is valid; never invent a service or include an inactive one. Recheck the allowlist before responding.
7. Immediate-danger cues produce fixed emergency guidance and no appointment recommendation.
8. Rate limiting works, errors reveal no description, and logs/outbox/database tables contain no matching text.
9. The frontend works against the real endpoint with `UI_PREVIEW=false`, and booking still succeeds when the helper is offline.

## Frontend preview and proof

`UI_PREVIEW=true` uses an explicitly labelled, fictional local word matcher and never calls this endpoint or an AI provider. It is not evidence of AI accuracy. The frontend parser rejects malformed payloads, drops unknown/inactive IDs, deduplicates results, maps codes to fixed explanations, and suppresses suggestions when emergency guidance is returned.

Unit tests for those boundaries are in `tests/unit/service-matching.test.ts`. Provider accuracy and safety need server tests and an evaluation set owned with the backend change.
