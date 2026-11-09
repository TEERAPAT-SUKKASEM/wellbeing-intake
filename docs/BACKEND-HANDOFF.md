# Backend handoff for the new PRD

For Nithikorn and anyone building the screens in [`PRD.md`](PRD.md). The backend is on branch `rebuild/v2`.
[`openapi.yaml`](../openapi.yaml) has the exact fields and status codes. This note covers how the screens
use it, what breaks in the current UI, and what the backend added to the PRD and why.

**The current UI is built for the old API.** Most screens will show errors or endless loading on this
branch until they are rebuilt.

## Run it

Follow "Run it locally" in the [README](../README.md). You need one new line in `.env.local`:

```bash
ACCESS_KEY_SECRET=<anything, locally>
```

Demo logins (password `demo-password-16`, local only): `practitioner.1@demo.test`, `practitioner.2@demo.test`,
`admin@demo.test`. Students don't log in.

## Screen 1: Service Finder & Slot Selector

| Step | Call | Notes |
| --- | --- | --- |
| Show categories | `GET /api/v1/services` | Now a plain array, not `{ services: [...] }`. Fields: `id`, `name`, `description`, `duration_minutes`, `is_active` |
| Show times | `GET /api/v1/slots?service_id=...&date=YYYY-MM-DD` | Plain array of `{ slot_start, slot_end, is_available }`. Show `date` in campus time. An empty array means the centre is closed that day |

The times already respect the 15-minute buffer. Don't calculate anything: just show `is_available` as
Available or Unavailable, and use the values exactly as returned when booking.

## Screen 2: Private Request & AI Triage

**Submit:** `POST /api/v1/requests`

```json
{
  "service_id": "srv_academic_stress",
  "alias": "QuietStudent",
  "intake_note": "Feeling overwhelmed with upcoming exams.",
  "manual_urgency": "ROUTINE",
  "requested_slot_start": "2026-11-10T03:00:00Z",
  "ai_opt_in": true
}
```

- **Send an `Idempotency-Key` header:** generate one `crypto.randomUUID()` per form and reuse it on retry.
  A double-click or lost response then returns the same request and key, instead of a confusing "slot taken".
- **There are no email, name or student ID fields.** The API rejects them.
- **Success** (`201`, or `200` on a retry) returns `id`, `access_key`, `status`, `urgency_level`,
  `triage_mode`, the times, `disclaimer` and `emergency_links`.

**The access key modal is critical.** The key is shown once and can't be recovered, because the backend only
stores a hash. Make it easy to copy, and say plainly that without it the student can't check or cancel. If you
save it in the browser, let the student choose: this may be a shared computer.

**AI widget:** `POST /api/v1/triage/assess` with `{ "intake_note": "..." }` returns `urgency_level`, `triage_mode`,
`disclaimer`, `emergency_links`.

- **Only call it after the student chooses AI**, such as with a "Check with AI" button, because it sends their
  note to an outside AI provider. Tell them that first. Send `ai_opt_in: true` on submit only if they agreed.
- It's only a suggestion. `POST /requests` decides, and marks the request `URGENT` if the AI, the urgency phrases
  or the student's toggle says so. A student's Urgent choice can't be lowered.
- `triage_mode: "DETERMINISTIC_FALLBACK"` means the AI wasn't used or failed. Show the toggle and carry on: the
  student is never blocked.

**Safety rules for this screen:**

- **Staff can't contact an anonymous student.** When the result is `URGENT`, show the emergency contacts right
  away and say that clearly. Don't suggest that someone will call them.
- Show contacts from `src/lib/emergency.ts` on this screen at all times, so they still appear if the API is down.
  Use `disclaimer` and `emergency_links` from responses for the result state.

## Status tracking (student)

| Action | Call | Notes |
| --- | --- | --- |
| Check status | `GET /api/v1/requests/me` with header `X-Access-Key: WB-...` | Use the header. `?access_key=` works, but hosting providers log full URLs. Replaces the old signed-in "My requests" |
| Cancel | `POST /api/v1/requests/{id}/cancel` with `{ "access_key": "WB-..." }` | Releases the time at once |

