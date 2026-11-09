# Frontend handoff

Additional feature: optional service matching is implemented in the frontend. Its server endpoint is **not implemented yet**. See [the backend fix specification](refine-backend.md) before connected testing. The fictional preview uses a labelled local word matcher.

The frontend implements the anonymous counselling journey in `wellbeing_prd.md` and `docs/PRD.md`. It uses the existing same-origin `/api/v1` backend. No backend routes, database migrations, or authentication services were changed.

## Run and connect

Use Node 22.12+ and pnpm 10. Run `pnpm install` and `pnpm dev`.

For a database-free student preview, set `UI_PREVIEW=true` in `.env.local`. The catalogue, slot picker, intake, key confirmation, tracking, and cancellation use fictional in-memory data. Submit a request to obtain a working preview key; refreshing clears all preview records. Preview AI returns an explicitly labelled manual fallback and does not send notes anywhere. Staff screens still use the real API; preview mode does not bypass permissions. The flag is ignored in production.

For connected testing, set `UI_PREVIEW=false` and configure the server variables in `.env.example` following `README.md`. The origin and mock-hub URL must match your development port. Students never sign in. Staff use the existing practitioner/admin accounts. Do not seed or reset a shared database just to review the UI.

## Screens and API connections

| Route | Purpose and API |
| --- | --- |
| `/` | Active services: `GET /services`, plain array |
| `/request/new?service=<service ID>` | Campus date/slot picker: `GET /slots?service_id=...&date=YYYY-MM-DD`; anonymous intake: `POST /requests`; optional AI: `POST /triage/assess` |
| `/requests` | Key entry/status: `GET /requests/me` with `X-Access-Key`; cancellation: `POST /requests/{id}/cancel` with `{ access_key }` |
| `/sign-in` | Staff only: existing session and current-role endpoints |
| `/practitioner` | `GET /practitioner/queue`, `GET /practitioner/schedule`, `PATCH /requests/{id}/status` |
| `/admin` | Service editing and weekly opening windows using existing admin endpoints |
| `/emergency` | Static emergency guidance; no database dependency |
| `/coordinator` | Legacy URL redirects to `/admin`; coordinator role is retired |
| `/preview/requests` | Development-only tracking screen; create a preview request first |

Paths in the table are relative to `/api/v1`. Exact bodies and responses are in `openapi.yaml`; backend-specific integration guidance is in `docs/BACKEND-HANDOFF.md`.

## Important behaviors

- Students choose an available time before submitting. Submission reserves the session and its buffer; a practitioner then approves, reschedules, rejects, or cancels.
- Only an optional alias is requested. No student login, legal name, email, or student ID fields.
- Urgency is `ROUTINE` or `URGENT`. Emergency guidance remains visible, and urgent results explain that staff cannot contact anonymous students.
- AI runs only with explicit consent. An AI failure never blocks manual submission.
- Each submission gets one `Idempotency-Key`. A failed response with an unknown outcome locks the original body for safe retry and key recovery. Definitively rejected submissions may be edited and retried.
- The access key appears in a confirmation dialog with copy and tracking actions. It is never placed in a URL, browser storage, or logs. A same-tab navigation handoff holds it in memory only. The student must save the key privately before refreshing or leaving.
- Status lookup uses `X-Access-Key`. Unknown keys show a neutral not-found message. The dashboard does not repeat the intake note.
- Students explicitly confirm cancellation. Practitioner decisions also require confirmation.
- Appointment and opening-hour controls consistently display campus time: Bangkok, UTC+7. The slot picker uses returned timestamps and availability; it does not calculate real booking rules.
- Practitioner schedules show pending/confirmed sessions and separate privacy-buffer blocks. Staff responses never contain student access keys.
- Admin editing preserves all returned opening windows, including multiple windows per day. Client validation rejects reversed or overlapping windows before saving.
- Database credentials remain server-only; staff permissions remain enforced by the backend.

## Verification

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:openapi`, `pnpm build`, and `pnpm scan:bundle`.

Frontend unit coverage includes header privacy, idempotency headers, campus date boundaries, and the preview submit/retry/lookup/cancel lifecycle. Database integration tests reseed fixtures and should only run against a dedicated test database.

For connected acceptance, use a fictional student note and separate staff browser profiles: choose service/time, submit without login, save the key, approve or reschedule as practitioner, check the new status using the key, then cancel. Also exercise a taken-slot response, AI failure, wrong key, signed-out staff, inactive services, empty opening hours, and mobile navigation.
