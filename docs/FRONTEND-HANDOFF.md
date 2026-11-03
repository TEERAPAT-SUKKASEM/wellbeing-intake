# Frontend handoff

The frontend is ready for backend collaboration. It uses the existing same-origin `/api/v1` contract and existing Next.js route handlers. The UI changes do not replace the backend, change the database schema, or implement a second authentication system.

## Start with the UI

Use Node.js 22.12 or newer and pnpm 10. Install dependencies with `pnpm install`.

For a database-free preview, create `.env.local` containing `UI_PREVIEW=true`, then run `pnpm dev` and open the URL printed by Next.js. The homepage, request form, urgent guidance, and `/preview/requests` booking/cancellation flow use fictional in-memory data. Refreshing resets this preview. The preview flag is ignored in production builds.

For connected testing, use `UI_PREVIEW=false`, configure the server settings from [`.env.example`](../.env.example), and follow the local Supabase instructions and demo account list in [`README.md`](../README.md). The configured application origin and mock-hub URL must match the port you use. Do not copy another developer's `.env.local` into Git.

The seed command resets the demo dataset and deletes existing fixture auth users before recreating services, accounts, and future appointment slots. Run it only against an intended demo database. It does not create the sample request history used during the local design review; create requests through the student flow after seeding.

## Screens

| Route | Access and purpose |
| --- | --- |
| `/` | Public service catalogue and optional service matcher |
| `/sign-in` | Fixture account sign-in |
| `/request/new?service=<service UUID>` | Student request form |
| `/requests` | Student requests, booking, and cancellation |
| `/practitioner` | Service-specific queue, audited content views, and availability |
| `/coordinator` | Cross-service request metadata; no private request content |
| `/emergency` | Static emergency contacts with no database dependency |
| `/preview/requests` | Development-only booking preview |

## Integration points

- `src/lib/client/api.ts` sends same-origin requests with HttpOnly cookie sessions. It does not keep credentials in browser storage.
- `src/app/api/v1/` contains the existing backend routes. Preserve the public contract in [`openapi.yaml`](../openapi.yaml).
- `src/lib/http.ts` handles permissions, origin checks, validation, and content-free errors/logs. Keep protected routes behind this wrapper.
- `src/lib/identity/adapter.ts` handles fixture or campus identity. Role checks must remain server-side.
- `src/lib/supabase/admin.ts` is server-only. Never expose a service-role key or import this module into a client component.
- `supabase/migrations/` contains the schema and lifecycle functions. Preserve atomic booking, cancellation, and audited content reads.

| UI operation | Existing API |
| --- | --- |
| Load services | `GET /api/v1/services` |
| Suggest services | `POST /api/v1/finder/suggest` |
| Sign in / sign out | `POST` / `DELETE /api/v1/session` |
| Read current role | `GET /api/v1/me` |
| Submit / list student requests | `POST /api/v1/requests`, `GET /api/v1/requests/me` |
| Load available appointment times | `GET /api/v1/requests/{id}/slots` |
| Book / cancel | `POST /api/v1/appointments`, `POST /api/v1/appointments/{id}/cancel` |
| Practitioner queue / audited read | `GET /api/v1/queue`, `POST /api/v1/requests/{id}/content-views` |
| Practitioner availability | `GET` / `POST /api/v1/slots`, `DELETE /api/v1/slots/{id}` |
| Coordinator overview | `GET /api/v1/coordinator/requests` |

Use the OpenAPI document for exact fields, status codes, and remaining routes. If a separate backend is introduced, preserve the same-origin browser interface through server-side integration rather than putting database secrets in browser code.

## Behaviors to preserve

1. A student submits a request; opening it as the appropriate practitioner moves it into review through the audited read.
2. Non-urgent requests become bookable after review. Booking uses the actual request and slot UUIDs and requires explicit confirmation.
3. Urgent requests display emergency guidance and do not enter the booking flow.
4. Cancellation releases the appointment but does not reopen the handled request.
5. The student dashboard shows metadata, not the previous private request text. The coordinator never receives that text.
6. Dates use the device timezone. The UI does not invent duration, location, or practitioner details absent from the API.

## Design and verification

[`DESIGN.md`](../DESIGN.md) records the photograph background, frosted glass surfaces, navigation layout, accessibility behavior, and local typography. Font files and their license notices live in `src/app/fonts/`; no font download is needed to build the application. Campus photography is illustrative.

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:openapi`, and `pnpm build`. Integration tests use a database and reseed fixtures; use a dedicated test database rather than a shared demo database.

For a manual journey, use separate browser profiles for a student, the service's practitioner, and the coordinator. Submit a fictional request, review it as the practitioner, book and cancel as the student, and verify that the coordinator sees metadata only. Also check urgent guidance, service-loading retry, mobile navigation, and the collapsible desktop sidebar.