Statuses: `PENDING`, `CONFIRMED`, `REJECTED`, `CANCELLED`. A wrong key is always a plain `404`, so one message
such as "We couldn't find a request with that key" covers it. If a practitioner reschedules, the new time only
appears here, because there is no way to notify an anonymous student. Please make that visible.

## Screen 3: Practitioner Schedule & Triage Desk

Sign in with `POST /api/v1/session`, which sets an HttpOnly cookie. Same-origin `fetch` then just works.
`GET /api/v1/me` gives `{ role: "practitioner" | "admin", displayName }`, and `401` means signed out.

| UI | Call |
| --- | --- |
| Incoming queue, Urgent pinned first | `GET /api/v1/practitioner/queue` (`PENDING` only, already sorted) |
| Daily or weekly timeline | `GET /api/v1/practitioner/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD` (`PENDING` and `CONFIRMED`) |
| Buffer blocks on the timeline | Draw `requested_slot_end` to `privacy_buffer_end` on each item |
| **Approve** | `PATCH /api/v1/requests/{id}/status` with `{ "status": "CONFIRMED" }` |
| **Reschedule** | Same, with `{ "status": "CONFIRMED", "requested_slot_start": "..." }`, using a time from `GET /slots` |
| **Reject** (pending only) | Same, with `{ "status": "REJECTED" }` |
| **Cancel** | Same, with `{ "status": "CANCELLED" }` |

A taken time returns `409 slot_unavailable`. An impossible move returns `409 invalid_transition`.

## Admin (not in the PRD's 3 screens, but the role needs it)

| UI | Call |
| --- | --- |
| List all services | `GET /api/v1/admin/services` |
| Turn a service on or off, rename it, change its length | `PATCH /api/v1/admin/services/{id}` |
| Read or replace weekly opening hours | `GET` / `PUT /api/v1/admin/availability` |

## What goes away

- **Backend routes removed:** `/appointments`, `/coordinator/requests`, `/finder/suggest`, `/practitioners/{id}/slots`,
  `/queue`, `/requests/{id}` (PATCH), `/requests/{id}/content-views`, `/requests/{id}/slots`, `/slots/{id}`,
  and the old practitioner `/slots`.
- **Roles removed:** student accounts and the coordinator. New staff roles are `practitioner` and `admin`.
- **Probably safe to delete on your side:** `/coordinator`, `src/lib/triage.ts` (three urgency levels; only your
  screens use it), and the student sign-in redirects. Keep `src/lib/emergency.ts`.
- **Keep `/emergency` fully static.** A backend test checks that it stays `force-static`.

## What the backend added to the PRD, and why

| Added | Why |
| --- | --- |
| Longer access key (`WB-XXXX-XXXX-XXXX`), stored only as a hash | `WB-9842-X` has about 260,000 combinations and unlocks a private note with no login, so a script could guess keys |
| `X-Access-Key` header | Keeps the key out of URL logs |
| Limits on requests and failed key attempts | Without login, a script could otherwise fill the whole calendar |
| `Idempotency-Key` header | A lost response would otherwise strand a student with a held slot and no key |
| No `access_key` in staff responses | Staff could otherwise act as the student |
| `POST /triage/assess` | Screen 2's widget needs a suggestion before submitting |
| `ai_opt_in` | The PRD says students can decline AI, but its body had no way to say so |
| `requested_slot_start` and `CANCELLED` on `PATCH .../status` | Screen 3's Reschedule and Cancel buttons had no API |
| `GET /practitioner/schedule` and `privacy_buffer_end` | Screen 3's timeline needs confirmed sessions and buffer blocks |
| Admin endpoints | The Administrator role had none |
| `description` on services | The category view needs something to say |
| `triage_mode` value `DETERMINISTIC_FALLBACK` | The PRD only named `AI_ASSISTED` |
| `appointment.cancelled` webhook | The Hub would otherwise keep reminding about cancelled appointments |
| Signature and `X-Event-Id` headers on webhooks | Security and de-duplication, keeping the PRD's body exact |

Everything in the PRD's contract still works as written, apart from the longer key format and staff responses
leaving out `access_key`.
