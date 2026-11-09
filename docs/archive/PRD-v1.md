# Product Requirements Document — Private Wellbeing Intake & Booking (Team 16)

**Date:** 2026-08-12 · **Revised:** 2026-09-20 (revision 2) · **Status:** final, pending team review of revision 2
**Sources:** assembled from the five pipeline documents — `outputs/01_problem_discovery.md`, `outputs/02_requirements.md`, `outputs/03_data_model.md`, `outputs/04_architecture.md`, `outputs/05_techstack.md`.
**Workshop note (AI as copilot):** this document was AI-drafted and team-reviewed; all decisions are owned by the group. Anything marked _(Assumption: …)_ is unvalidated and must not be treated as fact.
**Revision 2 (2026-09-20) — platform alignment:** brings this PRD into line with the platform PRD (_University Digital Campus Platform_) and closes five internal gaps. Platform fixes: a swappable identity adapter for real Team 01 tokens (BR-26); one real signed outbound webhook to the Notification Hub in the platform event envelope (FR-18, NFR-17); an MVP AI capability with a deterministic fallback that never touches request content (FR-23, BR-24); platform API conventions and the platform definition of done (NFR-18–NFR-21, AC-8, AC-9). Internal fixes: booking preconditions (BR-10), reminder retraction on cancellation (BR-25), metadata-only queue and owner-read audit scope (FR-10, BR-07), the In-review trigger (BR-08), and dangling reminder references on slot removal (K-20). New IDs are appended, never renumbered: FR-23, NFR-17–NFR-21, BR-24–BR-26, K-18–K-20, C-12, R-9–R-11, AC-8–AC-9, OD-1. The five pipeline documents predate this revision; where they disagree, this PRD governs.
**Revision 3 (2026-09-20) — implementation notes.** Recorded while building the first slice; each item needs team sign-off. (1) **FR-24, new — inbound webhook receiver.** Assignment A5 requires receiving a partner event, so NFR-17's "Team 16 consumes no inbound events at MVP" is superseded: `POST /api/v1/webhooks/notification-hub` accepts Notification Hub delivery receipts (`notification.delivered` / `notification.failed`) carrying only our opaque `reference`, verifies the signature over the raw body before parsing, and is idempotent on `eventId`. _(Assumption: Team 20 can send receipts; if not, swap the source for a Team 01 Identity event — the receiver is source-agnostic.)_ (2) **Two operational tables beyond the nine entities:** `inbound_event` (the receiver's idempotency log — event id, source, type, reference, timestamps; no content) and `ai_call_budget` (one row per day, a counter, no visitor identifier — NFR-19). Justified under C-08's escape clause by FR-24 and NFR-19 respectively. (3) **Team-defined paths (Section 11.4) are now fixed:** audited content read is `POST /requests/{id}/content-views` (POST because every call writes an audit event); student slot listing is `GET /requests/{id}/slots` (returns no practitioner identities); plus `GET /queue`, `GET /coordinator/requests`, `GET|POST /slots`, `DELETE /slots/{id}`, `GET /me`, and fixture-mode `POST|DELETE /session`. `openapi.yaml` is authoritative. (4) **`GET /requests/me` returns status metadata only** — request content is never shown back on the "my requests" screen, which is how FR-20/NFR-09 ("cancelled-request content never resurfaces") is met by construction. (5) **Approved LLM:** the FR-23 helper is implemented against **Groq** through its OpenAI-compatible API (`LLM_MODEL`, default `openai/gpt-oss-20b`), chosen on 2026-09-21 because its free tier needs no card and so meets C-04 at 0 THB; the first slice targeted the Claude API, which has no free tier. _(Assumption: the course accepts Groq as the approved model — confirm with the instructor. Check Groq's current data-use terms before the demo; what we send is unchanged: the typed text and the public catalogue only, NFR-10.)_

---

## 1. Product Overview

### Product Name

**Private Wellbeing Intake & Booking** (Team 16) — a campus platform for privately requesting and booking health, counselling, and wellbeing appointments with safe triage boundaries. _(Working name from the team brief and requirements doc; no marketing name has been chosen.)_

### Problem Statement

Students who need health, counselling, or wellbeing support face two compounding barriers at the intake step: **exposure** (disclosing a sensitive need out loud at a reception desk, into a shared inbox, or over the phone) and an **unstructured, opaque process** — no visibility into request status, multi-day email round-trips, and no structured way to signal urgency, so a student in crisis and a student wanting a flu shot enter the same undifferentiated queue. The request-and-triage intake step is unstructured, feels privacy-risky, is opaque to the student, and does not separate urgent from routine demand.

Two caveats shape everything downstream (discovery §1):

- _(Assumption: the request channel — rather than counsellor capacity, wait times, or stigma itself — is the real barrier; if capacity is the constraint, a smoother form only lengthens the queue.)_
- The product is an intake and scheduling tool, **not** a diagnostic, care, or crisis tool (BR-03). Its most important behaviour for a student in acute distress is knowing when to step aside and route them to humans.

### Target Users

**Primary — help-seeking students** (not a monolith):

- **The hesitant first-timer** — unsure their problem "counts"; highly sensitive to any signal the process is recorded or visible. The service finder (FR-01) mostly exists for them.
- **The privacy-critical student** — fears parents, lecturers, classmates on reception, or (for international students) visa/scholarship consequences finding out; needs a plain-language answer to "who can see this?" (FR-04). _(Assumption: these fears are prevalent on this campus.)_
- **The student in acute distress** — the app must **not** serve them; it surfaces emergency contacts and hands off immediately (FR-08, BR-03). This user defines the safe triage boundary.
- **The routine/physical-health user** — vaccinations, physio, certificates. Low stigma but strategically valuable: if "everyone" uses the app for flu shots, opening it carries no social signal, which protects the counselling users.

**Secondary — practitioners** (counsellors, nurses, wellbeing officers): publish slots, review the triage-ordered queue, confirm appointments. Time-poor, confidentiality-bound, and the gatekeepers whose buy-in decides adoption.

**Tertiary — intake coordinator / triage reviewer**: owns confirming urgency and backstops acute-flagged requests (BR-04); sees operational metadata only, never request content (FR-13, PR-03). _(Assumption: one coordinator role suffices for MVP; on a small service the role may merge with Practitioner — see Section 3.)_

**Stakeholders with veto power (not users):** counselling service leadership, the privacy/records office, clinical governance — likely simulated for a semester project, with the instructor as proxy (C-01).

**Explicitly not users at MVP:** parents/guardians, faculty referrers, external clinicians, administrators wanting reports, emergency services.

### Product Goal

Let a student **privately request the right service, receive safe urgency guidance, and book a confirmed slot** — with sensitive information visible only to the practitioner who needs it, crisis contacts displayed at the exact point of asking, and every view of request content audited (BR-06, BR-07). Success for the semester: the core journey plus the urgent-escalation edge case demonstrated with role boundaries enforced and all seven mandated test areas green (NFR-13).

**Honest ceiling (C-11):** the realistic deliverable is a convincing privacy-by-design prototype on seeded demo data — never a production system handling real student health information (BR-18, C-06).

---

## 2. Scope

### In Scope

The fixed shape from the brief (C-08): three core screens (service finder, private request, practitioner schedule), four named entities (Service, Request, Appointment, TriageLevel), three hard-coded triage levels, one campus, one language — plus only the minimal supplements the journey and mandated tests demand: the emergency-contacts page, the "my requests" view, the coordinator metadata view, and five supporting records — Slot (FR-14–FR-17), User (FR-03, BR-20), RequestStatusChange (FR-12), AuditEvent (FR-11, BR-07), and OutboundEvent (NFR-17, K-18) — for nine entities total, each justified in Section 8 under C-08's escape clause.

- **Service finder**, browsable without sign-in, answering per service: what it's for, what a first session looks like, who will know (FR-01, FR-02, BR-20).
- **Service-finder helper with AI plus deterministic fallback**: an optional pre-login "help me choose" box that ranks the seeded services — by an approved LLM when available, by a keyword matcher otherwise — and never touches a request, an identity, or an urgency level (FR-23, BR-24).
- **Sign-in via the campus Identity boundary** through one swappable identity adapter — real Team 01 access tokens in the connected slice, fixture users for local development and tests — consuming only contact and access claims (FR-03, BR-19, BR-26, C-07).
- **Plain-language privacy notice** before submission, naming exactly who can and cannot see the request (FR-04).
- **Private request submission** with structured description, optional staff-readable free text, preferred times, and a mandatory fixed self-assessment choosing one of three hard-coded urgency levels (FR-05, FR-06, BR-01, BR-02).
- **Always-visible emergency/crisis contacts** on the request screen and a static standalone page, resilient to data failures (FR-07, BR-17, NFR-11).
- **Acute-distress escalation path**: highest urgency foregrounds emergency numbers, states the app cannot provide immediate help, and flags the request for human escalation outside the app (FR-08, BR-03, BR-04).
- **Student "my requests" status view** — the only channel for status, no exposing emails (FR-09).
- **Practitioner queue** ordered by triage level then submission time, with a fixed request-status lifecycle and an audit event per content view (FR-10, FR-11, FR-12, BR-05–BR-08).
- **Coordinator metadata-only view** across services, acute-flagged first (FR-13).
- **Manual slot publishing and booking**: discrete slots, one open slot per appointment, first confirmed booking wins, request marked Handled (FR-14–FR-17, BR-09–BR-12).
- **Metadata-only reminders** delivered to the Notification Hub (Team 20) as a signed webhook in the platform event envelope, with the `data` block held to a fixed allowlist, and a content-free retraction event when a reminded appointment is cancelled (FR-18, NFR-06, NFR-17, BR-16, BR-25).
- **Platform conventions and definition of done**: `/api/v1` base path, OpenAPI 3.1 contract, correlation IDs, health check, rate limiting, CSRF protection, accessibility checks, README, runbook, and CI (NFR-18–NFR-21, C-12).
- **One-tap penalty-free cancellation** that immediately frees the slot; new requests always start empty (FR-19, FR-20, BR-13–BR-15).
- **Deny-by-default role enforcement in the service logic** on every operation (FR-21, NFR-01, Section 3 matrix).
- **Seeded demo data only**, provisioned via fixtures, fully disposable (BR-18, BR-21, NFR-09, C-06).
- **The seven mandated test areas** — privacy, request, booking, cancellation, role boundary, reminder, urgent escalation — automated and green before the demo (NFR-13; traceability table in Section 5).

Delivered by 3–5 student developers in one semester at 0 THB on free tiers (C-02–C-04); stack decision final: Option A, Vercel + Supabase (Section 10).

### Out of Scope

Full itemized list with rationale: requirements doc §6 (OOS-01–OOS-23). Governing cut rule: anything not exercised by the core journey, its urgent-escalation edge case, or one of the seven mandated tests is cut by default. Summarized by theme:

- **AI in the request or triage path** — no live AI triage, no AI crisis detection or automated escalation from free text (OOS-01, OOS-02); AI urgency suggestion stays an off-by-default flagged demo (FR-22). The only AI in the MVP is the pre-login service-finder helper, which never sees a request, an identity, or an urgency level (FR-23, BR-24).
- **Care and content features** — no in-app messaging/chat, no session notes or clinical records, no mood tracking or self-help library (OOS-03, OOS-10, OOS-20); the product ends when the appointment happens or is cancelled (BR-22).
- **Integrations beyond the platform minimum** — OOS-04 is narrowed in revision 2: Identity sign-in and the outbound Notification Hub webhook are real in the connected slice (C-07, C-12). Live delivery to Security & Compliance, any inbound event, and any Data & Analytics feed stay out, behind the same envelope and a contract mock.
- **Scheduling conveniences** — no calendar sync, rescheduling flows, request editing/withdrawal, waitlists/auto-reallocation, or practitioner-initiated cancellation (OOS-05–OOS-07, OOS-11, OOS-22).
- **Notification breadth** — no SMS/push/email templates; metadata to the hub and stop (OOS-08).
- **Analytics and reporting** — none at all; shipping no analytics is the mandated compliance posture (OOS-09, NFR-04, C-09). An aggregate demand-vs-capacity signal (counts and wait times only, never content) is a post-MVP possibility only. The platform PRD expects material events to reach Data & Analytics "with privacy minimisation"; that tension is recorded as open decision OD-1 (Section 16), with a pre-designed minimal fallback.
- **Marketplace features** — no practitioner matching, profiles, or ratings (OOS-12, OOS-18).
- **Identity edge cases** — no third-party referrals, no anonymous/pseudonymous requests (anonymity ends at sign-in, BR-20) (OOS-13, OOS-15).
- **Capacity variants** — no group sessions, workshops, or recurring appointments (OOS-14).
- **Data retention for convenience** — no pre-filled rebooking from cancelled-request content (OOS-16, FR-20).
- **Admin and punitive machinery** — no self-service admin portal (seed via fixtures), no no-show penalties or booking limits (OOS-17, OOS-19, BR-21).
- **Configurability and reach** — no configurable triage taxonomies, multi-language, multi-campus, payments, or telehealth (OOS-21).
- **Staff triage adjustment** — staff cannot confirm or change a student's self-assessed level at MVP (OOS-23, BR-02); an open clinical question deferred post-MVP.

---

## 3. User Roles

Three authenticated roles plus the unauthenticated **Visitor**. Roles are fixed, seeded via fixtures (BR-21), and every session carries exactly one role derived from Identity access claims. Access is **deny by default**: any capability not explicitly granted in the matrix is denied, enforced in the service logic on every operation regardless of client or screen (FR-21, NFR-01) — hiding UI elements is never the control.

- **Visitor** — anyone not signed in. May browse only the service finder (including its "help me choose" helper, FR-23) and the static emergency-contacts page (FR-02, BR-20); nothing user-specific renders before authentication. _(Assumption: pre-login browsing is compatible with the Identity constraint; verify week 1 — fallback is making the finder the first post-sign-in screen.)_
- **Student** — an authenticated help-seeker. Creates requests, sees only their own requests and statuses, books one open slot against their own request, cancels their own upcoming appointment. Never sees other students' existence, requests, or appointments (PR-02).
- **Practitioner** — counsellor, nurse, or wellbeing officer. Sees the triage-ordered queue and request content **for their own service only**, with every content view audited (BR-06, BR-07); moves requests through the fixed status lifecycle including Escalated and Closed (FR-12, BR-08); publishes and removes their own unbooked slots (FR-14). Cannot read another service's queue (PR-02).
- **Coordinator/Admin** — intake coordinator / triage reviewer. Strictly metadata-scoped and read-only: sees request identifiers, service, triage level, status, and timestamps across all services with acute-flagged requests first (FR-13); any operation that would surface a description or free text to a coordinator is denied (PR-03). Owns the review of acute-flagged requests within the documented demo-world response time (BR-04). _(Assumption: one coordinator role suffices for MVP; on a small service the role may merge with Practitioner — a merged user simply gains both columns' grants, PR-03.)_

### Role–Capability Matrix

("Own" = only records bound to that authenticated identity, checked in service logic on every operation — PR-01. "Service" = only records of the practitioner's own service. "Meta" = operational metadata only, never content.)

| Capability                                                          | Visitor | Student                                | Practitioner                         | Coordinator/Admin                                   |
| ------------------------------------------------------------------- | ------- | -------------------------------------- | ------------------------------------ | --------------------------------------------------- |
| Browse service finder / emergency-contacts page                     | Yes     | Yes                                    | Yes                                  | Yes                                                 |
| Use the service-finder helper (AI or fallback; nothing stored — FR-23) | Yes  | Yes                                    | Yes                                  | Yes                                                 |
| Create request                                                      | No      | Own only                               | No                                   | No                                                  |
| Read request content (description + free text + preferred times)    | No      | Own only (owner reads are not audited — BR-07) | Service only; every view audited; the queue itself is Meta only (FR-10) | Never — Meta only          |
| Read request status / operational metadata                          | No      | Own only                               | Service only (triage-ordered)        | All services (Meta, acute-flagged first)            |
| Update request status (fixed lifecycle, incl. Escalated and Closed) | No      | No                                     | Service only                         | No                                                  |
| Edit request content after submission                               | No      | No                                     | No                                   | No                                                  |
| Publish / remove availability slots                                 | No      | No                                     | Own only; remove only while unbooked | No                                                  |
| View open slots                                                     | No      | For the service handling their request, once it is In review | Own schedule   | No                                                  |
| Book appointment (create)                                           | No      | Own In-review, non-acute request + one open slot only (BR-10) | No            | No                                                  |
| Cancel appointment                                                  | No      | Own only                               | No                                   | No                                                  |
| Read / modify audit events in-app                                   | No      | No                                     | No                                   | No — events emit outward only                       |
| Toggle AI feature flags (FR-22, FR-23)                              | No      | No                                     | No                                   | No — deployment-time settings, not in-app controls  |

Ownership and boundary rules PR-01–PR-06 apply (requirements doc §4): no delegation or third-party access (PR-01); no cross-student or cross-service content visibility (PR-02); coordinator strictly metadata-scoped and read-only (PR-03); no post-submission content editing by any role — deliberately no "super-reader" (PR-04); no in-app access to audit events (PR-05); every denial in this matrix exercised by at least one negative role-boundary test per row (PR-06).

---

## 4. User Journey

### Main Journey

One linear happy path — a hesitant student books a routine counselling appointment. This loop exercises all four brief entities plus Slot, and covers the privacy, request, booking, cancellation, reminder, and role-boundary test areas; urgent escalation is covered by the edge case below.

| #   | Step                             | User action                                                                                                                                                                              | System response                                                                                                                                                                         | Data / rules involved                                          | Possible failure                                                                                                                                                      |
| --- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Browse anonymously               | Student opens the service finder without signing in and reads what each service is for, what a first session looks like, and who will know                                               | Renders seeded services with plain-language descriptions; emergency-contacts page reachable; nothing user-specific shown. An optional "help me choose" box ranks the same seeded services — by AI when available, by keyword matching otherwise — storing nothing (FR-23) | Service entity; FR-01, FR-02, FR-23, BR-20, BR-24              | Pre-login browsing proves incompatible with the Identity constraint _(Assumption in FR-02; fallback: finder becomes first post-sign-in screen)_                       |
| 2   | Sign in, see the privacy promise | Student picks a service and signs in via campus Identity (through the identity adapter — BR-26)                                                                                                                     | Consumes and persists only contact and access claims, discarding anything else; shows the privacy notice naming exactly who can and cannot see the request                              | FR-03, FR-04, BR-19, C-07                                      | Identity (real or fixture) offers extra attributes — must be discarded, never stored (FR-03, NFR-03)                                                                               |
| 3   | Submit a private request         | Student enters a brief structured description, optional free text (visibly labelled staff-readable), preferred times, and picks one of three urgency levels in the fixed self-assessment | Records the request as Submitted with the student's level as the authoritative triage level; crisis contacts visible throughout without scrolling                                       | Request, TriageLevel; FR-05, FR-06, FR-07, BR-01, BR-02, BR-08 | No urgency level chosen — submission rejected (FR-06). Highest level chosen — journey exits to the acute-distress edge case (FR-08)                                   |
| 4   | Wait with visibility             | Student checks the private "my requests" view                                                                                                                                            | Shows only the student's own requests with current status; no status ever leaves the authenticated app                                                                                  | FR-09, NFR-02                                                  | Attempt to view another student's request — denial indistinguishable from a nonexistent record (FR-21, NFR-02)                                                        |
| 5   | Practitioner reviews             | Practitioner opens their service's queue and reviews the request                                                                                                                         | Queue ordered by triage level (highest first), then submission time (oldest first); queue rows carry metadata only, so loading the queue is not a content view. Opening a request is: each content view emits one content-free audit event to the Security & Compliance boundary, and the first one moves the request Submitted → In review in the same transaction (BR-08) | FR-10, FR-11, FR-12, BR-05, BR-06, BR-07, BR-08, NFR-05        | Practitioner of a different service attempts access — denied (PR-02); a view without an audit event is a test failure (NFR-05)                                        |
| 6   | Book                             | Once the request shows In review, student selects one of the open (future, unbooked) slots for the service handling their request                                                                                        | Creates a confirmed appointment linked to student, slot, and request; marks the request Handled                                                                                         | Appointment, Slot; FR-15, FR-16, FR-17, BR-09, BR-10, BR-11    | Two concurrent attempts on one slot — first confirmed booking wins, the other gets a clear rejection and refreshed availability (FR-17, BR-10). Request not yet In review, already terminal, or acute-level — booking rejected server-side with a content-free reason (BR-10, K-8) |
| 7   | Get reminded                     | (No user action)                                                                                                                                                                         | At the reminder lead time, and only if the appointment is still confirmed, publishes exactly one signed `appointment.reminder` event to the Notification Hub in the platform envelope: `subject` addresses the student; `data` holds only date/time, generic "you have an appointment" text, opaque reference — never service, practitioner, reason, or triage level | FR-18, NFR-06, NFR-17, BR-16, K-14, K-18                       | A payload with any field outside the allowlist is blocked before publication (NFR-06) _(Assumption: the generic wording is truly non-revealing; validate with peers)_ |
| 8   | Attend or cancel                 | Student cancels in a single confirmation action — no justification required                                                                                                              | Slot returns to the open, bookable pool immediately; no penalty; cancelled-request content never resurfaces. If a reminder was already published, a signed `appointment.cancelled` retraction carrying only the opaque reference is sent so the Hub never reminds a student about a cancelled appointment (BR-25); if not yet published, it simply never is (K-14) | FR-19, FR-20, BR-13, BR-14, BR-15, BR-25                       | Student wants a new time — no reschedule flow exists (OOS-06); cancel + submit a new request, which starts empty (BR-14)                                              |

### Edge case — acute distress (deliberately outside the happy path)

The app must **not** serve a student in crisis (BR-03). When the highest urgency level is selected at step 3, the screen foregrounds emergency numbers, states in plain language that the app cannot provide immediate help, and does not present booking as the resolution — while still recording the request flagged for human escalation outside the app via the existing crisis pathway (FR-08). The acute flag surfaces first in the coordinator view (FR-13) and has a named human owner reviewing it within the documented demo-world response time (BR-04) _(Assumption: policy values unvalidated; instructor-as-proxy sign-off)_. The practitioner records the handoff by marking the request Escalated (FR-12, BR-08). Withholding the booking flow is not only a screen behaviour: the booking operation itself rejects any acute-level request server-side (BR-10, K-8), so no client can book its way around the handoff. A student who picked the acute level by mistake submits a new request at the right level (BR-08 permits multiple requests); staff close the mistaken one. Emergency contacts remain reachable throughout, even under data failure, per NFR-11 and BR-17. This branch is exercised by the mandated urgent-escalation test, separately from the happy path.

### AI note

The platform definition of done requires one AI capability with a deterministic fallback. Team 16 meets it at the one point in the journey that holds no sensitive record: the pre-login service finder (step 1, FR-23). The helper receives only the text a visitor types into it, returns only a ranking of seeded services, stores nothing, and degrades to a keyword matcher whenever the AI is off, slow, over budget, or returns anything invalid — so steps 1–8 work identically with AI unavailable (BR-24).

Triage stays AI-free. The MVP journey runs entirely on the fixed self-assessment: the AI urgency-suggestion feature is disabled by default behind a deployment-time switch, and while off no request content crosses the boundary to any AI component (FR-22, NFR-10, OOS-01; behaviour if ever enabled is bounded by FR-22 and BR-23). Steps 1–8 function unchanged with the flag off — the journey never depends on it.

---

## 5. Functional Requirements

The 23 requirements below are the implementation contract for the core journey and its urgent-escalation edge case. Entities and screens are bounded by C-08; anything not listed here is governed by the Out-of-Scope list (OOS-01–OOS-23). FR-22 is a stretch item, not part of the MVP path.

### Service discovery and sign-in (journey steps 1–2)

- **FR-01** — The system shall present a service finder listing every seeded service with a plain-language description answering three questions: what the service is for, what a first session looks like, and who will know about a request.
- **FR-02** — The system shall allow the service finder and the static emergency-contacts page to be browsed without signing in; nothing user-specific is ever rendered before authentication. _(Assumption: pre-login browsing is compatible with the Identity constraint; verify in week 1 — fallback is making the finder the first post-sign-in screen.)_
- **FR-03** — The system shall authenticate users through the campus Identity boundary and shall consume and persist only the required contact and access claims, discarding any other attribute offered. Token verification lives in exactly one identity adapter (BR-26): it verifies Team 01 Identity access tokens in the connected slice and fixture sessions in development and tests, and no other code inspects a token.
- **FR-23** — The system shall offer, on the pre-login service finder, an optional "help me choose" helper: the visitor types what they are looking for and the system returns a ranked shortlist of seeded services, displayed using only the seeded FR-01 descriptions. When the AI capability is enabled and healthy the ranking comes from an approved LLM behind a server-side endpoint; otherwise — flag off, timeout, error, budget exhausted, or an AI response that is not a valid list of seeded service identifiers — the system shall silently use a deterministic keyword matcher over the seeded service keywords and produce the same kind of result. The helper shall never generate free-form advice, assess urgency, or diagnose; shall never receive identity, session, or request data; shall persist and log none of the typed text; and shall always be rendered beside the emergency contacts, a plain statement that it cannot assess urgency, and the full browsable service list (BR-24).
- **FR-04** — The system shall display, before a request can be submitted, a plain-language privacy notice naming exactly who can see the request content (the practitioner(s) of the chosen service), stating that the coordinator sees operational metadata only, and explicitly naming who cannot see it (faculty, parents, analytics).

### Private request and triage (journey step 3, escalation edge case)

- **FR-05** — The system shall allow an authenticated student to submit a private request consisting of exactly: the selected service, a brief structured description, an optional free-text field visibly labelled as staff-readable at the point of entry, preferred times, and a self-assessed urgency level. No other request fields exist at MVP.
- **FR-06** — The system shall require the student to complete a fixed self-assessment choosing exactly one of three hard-coded urgency levels before submission; the student's choice is recorded as the request's triage level, and no request is accepted without it.
- **FR-07** — The system shall display emergency/crisis contact information at all times on the request screen and on one static emergency-contacts page, rendered without depending on any user data being loaded.
- **FR-08** — When the student selects the highest urgency level, the system shall foreground emergency contact numbers, state in plain language that the app cannot provide immediate help, and not present the standard booking flow as the resolution of the crisis; the system shall still record the request, flagged for human escalation outside the app via the existing crisis pathway.

### Status visibility (journey step 4)

- **FR-09** — The system shall provide each student a private, authenticated "my requests" view listing only their own requests with current status; the system shall transmit no request status, request content, or service identity over any channel outside the authenticated app (the FR-18 reminder metadata is the sole outbound exception).

### Practitioner queue and review (journey step 5)

- **FR-10** — The system shall present each practitioner a queue containing only requests submitted to their service, ordered by triage level (most urgent first), then by submission time (oldest first). Queue entries carry operational metadata only (request identifier, triage level, status, submission time) — never the structured description, free text, or preferred times — so loading the queue is not a content view; content is reached only by opening a request through the audited read (FR-11).
- **FR-11** — The system shall record an audit event (viewer identity, viewer role, request identifier, timestamp) for every view of request content by anyone other than the owning student, and emit it to the Security & Compliance boundary in the platform event envelope as `request.content_viewed` (contract mock at MVP; demo-grade per NFR-05, not compliance-grade). A student reading their own request is not a third-party access and emits no event.
- **FR-12** — The system shall allow a practitioner to move a request in their own service's queue through the fixed status lifecycle defined in BR-08 (including marking it escalated to record handoff to the out-of-app crisis pathway, and closing a stale request), recording who made each change. Submitted → In review is never set by hand: it occurs automatically on the first audited practitioner read of the request's content, in the same transaction, recorded with that practitioner as actor; the practitioner's manual transitions are to Escalated or Closed, from either Submitted or In review. The system shall not allow any role to edit a request's content after submission, and shall never attempt in-app crisis intervention.
- **FR-13** — The system shall provide the coordinator a view of operational metadata only (request identifier, service, triage level, status, timestamps) across services, with acute-flagged requests surfaced first; coordinator views shall never render a request's structured description or free text.

### Booking (journey step 6)

- **FR-14** — The system shall allow a practitioner to publish discrete availability slots for themselves via manual entry and to remove a slot only while it is unbooked; slots shall also be seedable via fixtures. No calendar synchronization exists at MVP.
- **FR-15** — The system shall show a student the open (future, unbooked) slots of the practitioner(s) for the service handling their request, once that request is In review.
- **FR-16** — The system shall create a confirmed appointment when a student selects exactly one open slot against their own In-review, non-acute request, linking the appointment to the student, the slot, and the originating request, and shall simultaneously mark that request handled.
- **FR-17** — The system shall reject any booking attempt against a slot that is no longer open, inform the student clearly, and present refreshed availability; two concurrent booking attempts on the same slot shall result in exactly one appointment and one clear rejection. A booking attempt against the student's own request that is not In review (still Submitted, or already terminal) or whose triage level is the acute level shall be rejected server-side with a clear, content-free reason (BR-10).

### Reminder (journey step 7)

- **FR-18** — The system shall publish, for each appointment still confirmed at the reminder lead time, exactly one `appointment.reminder` event to the Notification Hub (Team 20) as a signed webhook in the platform event envelope (NFR-17). The envelope `subject` identifies the recipient student by their Identity reference — without it the Hub cannot know whom to notify; the `data` block contains only the appointment date/time, a generic "you have an appointment" text, and an opaque appointment reference — never the service name or type, practitioner name or specialty, reason, triage level, or any request content. Until Team 20's endpoint is available the same signed HTTP delivery targets a contract mock (C-07).

### Cancellation (journey step 8)

- **FR-19** — The system shall allow a student to cancel their own upcoming appointment in a single confirmation action, with no justification or free text required; the cancelled appointment's slot shall return to the open, bookable state immediately. If a reminder for that appointment has already been published, the system shall publish an `appointment.cancelled` retraction carrying only the opaque reference (BR-25); if none has been published, none ever is.
- **FR-20** — The system shall start every new request empty; no content from any prior request — whether handled, escalated, closed, or one whose appointment was later cancelled — shall ever be carried over, pre-filled, or offered for reuse.

### Cross-cutting — access enforcement and AI boundary

- **FR-21** — The system shall deny every read or write that falls outside the role permissions matrix (Section 3; PR-01–PR-06), with enforcement applied by the service logic on every operation regardless of which client or screen issued it, and the denial shall reveal no resource content.
- **FR-22** _(stretch, conditional — not in the MVP path)_ — The system shall keep the AI urgency-suggestion feature disabled by default behind a configuration switch; while disabled (the MVP state), no request content shall be sent to any AI component and the entire journey (FR-01–FR-21) shall function unchanged using the fixed self-assessment. If ever enabled for a demo, the AI shall only suggest a level alongside an unmissable emergency disclaimer; the student's own selection remains final, and the AI shall never diagnose, block a submission, or downgrade a student-set level.

### Mandated test-area traceability

The seven mandated test areas from the team brief, each mapped to the requirements that back it (NFR-13 makes this suite the quality bar):

| Test area         | Backing requirements                                         |
| ----------------- | ------------------------------------------------------------ |
| Privacy           | FR-04, FR-09, FR-11, FR-18, NFR-02–NFR-07, BR-06, BR-07      |
| Request           | FR-05, FR-06, FR-08, BR-08                                   |
| Booking           | FR-15, FR-16, FR-17, BR-10, BR-11                            |
| Cancellation      | FR-19, FR-20, BR-13, BR-14, BR-15                            |
| Role boundary     | FR-13, FR-21, Section 3 matrix (PR-01–PR-06), NFR-01, NFR-02 |
| Reminder          | FR-18, NFR-06, BR-16                                         |
| Urgent escalation | FR-08, FR-12, FR-13, BR-03, BR-04, BR-10, NFR-11             |

Platform-contract test areas added in revision 2 (platform definition of done; acceptance in AC-8 and AC-9):

| Test area            | Backing requirements                              |
| -------------------- | ------------------------------------------------- |
| AI plus fallback     | FR-23, BR-24, NFR-10                              |
| Event contract       | FR-18, FR-19, NFR-06, NFR-17, BR-25, K-18–K-20    |
| Identity adapter     | FR-03, BR-26, NFR-14                              |
| Platform conventions | NFR-18, NFR-19, NFR-20, NFR-21                    |

---

## 6. Non-Functional Requirements

Each NFR carries its verification method; an NFR without a check is a wish.

- **NFR-01 — Enforcement independent of the client, default deny.** Every read/write of a Request or Appointment is authorized in service logic against the caller's identity and role; hiding UI is never the control; anything not granted in the role matrix is denied. _Verify:_ role-boundary tests with at least one negative case per role per unlisted capability, all failing closed.
- **NFR-02 — Non-enumeration of records.** A denied access to someone else's record is indistinguishable in response content from a nonexistent record; denials carry no record fragment. _Verify:_ privacy test compares both denial responses for equality.
- **NFR-03 — Data minimization.** The user record holds only an identity reference plus contact/access claims; the Request holds only the FR-05 fields plus system status and timestamps; any new field requires a recorded privacy re-review. _Verify:_ record-inspection tests assert both allowlists.
- **NFR-04 — Analytics prohibition.** No analytics events of any kind at MVP; shipping no analytics is the mandated compliance posture (C-09). The platform PRD's expectation that material events reach Data & Analytics "with privacy minimisation" is unresolved — see OD-1 (Section 16); until it is decided in writing, zero stands. _Verify:_ privacy test asserts zero analytics-bound emissions.
- **NFR-05 — Audit completeness, content-freedom, in-app immutability.** 100% of request-content views produce exactly one content-free audit event; no app role can read, edit, or delete audit events; honestly scoped as demo-grade. _Verify:_ open a request N times, assert exactly N content-free events; negative tests per role.
- **NFR-06 — Outbound payload allowlist.** Every Notification Hub event's `data` block is validated against a fixed per-type allowlist before it is enqueued — `appointment.reminder`: date/time, generic text, opaque reference; `appointment.cancelled`: opaque reference only — and anything more is rejected before publication. The envelope fields around `data` are fixed by the platform contract (NFR-17); `type` and `source` are constants that name no service, practitioner, or reason. _Verify:_ reminder test inspects the payload; a deliberately over-full payload is blocked. _(Assumption: the generic wording is actually non-revealing; validate with peers.)_
- **NFR-07 — No sensitive content in logs, addresses, or errors.** Descriptions, free text, and triage levels never appear in logs, error messages, or page addresses/links. _Verify:_ submit a sentinel string; assert it appears nowhere outside the request views.
- **NFR-08 — Transport and session hygiene.** All traffic encrypted in transit with no fallback; sessions expire on inactivity; after sign-out, back-navigation reveals no request content. _(Assumption: exact period set in sprint zero pending instructor sign-off.)_ _Verify:_ configuration check plus automated signed-out-navigation test.
- **NFR-09 — Demo data only, disposable.** Seeded demo data for the life of the project; full dataset destroyable on demand; cancelled-appointment request content never resurfaces. _Verify:_ demonstrated reset procedure; post-cancellation content test.
- **NFR-10 — Request content never reaches AI.** With the FR-22 switch off (default), no request content crosses to any AI component. The FR-23 helper is the only AI-bound egress in the product, and it carries only the text typed into the helper box — never request fields, identity or session data, triage levels, or cookies. _Verify:_ submit a request with every flag combination; assert zero AI-bound calls from the request path, and assert the helper's outbound AI call contains the typed text and the seeded catalogue only.
- **NFR-11 — Crisis-path resilience and prominence.** Emergency contacts reachable within one interaction from every screen, visible on the request screen without scrolling, rendering even when data fails to load — independent of feature switches, sign-in state, or integration failures. _Verify:_ urgent-escalation test plus a degraded-mode check with data access disabled.
- **NFR-12 — Usability for hesitant first-timers.** Plain language throughout; urgent-path messaging and the FR-04 privacy notice are peer-tested, passing when testers correctly answer "who can see my request" and the emergency signposting redirects rather than becoming banner-blindness. _(Assumption: the disclaimer works; test it specifically.)_ _Verify:_ documented peer test with recorded results.
- **NFR-13 — Mandated test coverage.** Automated tests cover all seven mandated areas and run green on seeded demo data before the demo; the seven areas are the quality bar, not the floor of an exhaustive suite. _Verify:_ the suite itself, mapped per the Section 5 traceability table.
- **NFR-14 — Integration isolation.** Identity, Notification Hub, Security & Compliance, and the LLM are consumed only through defined contracts behind adapters, each with a contract mock; the full journey and all tests run with zero external dependencies in mock mode. Switching Identity and the Notification Hub from mock to real in the connected slice is configuration only — no code change (BR-26, NFR-17). _Verify:_ full suite passes with every boundary mocked; the connected-slice smoke run passes with Identity and the Hub real.
- **NFR-15 — Demo-scale performance and availability.** Every interactive screen responds within 2 seconds under demo load (up to 30 concurrent users on seeded data); zero failed operations across one scripted run of the core journey plus the urgent-escalation edge case at rehearsal; no uptime SLA or failover. The FR-23 helper is the one exemption: its AI call times out at 3 seconds and falls back, so a helper result always appears within about 4 seconds. _(Assumption: the 2-second threshold, 30-user figure, and helper timeout are team choices; no load figures exist in the sources.)_ _Verify:_ timed checks and the scripted zero-failure rehearsal run.
- **NFR-16 — Zero-cost operability.** Deployable and demonstrable entirely within free service tiers at 0 THB (C-04). _Verify:_ deployment walkthrough confirming no paid component.
- **NFR-17 — Platform event contract.** Every outbound event uses the platform envelope exactly — `eventId` (UUID, stable across retries so consumers can de-duplicate), `type`, `occurredAt` (ISO-8601), `source` (`wellbeing`), `subject`, `data` — and is delivered as an HTTPS webhook signed over the raw body, authenticated with a scoped machine credential, carrying the correlation ID as a header. Failed deliveries retry with exponential backoff up to a capped number of attempts, then park as failed without affecting the appointment. Events are written to a transactional outbox in the same transaction as the state change that causes them (K-18, K-19). Team 16 consumes no inbound events at MVP; if one is ever added, its handler must be idempotent on `eventId`. _(Assumption: the signing scheme — HMAC-SHA256 with a shared secret and a timestamp header — and the retry schedule are placeholders until agreed with Teams 20 and 23.)_ _Verify:_ event-contract tests assert the envelope schema, a valid signature, a stable `eventId` across a forced retry, growing backoff intervals, and exactly one delivered event per appointment per type.
- **NFR-18 — Platform API conventions.** Every endpoint lives under the versioned base path `/api/v1`; the API is described by an OpenAPI 3.1 document kept in the repository and validated in CI; input is schema-validated; status codes are meaningful; every request accepts or generates a correlation ID (`X-Correlation-Id`), echoes it in a response header, and threads it through logs and outbound events. The correlation ID lives in headers only, so NFR-02's byte-identical comparison is over status and body. Contract changes go through versioned OpenAPI/event-schema pull requests agreed with affected teams before release. The API is registered in the Team 23 gateway's service catalogue; other teams and external clients reach it through the gateway, and the service still validates every token itself (defence in depth). _(Assumption: the first-party web UI may call its own same-origin route handlers directly; if Team 23 requires otherwise, the UI's API base URL becomes the gateway's — configuration only.)_ _Verify:_ OpenAPI lint plus a contract test that every implemented route appears in the document and returns a correlation ID.
- **NFR-19 — Health, rate limits, CSRF.** A public `GET /api/v1/health` returns a content-free liveness/readiness result (service up, database reachable, version) for the gateway and the runbook. State-changing routes reached with a cookie session require a same-origin `Origin` check and SameSite cookies; bearer-token calls are exempt. The gateway's rate limit is primary; locally, sign-in attempts are throttled and the unauthenticated FR-23 helper is protected by a global daily AI-call budget that falls back to the keyword matcher when exhausted — no per-visitor identifier is stored to enforce it. _Verify:_ health test with the database up and down; a cross-origin POST is rejected; exhausting the budget flips the helper to fallback.
- **NFR-20 — Accessibility of the primary flow.** The core journey screens (service finder and helper, request form including the urgency self-assessment and crisis banner, my requests, booking, cancellation) meet WCAG 2.1 AA for the basics: full keyboard operation, visible focus, labelled form controls, errors announced and tied to their fields, sufficient contrast, and no information conveyed by colour alone — urgency levels in particular. _Verify:_ automated axe checks in the Playwright run of the primary flow with zero serious or critical violations, plus one recorded keyboard-only walkthrough.
- **NFR-21 — Documentation, CI, and handover.** The repository carries a README (purpose, setup, how to run the suite and the demo), the OpenAPI 3.1 document, the event schemas, and a short runbook covering the health check, failure recovery (paused database, parked webhook deliveries, AI outage, leaked key rotation, dataset reset), and named ownership. GitHub Actions runs lint, the full automated suite, the OpenAPI validation, and the client-bundle key scan on every pull request. No student record, real or seeded-but-realistic, appears in the repository or in demo screenshots. _Verify:_ CI green on `main`; runbook walked through once at rehearsal.

---

## 7. Business Rules

### Triage and the safe-triage boundary

- **BR-01** — Exactly three urgency (triage) levels, hard-coded; the taxonomy is not configurable at MVP.
- **BR-02** — The student's fixed self-assessment is the authoritative triage level; no component — human interface or AI — may set, override, block, or downgrade it at MVP (staff re-prioritization is explicitly not an MVP behaviour — OOS-23).
- **BR-03 — Safe-triage boundary.** The product is an intake and scheduling tool, never a diagnostic, care, or crisis channel; it refuses to serve acute distress — emergency contacts foregrounded, a plain statement that the app cannot provide immediate help, all crisis handling by humans outside the app.
- **BR-04** — Every acute-flagged request has a named human owner (coordinator, or practitioner where roles merge) and must be reviewed within a documented demo-world response time — an urgent flag never sits unowned. _(Assumption: policy values unvalidated; signed off by instructor as stakeholder proxy.)_
- **BR-05** — Practitioner queue ordered by urgency level, highest first; ties broken by submission time, oldest first. _(Assumption: the tiebreak is a team decision, not sourced.)_

### Visibility and audit

- **BR-06** — Request content is visible only to the student who wrote it and the practitioner(s) of the service it was submitted to; the coordinator sees operational metadata only; no cross-service visibility and no other party sees anything.
- **BR-07** — No silent reads: every view of request content by anyone other than the student who wrote it generates an access audit event (FR-11) — a condition of the role grant, not an optional feature. The owning student's own reads are not third-party access and are not audited. The practitioner queue lists metadata only (FR-10), so content is reachable solely through the audited read and a queue load is never a silent read.

### Request lifecycle

- **BR-08** — A request holds exactly one status from a fixed, non-configurable set _(Assumption on exact labels)_; students cannot edit or withdraw after submission — a change of mind is handled by not booking or submitting a new request; staff close stale requests by moving them to Closed. The fixed lifecycle:

```
Submitted → In review → exactly one terminal status:
                          ├─ Handled    (appointment booked — BR-11)
                          ├─ Escalated  (crisis handoff outside the app)
                          └─ Closed     (staff closure of a stale request)
```

Who causes each transition: **Submitted → In review** happens automatically on the first audited practitioner read of the request's content, in the same transaction, with that practitioner as actor — never by hand, so "In review" always truthfully means "a practitioner of this service has opened it". **→ Handled** is set only by the atomic booking transaction (BR-11), and only from In review. **→ Escalated** and **→ Closed** are set by a practitioner of the service, from either Submitted or In review. Terminal statuses never revert — cancelling the appointment of a Handled request does not reopen it (BR-14). _(Assumption: the automatic In-review trigger is a team decision, not sourced.)_

### Booking and slots

- **BR-09** — One request yields at most one active appointment; one appointment links exactly one student to exactly one slot with one practitioner; no group, workshop, or recurring bookings.
- **BR-10** — Only open slots (future-dated, unbooked) are bookable, and only by the student who owns the underlying request; first confirmed booking wins; a slot never holds two appointments. The underlying request must be In review — not still Submitted, not already terminal — and must not carry the acute triage level: an acute request is resolved by human handoff, never by booking (BR-03), and this is enforced in the booking operation itself, not only by hiding the flow. _(Assumption: blocking acute-level booking server-side is a team decision; confirm with the instructor as clinical proxy.)_
- **BR-11** — Creating an appointment marks the originating request Handled.
- **BR-12** — Slots are discrete entries published manually by practitioners (or seeded); no calendar synchronization or external calendar dependency.

### Cancellation

- **BR-13** — Cancelling an appointment immediately returns its slot to the open, bookable pool; no waitlist, no automatic reallocation — the slot simply reappears.
- **BR-14** — No rescheduling flow: a time change is cancel + new request + new booking, and the new request starts empty — prior-request content is never retained for reuse or pre-filling.
- **BR-15** — Cancellation is penalty-free: no no-show penalties, booking limits, justifications, or punitive mechanics — cancelling must stay easier than silently no-showing.

### Privacy, data, and provisioning

- **BR-16** — Reminders carry metadata only: exactly one per confirmed appointment, published at a fixed lead time before its start (or immediately at booking if the start is already inside the lead time) and only while the appointment is still confirmed, with `data` containing date/time, generic wording, and an opaque reference; the recipient travels in the envelope `subject`, and that event goes only to the Notification Hub; service name/type, practitioner specialty, reason, triage level, and request content are prohibited in any channel outside the authenticated app. _(Assumption: one reminder with a fixed lead time suffices; the brief specifies no cadence.)_
- **BR-17** — Emergency/crisis contacts remain reachable at all times — on the request screen and a standalone static page — independent of feature switches, sign-in state, or integration failures.
- **BR-18** — Seeded demo data only; real student health data is prohibited for the life of the project, and the system never touches the existing clinical records system. _(Assumption deliberately planned as if confirmed.)_
- **BR-19** — Only the required contact and access claims are requested from Identity; nothing else is requested, consumed, or stored.
- **BR-20** — Anonymous (pre-login) access is limited to the service finder and emergency-contacts page; every other capability requires sign-in, and every request belongs to an authenticated student identity.
- **BR-21** — Services, practitioners, and role assignments are provisioned via seed fixtures; there is no in-app administration.
- **BR-22** — The product's lifecycle ends when an appointment occurs or is cancelled; no post-appointment records, session notes, or clinical documentation are ever created.
- **BR-23** — Any AI capability is suggest-only, off by default, carries an unmissable emergency disclaimer, never blocks or downgrades a student's self-assessment, and the core journey never depends on it (FR-22).
- **BR-24** — The service-finder helper is the product's only MVP AI capability and is confined to catalogue matching: its input is the text typed into the helper and nothing else; its output is a ranked list of seeded service identifiers, validated against the seeded set, and the screen shows only seeded descriptions — no model-written text ever reaches a student. It never assesses urgency, diagnoses, or advises; it is always shown beside the emergency contacts and a plain statement that it cannot judge urgency; typed text is never persisted, never logged, and never associated with an identity; helper logs record only mode (AI or fallback), outcome, and latency. Any AI failure, timeout, invalid output, disabled flag, or exhausted budget yields the deterministic keyword matcher, and the full service list stays browsable without the helper (FR-23). _(Assumption: the course's approved-LLM list includes a no-cost option compatible with C-04 — verify in week 1; whichever model is used, the fallback is what the demo must never lack.)_
- **BR-25** — No reminder outlives its appointment: a cancelled appointment whose reminder has not yet been published never publishes one; one whose reminder has been published triggers a content-free `appointment.cancelled` retraction carrying only the opaque reference, written in the same transaction as the cancellation. _(Assumption: the Notification Hub honours retractions; confirm in the Team 20 contract — the lead-time rule in BR-16 already removes most of the exposure if it cannot.)_
- **BR-26** — One identity adapter is the only code that verifies a credential. In the connected slice it validates Team 01 Identity access tokens (signature, issuer, audience, expiry) and yields the identity reference, the required contact claims, and coarse access claims; in development and tests it yields the same shape from fixture sessions. Identity is authoritative for who a person is and whether they are a student or staff; which staff member is a Practitioner of which service, or the Coordinator, remains seeded locally (BR-21) and is keyed by identity reference. Swapping modes is configuration, never a code change. _(Assumption: Team 01 issues verifiable JWTs with a published key set and a stable subject identifier; confirm in the week 3–4 contract freeze.)_

---

## 8. Data Model

Nine entities: the four named in the brief — Service, Request, Appointment, TriageLevel (C-08) — plus the five minimal supplements the journey, the mandated tests, and the platform event contract demand: Slot (FR-14–FR-17, BR-12), User (FR-03, BR-20), RequestStatusChange (FR-12), AuditEvent (FR-11, BR-07), and OutboundEvent (NFR-17, K-18). No further entity is justified by any requirement. All permissions enforcement lives in service logic (NFR-01, K-16); the schema supports but never replaces it.

### User

Any authenticated person; the unauthenticated Visitor is never stored (BR-20). Deliberately minimal (NFR-03): `identity_ref` (opaque, unique — K-15), `contact_claims` (required claims only, BR-19), `role` (exactly one of Student/Practitioner/Coordinator), and `service_ref` for practitioners only _(Assumption: one service per practitioner)_. A Student owns Requests and Appointments; a Practitioner owns Slots within one Service. Created by the system on first authentication; staff records and roles via seed fixtures only (BR-21); no in-app read, update, or delete for any role — whole-dataset destruction is the only deletion (NFR-09).

### Service

Seeded catalogue entry shown in the service finder (FR-01): `name`, a plain-language `description` answering the three FR-01 questions, and seeded `keywords` — public catalogue vocabulary used by the FR-23 helper's deterministic fallback (and given to the LLM as the catalogue to rank); it describes services, never people. Has many Requests and many Practitioners. Seed-fixture CRUD only (BR-21, OOS-17); readable by everyone including Visitors (FR-02, BR-20).

### TriageLevel

Sealed reference set of exactly three hard-coded urgency levels (BR-01): `label` and `rank`. The highest rank _is_ the acute level driving FR-08 and FR-13 acute-first ordering — no separate acute flag is stored, it is derived from rank. Every Request references exactly one level. No create/update/delete for anyone (seeded, non-configurable); readable by all authenticated roles.

### Request

The private intake record and the system's privacy centre of gravity. Fields are a tested allowlist (NFR-03): `student_ref`, `service_ref`, `structured_description` (content), optional `free_text` (content), `preferred_times` (content — outside the FR-13 metadata allowlist), `triage_level_ref` (mandatory, authoritative — BR-02), `status` (fixed BR-08 set), `submitted_at`, and `submission_key` (system-assigned one-time token making submission idempotent — K-17; operational metadata, never surfaced). Belongs to one Student, Service, and TriageLevel; has at most one active Appointment (BR-09), many RequestStatusChanges and AuditEvents. Created by the Student (own only, always empty — FR-20); content readable by owner and service practitioners only (every practitioner view audited — BR-07), metadata by the Coordinator; status updated only by a service practitioner through the fixed lifecycle (or set Handled atomically on booking); content editable by no role ever (PR-04, K-11); deletable by no role (NFR-09).

### RequestStatusChange

Minimal append-only record existing solely because FR-12 requires recording who made _each_ change: `request_ref`, `new_status`, `actor_ref`, `changed_at` — never any content. Belongs to one Request and one User (actor). Created by the system only, in the same transaction as every status transition (K-12); no role reads, updates, or deletes rows — the service logic derives only a request's last-status-change timestamp from the latest row to feed the metadata views.

### Slot

Discrete availability entry, manually published or seeded — no calendar sync (BR-12, OOS-05): `practitioner_ref` and `start_at` only. Openness is **derived**, never stored: open iff future-dated and holding no active appointment (K-3). No end time/duration is stored — nothing requires one (C-05). Belongs to one Practitioner; holds at most one active Appointment (BR-10). Created by the owning practitioner or fixtures (FR-14); students read only the open slots of the service handling their own request (FR-15); no updates (OOS-06); deleted by the owner only while unbooked, checked atomically, with any cancelled appointment rows removed in the same transaction (K-7).

### Appointment

The confirmed booking linking one student, one slot, one originating request (FR-16, BR-09): `request_ref`, `slot_ref`, `student_ref` (each exactly one, never null), `status` (confirmed/cancelled — cancellation is a status change, not a deletion), and set-once `reminder_published_at` enforcing exactly one metadata-only reminder (BR-16, K-14) — set in the same transaction that writes the reminder's OutboundEvent row, and consulted by cancellation to decide whether a retraction is owed (BR-25). Date/time is not stored — it reads through the slot (no divergence possible); the appointment's own identifier serves as the FR-18 opaque reference _(Assumption: identifiers must be random and non-derivable; otherwise a separate token is needed — resolve in design)_. Created by the Student only, in one atomic booking transaction that also marks the request Handled (K-4); read own-only by the Student; cancellation is the only update — Student, own upcoming appointment, single confirmation (FR-19), atomically reopening the slot (K-5); no role deletes (the K-7 cascade on slot removal is the sole system-side exception).

### AuditEvent

Append-only, content-free access record for every view of request content by anyone other than its owning student (BR-07), emitted to the Security & Compliance boundary — contract mock at MVP — in the platform envelope (FR-11): exactly `viewer_ref`, `viewer_role`, `request_ref`, `viewed_at` — never content or triage level (NFR-05). Belongs to one Request and one User (viewer). Created by the system only, exactly one per content view, coupled to the read itself (K-13); no application role can read, update, or delete — events flow outward only (PR-05). _(Assumption: the stub retains events append-only so the "N views → exactly N events" test is verifiable.)_

### OutboundEvent

The transactional outbox that makes the platform's signed-webhook contract honest (NFR-17): without it, an event could be lost after its state change commits, retries could not back off, and `eventId` could not stay stable across attempts. Fields: `event_id` (UUID — the envelope `eventId`), `type` (`appointment.reminder` or `appointment.cancelled`), `reference` (the opaque appointment reference — deliberately **not** a foreign key, K-20), `subject` (the recipient's identity reference) and `payload` (the allowlisted `data` block) — both held only until delivery, then nulled (K-19) — plus delivery state: `attempts`, `next_attempt_at`, `delivered_at`, `failed_at`. Never contains content, service, practitioner, or triage level. Created by the system only, inside the transaction of the state change that causes it (K-18); updated only by the dispatcher; readable by no application role; destroyed with the dataset (NFR-09). Justified under C-08's escape clause by the platform event contract (C-12) and the Event-contract test area.

### Key constraints (K-1–K-17)

"Active appointment" means status = confirmed. Each constraint maps to the failure it prevents:

| #    | Constraint (compact)                                                                                                                                                            | Failure prevented                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| K-1  | At most one active appointment per slot (conditional uniqueness on confirmed status)                                                                                            | Double-booked slot; the losing concurrent insert fails at the storage layer (FR-17, BR-10, BR-13)                                       |
| K-2  | At most one active appointment per request                                                                                                                                      | Two appointments from one request; retry storms (BR-09)                                                                                 |
| K-3  | Slot openness derived, never stored (open = future-dated AND no active appointment)                                                                                             | Flag-vs-reality drift after cancellation (BR-10, BR-13, FR-19)                                                                          |
| K-4  | Atomic booking transaction: re-check openness on server clock, run K-8 checks, insert appointment, set Handled, write status-change row — all or none                           | Handled-with-no-appointment; appointment-with-unhandled-request; two concurrent "winners" (FR-16, FR-17, BR-11, FR-12)                  |
| K-5  | Atomic cancellation: single transactional status write; openness follows via K-3                                                                                                | Half-cancelled state — student sees cancelled but slot stays blocked (FR-19, BR-13)                                                     |
| K-6  | Mandatory foreign keys on every link across the eight relational entities (OutboundEvent is deliberately FK-free — K-20)                                                        | Orphaned records; requests referencing nonexistent services; triage levels outside the seeded three (FR-05, FR-11, FR-12, FR-16, BR-01) |
| K-7  | Restricted deletion of referenced rows; slot removable only while unbooked (checked atomically), cancelled appointment rows deleted in the same transaction                     | Re-seed corruption; slot deleted under a booking; dangling appointment references (FR-14, BR-21, NFR-09)                                |
| K-8  | Booking consistency checks inside K-4: appointment.student = request.student; slot's practitioner's service = request's service; request status = In review; request triage level is not the acute rank | Booking someone else's request; booking a slot from the wrong service; booking before review or after a terminal status; booking around the acute handoff (PR-01, FR-15, FR-17, BR-03, BR-10) |
| K-9  | Timezone-unambiguous instants; "future-dated" evaluated on the server clock, never client time                                                                                  | Past slots bookable via clock skew (BR-10, FR-17)                                                                                       |
| K-10 | Value checks and fixed lifecycle: five BR-08 statuses, two appointment statuses, exactly three TriageLevel rows, mandatory request fields; transition legality in service logic | Unknown states in queues; resurrection of Closed requests (BR-08, BR-01, FR-05, FR-06, FR-12)                                           |
| K-11 | Content immutability: no update path for description, free text, preferred times, triage level, service, or owner — status is the only mutable request data                     | Post-submission edits by any role; triage overrides or downgrades (PR-04, FR-12, BR-02)                                                 |
| K-12 | Append-only status history, written in the same transaction as each transition                                                                                                  | Status changes with no recorded author; retroactive history editing; status/history divergence (FR-12)                                  |
| K-13 | Audit write coupled to the content read: one insert per non-owner view, same unit of work, insert-only, no in-app access; the first such read also performs Submitted → In review with its K-12 row in that same unit of work | Silent reads; double-counted views; in-app audit tampering; an "In review" status nobody actually triggered (FR-11, FR-12, BR-07, BR-08, NFR-05, PR-05) |
| K-14 | At most one reminder per appointment (set-once marker), enqueued at the lead time only while the appointment is confirmed; `data` built from the slot and validated against the per-type allowlist before enqueue | Duplicate reminders; reminders for cancelled appointments; revealing fields reaching a lock screen (BR-16, BR-25, NFR-06, FR-18) |
| K-15 | Uniqueness on `User.identity_ref`                                                                                                                                               | Two user rows for one Identity subject after a first-login race (FR-03)                                                                 |
| K-16 | Default deny above the schema: every operation authorized in service logic per the role matrix; denials content-free and byte-indistinguishable from not-found                  | Capability leaks the schema alone cannot stop; record enumeration (NFR-01, NFR-02, FR-21, PR-06)                                        |
| K-17 | Idempotent request creation: uniqueness on `submission_key`; a retried submission returns the existing request, a fresh form is unrestricted                                    | Accidental double-click/retry creating two records, without blocking BR-08's legitimate multiple requests (FR-05, BR-08)                |
| K-18 | Transactional outbox: the OutboundEvent row is inserted in the same transaction as its cause — the reminder marker being set, or the cancellation of an already-reminded appointment; uniqueness on (`reference`, `type`) | An event lost after its state change commits; an event sent for a change that rolled back; duplicate reminders or retractions (NFR-17, BR-25, FR-18, FR-19) |
| K-19 | Delivery state on the outbox row: `event_id` fixed at insert and reused on every attempt; `next_attempt_at` grows exponentially; attempts capped, then the row parks as failed; on delivery, `subject` and `payload` are nulled | Retry storms; consumers unable to de-duplicate; a recipient-plus-appointment-time pair lingering after it has served its purpose (NFR-17, NFR-03) |
| K-20 | Outbox rows hold the opaque reference by value, never by foreign key; a cancellation's retraction is written (K-18) before any K-7 cascade can remove the cancelled appointment row | The Hub holding a live reminder for an appointment whose row was deleted with its slot; an outbox FK blocking legitimate slot removal (FR-14, K-7, BR-25) |

Deliberately not constrained (C-05 over-design guard): no per-student request uniqueness, no slot-overlap rule or slot duration _(team decisions; sources say only "discrete slots")_, no waitlists (OOS-11), no configurable status/triage tables, no soft-delete machinery.

### Sensitive-data classification

Most sensitive first: **(1) Request content** (`structured_description`, `free_text`, `preferred_times`) — a stigmatized health disclosure tied to a named identity, readable by exactly the owning student and the service's practitioners with every practitioner view audited, and banned from coordinator views, logs, errors, page addresses, reminders, analytics, and AI (BR-06, FR-13, NFR-04, NFR-07, NFR-10). **(2) Triage level and the student↔service linkage** — reveal possible crisis state and that a named student contacted counselling; in-app per the role matrix only, never in any outbound channel — the opaque reminder reference exists precisely so this linkage never leaves the app (BR-16, FR-18). The one deliberate outbound exposure is the reminder envelope's `subject` plus appointment time, sent only to the Notification Hub over a signed HTTPS call: it reveals that a student has _an_ appointment with the campus health-and-wellbeing booking service — which spans vaccinations to counselling — and nothing about which; the outbox copy is nulled on delivery (K-19). Text typed into the FR-23 helper is treated as this class too, which is why it is never stored, logged, or tied to an identity (BR-24). **(3) Record existence itself, identity claims, and staff identities in audit/history rows** — denials must be byte-indistinguishable from non-existence (NFR-02, K-16); nothing beyond required claims is stored (NFR-03). Retention for everything: demo lifetime only, destroyable on demand (NFR-09); any new field triggers a recorded privacy re-review (NFR-03).

---

## 9. Architecture

### Architecture Overview

This section describes the chosen architecture only — **Option A, Vercel + Supabase** (decision recorded in Section 10). The full three-option comparison (Cloudflare Workers + D1, Firebase) and the reasoning behind the recommendation live in `outputs/04_architecture.md`.

The shape in one paragraph: a Next.js frontend on Vercel whose browser code holds no table-capable database credential; a single server-side data path — Next.js Route Handlers — where the entire Section 3 permission matrix executes as default-deny on every operation (FR-21, NFR-01, K-16); and a Supabase Postgres database whose storage-layer features make the hardest invariants platform-native (double-booking prevention K-1/K-2, atomic booking K-4, audit-on-read K-13, append-only history K-12). Deny-all RLS acts as a backstop against client-SDK bypass (see Components → Database). Every external boundary — Identity, Notification Hub, Security & Compliance, and the LLM — sits behind an adapter with a contract mock (C-07, NFR-14), so the full journey and every test area run with zero external dependencies; in the connected slice, configuration alone switches Identity to real Team 01 tokens (BR-26) and the Notification Hub to Team 20's real webhook endpoint (NFR-17).

### Architecture Diagram

```
[Browser: Next.js pages / React]
   |  static crisis + service-finder pages from CDN (FR-01, FR-02, NFR-11 —
   |  render with zero data dependency); holds NO table-capable DB credential
   v
[Vercel: Next.js Route Handlers — the ONLY data path]
   |  resolves caller via the identity adapter server-side, derives single role,
   |  default-deny per Section 3 matrix (FR-21, NFR-01, K-16);
   |  identical 404s for denied/absent (NFR-02);
   |  coordinator DTO omits content columns (FR-13);
   |  all routes under /api/v1, correlation ID on every call, /health (NFR-18/19);
   |  boundary adapters, each with a contract mock (C-07, NFR-14):
   |    identity adapter ......... Team 01 tokens | fixture sessions (BR-26)
   |    webhook dispatcher ....... outbox -> signed envelope, retry/backoff (NFR-17)
   |    S&C audit sink ........... envelope-shaped, mock at MVP (FR-11)
   |    finder helper ............ approved LLM | keyword fallback (FR-23)
   v                                                     |
[Supabase Auth]                    [Supabase Postgres]   +--> [Notification Hub, Team 20]
   fixture mode of the identity       ap-southeast-1;          signed HTTPS webhook:
   adapter (FR-03, BR-19):            9 tables; partial        subject = recipient,
   sessions, fixture users            unique indexes           data = 3-field allowlist
                                      (K-1/K-2); plpgsql       (FR-18, NFR-06)
[Campus Identity, Team 01]            atomic booking fn     +--> [Approved LLM]
   real mode: verifiable access       (K-4/K-8/K-9) and         helper text + seeded
   tokens -> identity ref +           audit+read fn (K-13);      catalogue only (NFR-10)
   required claims only               FKs/CHECKs (K-6/K-10);
                                      append-only triggers (K-12); outbox (K-18–K-20);
                                      RLS enabled, ZERO policies = deny-all
                                      backstop against client-SDK bypass
```

### Components

#### Frontend

**Browser (Next.js pages / React).** Renders the five screens: public service finder and static emergency-contacts page (FR-01, FR-02, BR-20), the request form with the always-visible crisis banner (FR-05–FR-08), the student "my requests" view (FR-09), the practitioner queue/schedule (FR-10, FR-14), and the coordinator metadata view (FR-13). Emergency contacts are hard-coded static content served from Vercel's CDN with no data fetch, so the crisis path renders even if every API route is down (NFR-11, BR-17) — this is the canonical statement of the crisis-path guarantee; other sections reference it by ID. The browser holds no table-capable database credential; the Supabase JS client, if present at all, is used for auth/session only. The service finder also hosts the optional "help me choose" helper (FR-23): a small client component that posts the typed text to one server route and renders the returned seeded services — it sits beside the static emergency contacts and the full service list, neither of which depends on it, and it keeps nothing in browser storage. The primary-flow screens are built to the NFR-20 accessibility bar. All frontend permission checks are cosmetic — FR-21 lives entirely server-side. Data moving through this layer: static pages inbound; form submissions and opaque record IDs outbound in POST bodies, never in URLs (NFR-07).

#### Backend

**Vercel Route Handlers (the only data path).** Next.js Route Handlers deployed as serverless functions (region `sin1` alongside the database — _(Assumption: region selection available on Hobby; verify week 1)_). This is where the entire Section 3 permission matrix executes: every handler resolves the caller through the identity adapter server-side (BR-26), derives the caller's single role, and applies default-deny before touching data (FR-21, NFR-01, K-16), using the service-role key held only in server env vars. One shared wrapper gives every route the platform conventions — `/api/v1` base path, correlation ID in and out, schema validation, the same-origin check on cookie-authenticated writes (NFR-18, NFR-19) — so no handler implements them by hand. Because every read and write funnels through this layer, denials are shaped byte-identical to not-found (NFR-02), the coordinator response is a metadata-only DTO that never names content columns (FR-13), and the sole content-read path couples the audit write to the read in one transaction (audit-on-read, Section 12). Data moving through: session tokens in, role-filtered DTOs out; request content passes through only on the student-create and audited practitioner-read paths.

#### Database

**Supabase Postgres (`ap-southeast-1`).** The 9-entity model (Section 8) maps to 9 tables, TriageLevel among them as three seeded rows. The hard invariants are storage-layer features, not application code: partial unique indexes make double-booking impossible (K-1/K-2, FR-17, BR-10); one transactional `plpgsql` function performs the atomic booking (K-4/K-8/K-9); `UNIQUE (submission_key)` gives idempotent submission (K-17); FKs, CHECK constraints, and `ON DELETE RESTRICT` cover K-6/K-7/K-10; BEFORE UPDATE/DELETE triggers keep `request_status_change` and `audit_event` append-only (K-12/K-13) — demo-grade, not compliance-grade privilege separation, per the C-11/NFR-05 boundary. Data moving through: all persistent state, reachable exclusively via the route-handler layer.

**Deny-all RLS backstop.** RLS is enabled on every table with **zero policies** — deny-all. This is the backstop for FR-21, not its implementation: it makes the browser-exposed anon key harmless and turns the Supabase-tutorial default (client SDK + RLS as the API) into a guaranteed dead end, so a teammate's "quick feature" using `supabase.from()` in a client component returns nothing rather than bypassing authorization and auditing. The matrix itself deliberately does not live in RLS: RLS is row-level, while FR-13 needs a column split, FR-11 needs audit-on-read, and NFR-02 needs identical denial bodies — all natural in a server route, all awkward in RLS. The backstop does not guard the server path: a leaked service-role key remains the architecture's own top risk (R-2); key-hygiene mitigations are specified in Section 12.

#### Authentication

**Identity adapter (BR-26) — two modes, one interface.** _Real mode_ (connected slice): verifies Team 01 Identity access tokens — signature against the published key set, issuer, audience, expiry — and yields the identity reference plus the required contact and coarse access claims, nothing else (FR-03, BR-19). _Fixture mode_ (development, tests, and the fallback if Team 01 slips): Supabase Auth with seeded email/password fixture users and no email-verification flows, yielding exactly the same shape. The mode is a server env var; no handler knows which is active. Data moving through: credentials and tokens only; request content never touches this component. Claims minimization, role derivation, and session hygiene are specified in Section 12 (Authentication).

#### Storage

**File storage: none.** No FR in FR-01–FR-23 involves uploads; no buckets are created — an unused bucket is pure attack surface. Static assets ship with the Next.js build on Vercel's CDN.

#### External Services

Every external boundary sits behind an adapter with a contract mock (C-07, NFR-14), so the full journey and every test area run with zero external dependencies; two of them go real in the connected slice (C-12):

- **Identity (Team 01) — real in the connected slice.** See Authentication above: the identity adapter consumes only the required contact and access claims and discards everything else (FR-03, BR-19, BR-26).
- **Notification Hub (Team 20) — real in the connected slice; this is Team 16's inter-team event.** Reminder and retraction events are written to the outbox inside their causing transaction (K-18), validated against the per-type `data` allowlist (NFR-06), then delivered by the dispatcher as signed HTTPS webhooks in the platform envelope with exponential-backoff retry (NFR-17, K-19). The dispatcher is one machine-credential-protected route: it enqueues reminders that have reached their lead time and delivers pending outbox rows. It is invoked inline right after a booking or cancellation commits, by the scheduled GitHub Actions job that already keeps the database awake (Section 14), and by a demo trigger. Until Team 20's endpoint exists, the target URL is a contract mock that verifies the signature and envelope schema — over real HTTP, not in-process, so the week 3–4 "mock the consumer" milestone exercises the true delivery path.
- **Security & Compliance (Team 22) — contract mock at MVP.** A sink that receives the content-free audit events emitted by the audited-read transaction, shaped in the same platform envelope as `request.content_viewed` (FR-11, NFR-05, PR-05); no in-app role can read or modify them. Live delivery is a configuration switch onto the existing dispatcher once Team 22 publishes an endpoint — not an MVP acceptance item.
- **Approved LLM — the FR-23 helper only.** One server-side route sends the typed helper text plus the seeded catalogue (service identifiers, names, keywords) and asks for a ranked list of identifiers as structured output. The response is validated against the seeded identifiers; anything else, any error, a 3-second timeout, a disabled flag, or an exhausted daily budget returns the deterministic keyword matcher's ranking instead (BR-24). The route receives no cookies or tokens, stores nothing, and logs only mode, outcome, and latency.

The FR-22 AI urgency flag remains a server env var gating a code path that ships nothing at MVP. The FR-23 helper route is the only AI-bound egress in the product, and request content is structurally unable to reach it: the helper module imports nothing from the request path (NFR-10).

---

## 10. Technology Stack

**Decision (final): Option A — Vercel + Supabase**, recorded 2026-08-12 in `outputs/05_techstack.md` on the basis of the comparative evaluation in `outputs/04_architecture.md`. Option B (Cloudflare Workers + D1) is the designated fallback if Option A's free-tier terms change.

### 10.1 Stack selection table

Every choice is linked to the requirement or constraint it supports — "select technology using requirements, not preference."

| Layer                | Selected technology                                     | Requirement or constraint supported                                                                                                                                                                                               | Why this is feasible                                                                                                                         |
| -------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend             | Next.js (App Router) on Vercel                          | FR-01/FR-02 public service finder + static emergency page; NFR-11 crisis content renders with zero data dependency; NFR-07 no content in URLs                                                                                     | Team knows some React; best-documented tutorial path; static pages served from CDN free tier                                                 |
| Backend / API        | Next.js Route Handlers (serverless, same repo)          | FR-21/NFR-01/K-16 entire Section 3 permission matrix runs server-side, default-deny; FR-13 coordinator DTO omits content columns; NFR-02 identical 404 for denied/absent; C-05 no microservices                                   | One language, one repo, one deploy; cold starts irrelevant at NFR-15 demo scale (30 users)                                                   |
| Database             | Supabase PostgreSQL (`ap-southeast-1`, Singapore)       | FR-17/BR-10/K-1/K-2 double-booking blocked by partial unique index + one transactional function; FR-11/BR-07/K-13 audit-write coupled to content-read in one transaction; K-12 append-only triggers; K-6/K-10 FKs and CHECK rules | Real SQL makes the three hardest requirements platform-native instead of hand-written; nearest region to a Thai campus                       |
| Authentication       | Identity adapter: Team 01 access-token verification (standard JWT/JWKS library) in the connected slice; Supabase Auth fixture users in development and tests | FR-03/BR-19 only required contact + access claims consumed; BR-26 one swappable verification point; C-07/NFR-14 mockable boundary; C-12 "authenticate a real platform user"; NFR-08 session expiry | Managed sessions/hashing/refresh keep student-written security code off the critical path; token verification is a library call, not hand-rolled crypto; seeded fixture users avoid email-flow rate limits |
| Event delivery       | Postgres outbox table + one dispatcher route handler, triggered inline and by the existing scheduled GitHub Actions job | NFR-17 signed envelope, stable `eventId`, exponential backoff; K-18–K-20; FR-18/FR-19/BR-25; C-05 no queue product to operate | No new service, no new vendor, 0 THB; the platform stack lists "a webhook dispatcher" as an accepted alternative to Cloudflare Queues |
| AI (FR-23 only)      | One approved LLM behind a server-side route, plus an in-repo deterministic keyword matcher | FR-23/BR-24 AI plus deterministic fallback (platform definition of done); NFR-10 request content never reaches AI; NFR-19 daily budget | The fallback is ~50 lines with no dependency and is what the demo relies on; the model is swappable behind the adapter _(Assumption: a no-cost approved model exists — verify week 1)_ |
| File storage         | None — no buckets created                               | No FR requires uploads; C-05 over-design guard; NFR-03 data minimization                                                                                                                                                          | Storage is unused on every option; creating nothing is the cheapest correct choice                                                           |
| Hosting / deployment | Vercel Hobby + Supabase Free                            | C-04/NFR-16 0 THB, no credit card on either service; NFR-13 local dev via Supabase CLI                                                                                                                                            | Free tiers verified against official docs (August 2026); re-verify in week 1 per the NFR-16 walkthrough checklist in 05                      |

### 10.2 Why not the others

- **Option B — Cloudflare Workers + D1:** D1 has no interactive transactions, so the two most safety-critical operations (atomic booking K-4, audit-on-read K-13) become hand-built conditional-SQL batches, and with no managed auth the team writes its own session/CSRF/hashing code — the wrong code for students to own in a privacy product. Kept as fallback: the schema and route design port almost unchanged.
- **Option C — Firebase:** on the no-card Spark plan, FR-11 audit-on-read is unenforceable (rules cannot couple a write to a read) — disqualifying for a privacy-demonstration product; fixing it needs Cloud Functions on Blaze, putting a student's personal credit card on file against the spirit of C-04.

The five risks accepted with this decision and their mandatory mitigations are recorded as R-1–R-5 in Section 16; the free-tier facts feeding NFR-16 are re-verified in week 1 (Section 14).

---

## 11. API / Interfaces

The brief mandates seven REST endpoints. They are implemented as Next.js Route Handlers (Section 9); every one resolves the session server-side, derives the single role, and applies the Section 3 matrix default-deny (FR-21, NFR-01, K-16). Platform conventions (NFR-18, NFR-19): every path below is relative to the versioned base path **`/api/v1`**; the whole API is described in an OpenAPI 3.1 document in the repository (11.6); every request accepts or generates an `X-Correlation-Id` and echoes it in a response header; user-facing calls carry an Identity access token or the session derived from one (BR-26), and the one machine-to-machine route uses a scoped machine credential. Conventions across all endpoints: opaque IDs in paths, content only in POST/PATCH bodies (NFR-07); every denial of a record that exists but is not visible to the caller returns a response byte-identical to genuine not-found — same status, same body (NFR-02); no error message ever carries a fragment of record content (FR-21).

### 11.1 The seven mandated endpoints

| Endpoint                         | Purpose                                                                                                                                 | FR(s) served                       | Auth / role required                                                        | Key error responses                                                                                                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /services`                  | List seeded services with plain-language descriptions for the service finder                                                            | FR-01, FR-02 (BR-20)               | None — Visitor allowed; the only pre-login API call                         | —                                                                                                                                                                                                          |
| `POST /requests`                 | Submit a private request (service, structured description, staff-readable free text, preferred times, mandatory self-assessed urgency)  | FR-05, FR-06, FR-08, FR-20         | Student (own identity only)                                                 | 400 if the fixed self-assessment is missing (FR-06) or any field outside the FR-05 allowlist is present (NFR-03); duplicate `submission_key` is **not** an error — see 11.3                                |
| `GET /requests/me`               | Student's own requests with current status                                                                                              | FR-09                              | Student (own only)                                                          | — (returns only the caller's rows; nothing to enumerate)                                                                                                                                                   |
| `PATCH /requests/{id}`           | Move a request through the fixed BR-08 status lifecycle (including Escalated, Closed), recording who changed it                         | FR-12                              | Practitioner (own service only)                                             | Identical 404 for other-service or absent request (NFR-02); 400/409 for an invalid lifecycle transition (BR-08); any content field in the payload rejected — content is never editable by any role (PR-04) |
| `GET /practitioners/{id}/slots`  | Open (future, unbooked — K-3 derived, never stored) slots of a practitioner                                                             | FR-15 (data published per FR-14)   | Student, for the service handling their request once it is In review; Practitioner, own schedule | Identical 404 when the practitioner is outside the caller's permitted view — including a student with no In-review request for that service (NFR-02)                                  |
| `POST /appointments`             | Book exactly one open slot against the caller's own request; atomically creates the confirmed appointment and marks the request Handled | FR-16, FR-17 (BR-09, BR-10, BR-11) | Student (own request + one open slot only)                                  | **409 slot-taken**: the loser of a concurrent race gets a clear rejection plus refreshed availability (FR-17, K-1/K-4); identical 404 for a request or slot outside the caller's view (NFR-02); **409 request-not-bookable** when the caller's own request is not In review or carries the acute level — a fixed, content-free reason code (FR-17, BR-10, K-8) |
| `POST /appointments/{id}/cancel` | Cancel the caller's own upcoming appointment in a single confirmation action, no justification required                                 | FR-19 (BR-13, BR-15)               | Student (own only)                                                          | Identical 404 for not-own or absent appointment (NFR-02)                                                                                                                                                   |

### 11.2 Cancel is a state change, not a delete

`POST /appointments/{id}/cancel` is deliberately an action endpoint rather than a `DELETE`: cancellation is one atomic status transition (K-5) — the appointment record persists in a cancelled state and its slot immediately returns to the open, bookable pool (BR-13). In that same transaction, if the appointment's reminder has already been published, an `appointment.cancelled` retraction is written to the outbox (BR-25, K-18); if not, the reminder never publishes (K-14). There is no waitlist, no reallocation, and no penalty mechanics (BR-15); a time change is cancel + new empty request + new booking (BR-14, FR-20). Post-cancellation, the originating request's content is never surfaced anywhere again (NFR-09).

### 11.3 Idempotent submission key

`POST /requests` carries a client-generated `submission_key`; the database enforces `UNIQUE (submission_key)` with ON CONFLICT read-back (K-17). A retried or double-clicked submission therefore returns the already-created request instead of creating a duplicate or an error — submission is safe to retry.

### 11.4 Routes beyond the brief's seven

The mandated screens require a small number of additional server routes, built under the same conventions and permission matrix (C-08 names the screens; paths are team-defined at design time per C-10): the practitioner triage-ordered queue, metadata only (FR-10); the audited request-content read — the **only** code path returning content to anyone but its owner, and the trigger of Submitted → In review (audit-on-read transaction, Section 12); the coordinator metadata-only view (FR-13, PR-03); and practitioner slot publish/remove, removal only while unbooked (FR-14). Revision 2 adds three: `GET /health` — public, content-free liveness/readiness (NFR-19); `POST /finder/suggest` — public, body carries the typed helper text, response is a ranked list of seeded service identifiers plus which mode answered; nothing stored or logged (FR-23, BR-24); and `POST /internal/events/dispatch` — scoped machine credential only; enqueues due reminders and delivers pending outbox rows (NFR-17). No endpoint exists for audit-event access (PR-05), outbox access, or either AI flag (deployment-time settings only, FR-22, FR-23).

### 11.5 Outbound event contract (Team 16 → Notification Hub)

Team 16's inter-team event. Delivered as a signed HTTPS POST in the platform envelope; `eventId` is stable across retries; the correlation ID travels as a header. Reminder:

```json
{
  "eventId": "6f1c2a9e-7b1d-4c55-9a53-0d2f8e4b7a10",
  "type": "appointment.reminder",
  "occurredAt": "2026-10-05T02:00:00Z",
  "source": "wellbeing",
  "subject": "student:<identity reference>",
  "data": {
    "appointmentAt": "2026-10-06T02:00:00Z",
    "message": "You have an appointment.",
    "reference": "<opaque appointment reference>"
  }
}
```

Retraction, sent only when a reminder was already published for an appointment that is then cancelled (BR-25):

```json
{
  "eventId": "b3e0d6c4-2f7a-4e91-8c1d-5a9f3b2e6d47",
  "type": "appointment.cancelled",
  "occurredAt": "2026-10-05T09:30:00Z",
  "source": "wellbeing",
  "subject": "student:<identity reference>",
  "data": { "reference": "<opaque appointment reference>" }
}
```

Contract terms to agree with Team 20 at the week 3–4 freeze: the Hub addresses the student from `subject` and renders `data.message` verbatim — it must not add the `source`, a service name, or any wording of its own to what reaches a lock screen; it de-duplicates on `eventId`; it drops a pending or delivered reminder on a retraction with the same `reference`; it retains `subject` no longer than delivery needs. `source` and `type` are constants and reveal only that the student uses the campus health-and-wellbeing booking service, never which service (Section 8 classification). _(Assumption: all four terms are unconfirmed until Team 20 signs the contract; changes go through a versioned event-schema pull request — NFR-18.)_

### 11.6 OpenAPI document

`openapi.yaml` (OpenAPI 3.1) in the repository root describes every route in 11.1 and 11.4 — schemas, auth requirements, the fixed error shapes (the single 404 body, `409 slot-taken`, `409 request-not-bookable`), and the correlation-ID header — and the two event schemas in 11.5 live beside it. CI lints the document and fails if an implemented route is missing from it (NFR-18, NFR-21). This file is what Team 23 registers in the gateway's service catalogue.

---

## 12. Security

The deliverable of this product _is_ the privacy demonstration (C-11). Structurally: the browser holds no table-capable database credential; every data operation flows through Next.js Route Handlers — the only data path — backed by Postgres with deny-all RLS (Section 9).

### Authentication

- **One identity adapter, two modes** (FR-03, BR-26, C-07, NFR-14). _Real mode_ — the connected slice — verifies Team 01 Identity access tokens (signature against the published key set, issuer, audience, expiry) with a standard library; this is what satisfies the platform's "authenticate a real platform user". _Fixture mode_ — development, tests, and the fallback if Team 01 slips — uses Supabase Auth with 6–10 seeded email/password fixture users (students, practitioners per service, one coordinator) per BR-21: no self-registration, no email-verification flows, Free-tier email rate limits never touched. Both modes yield the same shape, and no other module inspects a credential. The mode switch is a server env var and cannot be influenced by a request.
- **Claims minimization** (FR-03, BR-19, NFR-03): the app's `User` table stores only `identity_ref` (unique, K-15), the required contact claims, `role`, and practitioner `service_ref`. Any other attribute offered is discarded, not persisted. Honest boundary: Supabase's internal `auth` schema retains standard auth metadata beyond this allowlist — acceptable only under the demo-data-only rule (BR-18, NFR-09) and disclosed in the FR-04 privacy write-up rather than papered over.
- **Role derivation is server-side, per request**: exactly one role per session (Student / Practitioner / Coordinator), resolved in the route handler from the adapter's verified identity reference and coarse access claims, joined to the seeded `User` row — Identity says who the person is and whether they are student or staff; the seed says which staff member is a Practitioner of which service or the Coordinator (BR-21, BR-26) — never trusted from the client (Section 3, PR-01). A verified staff identity with no seeded row gets no role and is denied everything beyond the Visitor surface. The unauthenticated Visitor is never stored; pre-login access is the service finder and emergency-contacts page only (FR-02, BR-20).
- **Session hygiene (NFR-08)**: HTTPS is default on both platforms with no unencrypted fallback. Inactivity expiry: _(Assumption: configurable inactivity timeout has historically been Pro-only on Supabase Free; the demo-grade fallback is a short JWT access-token lifetime, e.g. 15–30 min, plus refresh discipline — prototype in week 1.)_ Signed-out back-navigation must reveal no content: content pages set `cache: 'no-store'`, verified by the automated NFR-08 test.
- **CSRF, rate limits, machine credentials (NFR-19)**: session cookies are `HttpOnly`, `Secure`, `SameSite=Lax`, and every state-changing route reached with a cookie session rejects requests whose `Origin` is not the app's own; bearer-token calls carry no ambient credential and are exempt. Sign-in attempts are throttled; the gateway's rate limit is primary for everything else. The dispatcher route accepts only a scoped machine credential held in server env vars and the scheduler's secrets — it is not reachable with any user session. Credentials and private profile fields never appear in query strings.

### Authorization

- **The entire Section 3 permission matrix runs server-side in route handlers** on every operation: resolve session, derive role, apply default deny (FR-21, NFR-01, K-16). Hiding interface elements is never the control. Ownership ("own") is checked in service logic against identity claims on every call (PR-01); the coordinator is strictly metadata-scoped and read-only (PR-03); no role can edit request content after submission — there is deliberately no super-reader (PR-04); no role touches audit events in-app (PR-05); every matrix denial is exercised by at least one negative test per row (PR-06, NFR-13).
- **Deny-all RLS backstop**: RLS enabled on every table with zero policies, making the browser-exposed anon key harmless and the client-SDK path a dead end; full rationale — and why the matrix stays in server code rather than RLS — in Section 9 (Components → Database).
- **Non-enumeration (NFR-02)**: a denied record that exists and a record that does not exist return byte-identical 404 responses, shaped in the team's own handlers; denials carry no fragment of any resource (K-16).
- **Service-role key hygiene**: the key lives only in Vercel server env vars — never under a `NEXT_PUBLIC_` prefix; modules touching it import `server-only`; PR review rule: no `supabase.from()` in client components; an automated scan of the built client bundle for the key is wired into the role-boundary suite (PR-06, NFR-13). A leaked key is a total collapse of the matrix — treated as a top risk (Section 16, R-2).

### Data Protection

- **Audit-on-read transaction (FR-11, BR-07, K-13)**: the request-content handler is the only code path that returns content, and it performs the AuditEvent insert and the content SELECT in one Postgres transaction (a single `plpgsql` function) — a failed audit write aborts the read, so no silent reads exist. Events carry the FR-11 quadruple only (viewer, role, request id, timestamp — never content), are append-only via triggers (K-12/K-13), flow outward to the stubbed Security & Compliance boundary, and are readable by no in-app role (NFR-05, PR-05). Honestly scoped as demo-grade, not compliance-grade: the service-role connection could drop the trigger; documented as the NFR-05/C-11 boundary.
- **Content/metadata split (FR-13, PR-03)**: the coordinator endpoint returns a metadata-only DTO (id, service, triage level, status, timestamps); its SELECT never names content columns. `preferred_times` is content, not metadata, and follows content visibility (BR-06).
- **Data minimization (NFR-03)**: the persisted `User` and `Request` field lists are tested allowlists; adding any field requires a recorded privacy re-review. The data model's "data that should NOT be stored" list (03 §1) is a deliverable: no extra Identity attributes, no drafts or carried-over content (FR-20, BR-14), no session notes (BR-22), no cancellation reasons (BR-15).
- **Metadata-only notifications (FR-18, NFR-06, BR-16, K-14)**: exactly one reminder per confirmed appointment, its `data` block validated against the fixed three-field allowlist (date/time, generic text, opaque reference) before it is enqueued; over-full payloads are rejected. The recipient travels in the envelope `subject`, goes only to the Notification Hub, is never logged, and is nulled in the outbox on delivery (K-19). A cancelled appointment never leaves a live reminder behind (BR-25).
- **Signed webhooks (NFR-17)**: each delivery is signed over the raw body with a timestamp to bound replay, and authenticated with a scoped machine credential; the signing secret lives only in server env vars and is rotated via the runbook. _(Assumption: HMAC-SHA256 with a shared secret until Teams 20/23 fix the platform scheme.)_ The opaque reference is the appointment id provided it is random and non-derivable _(Assumption: if ids are sequential or guessable, a separate random token is minted instead — resolve in design)_.
- **No-analytics posture**: zero analytics emissions of any kind (NFR-04, C-09) — `@vercel/analytics` is never installed and `NEXT_TELEMETRY_DISABLED=1` is set. The platform's Data & Analytics expectation is open decision OD-1 (Section 16).
- **AI containment (FR-23, BR-24, NFR-10)**: the only AI-bound egress is the service-finder helper route. It is unauthenticated by design and receives no cookies or tokens, so nothing it sends can be tied to a person; it sends the typed text and the public seeded catalogue, nothing else; it never persists or logs the typed text — prompt logging records only mode, outcome, and latency, which is how the platform's "prompt logging that excludes sensitive data" is met; the model's output is parsed as a list of identifiers and validated against the seeded set, so model-written text — including anything a prompt injection might elicit — never reaches a screen. The helper module imports nothing from the request path, the LLM key is server-only, and a global daily budget caps cost and abuse (NFR-19). The helper's own notice tells the visitor, before they type, that the text is sent to an AI service to match services, is not stored, and that the list below works without it. The FR-22 urgency flag still gates a code path that ships nothing at MVP; no request content crosses to any AI component in any configuration (NFR-10).
- **No content in logs, URLs, or errors (NFR-07)**: content travels in POST bodies, opaque ids in paths; request bodies are never logged; verified by the sentinel-string test.
- **Demo-data-only boundary (NFR-09, BR-18, C-06)**: the system operates exclusively on seeded demo data, destroyable on demand via the reset procedure; real student health data is prohibited for the life of the project. Two vendors' infrastructure (Vercel function logs, Supabase API logs) sees demo traffic only — acceptable solely under this boundary, and NFR-07 logging discipline remains on the team.

---

## 13. Error Handling

Principles: error responses are content-free (NFR-07), denials are indistinguishable from not-found (NFR-02), and the losing side of every race gets a clear, actionable message with a path forward (FR-17).

### Expected Errors

| Error                                   | Trigger                                                                                                              | Handling                                                                                                                                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Validation failure                      | Request missing service, description, or triage level (FR-05, FR-06, K-10)                                           | 4xx with plain-language field errors (NFR-12); nothing persisted; error text never echoes submitted content (NFR-07)                                                                              |
| Slot taken — race loser or stale screen | Booking a slot that is no longer open (FR-17, BR-10)                                                                 | The K-4 transaction fails on the K-1/K-2 partial unique index; the route translates the constraint violation into the FR-17 rejection with refreshed availability; exactly one appointment exists |
| Denial-as-404                           | Any read/write outside the Section 3 matrix, including records that exist but belong to someone else (FR-21, NFR-01) | Same 404 body as a nonexistent record (NFR-02, K-16); no fragment of the resource in the response                                                                                                 |
| Duplicate submission replay             | Double-click or network retry re-posts an already-committed `submission_key`                                         | Idempotent create returns the existing request and inserts nothing (K-17); a deliberate new request (fresh form, fresh key) is always permitted (BR-08)                                           |
| Invalid status transition               | Practitioner attempts a move outside the fixed BR-08 lifecycle                                                       | Rejected in service logic (K-10); terminal statuses never revert                                                                                                                                  |
| Slot removal while booked               | Delete on a slot holding an active appointment (FR-14)                                                               | Denied, checked atomically against derived openness inside the removal transaction (K-3, K-7)                                                                                                     |
| Request not bookable                    | Booking against the caller's own request that is still Submitted, already terminal, or acute-level (FR-17, BR-10)     | `409 request-not-bookable` with a fixed, content-free reason code, decided inside the K-4 transaction (K-8); the screen explains in plain language — "a practitioner hasn't opened your request yet", or the FR-08 emergency messaging for acute |
| AI helper unavailable                   | LLM error, 3-second timeout, invalid or non-catalogue output, flag off, or daily budget exhausted (FR-23)             | Not an error to the visitor: the deterministic keyword matcher answers instead and the response notes which mode answered (BR-24); with no match at all, the helper says so and points to the full list and the emergency contacts |
| Webhook delivery failure                | Notification Hub unreachable, non-2xx, or timeout (NFR-17)                                                            | The outbox row keeps its `eventId`, `attempts` increments, `next_attempt_at` backs off exponentially; after the cap the row parks as failed and the runbook covers replay (K-19). The appointment is unaffected                        |

### Failure Scenarios

- **Network retry mid-write.** Submission: the retry replays the same `submission_key` and yields exactly one request (K-17). Booking: a retried booking either finds its request already holding the active appointment (K-2) or the slot taken (K-1) — both resolve to a defined response, never a duplicate.
- **Concurrent booking.** Two students confirm the same slot simultaneously: the storage layer decides. The losing INSERT violates the K-1 partial unique index inside the K-4 transaction; the winner gets the confirmed appointment with the request marked Handled atomically (BR-11), the loser gets the clear FR-17 rejection plus refreshed availability. Proven by the automated two-parallel-bookings test — a week-2 deliverable, before any UI exists (R-4).
- **Database down / data fetch fails.** The crisis path is independent by construction: emergency contacts are static, zero-data-dependency CDN content (Section 9, Frontend; NFR-11, BR-17, FR-07) and stay reachable with every API route down — verified by the degraded-mode check. All other screens fail with a content-free error; transactions ensure no partial writes survive.
- **Boundary failure (C-07, NFR-14).** In mock mode no external dependency can fail the journey or the tests. In the connected slice each real boundary fails soft. Per boundary: a failed audit insert aborts the content read in the same transaction — content is never served unaudited (K-13, Section 12); a reminder `data` block failing the allowlist is rejected before it is enqueued (NFR-06, K-14) and the appointment stands; a Notification Hub outage delays delivery behind backoff and never blocks booking or cancellation, because the event is already safe in the outbox (K-18, K-19); an Identity outage blocks new sign-ins but never the pre-login service finder, its helper, or the emergency-contacts page (FR-02, NFR-11) — and if Team 01 is unavailable on demo day, fixture mode is one env var away (BR-26); an LLM outage is invisible, because the keyword fallback answers (BR-24).
- **Cancellation races the reminder.** Cancel-before-lead-time: the dispatcher only enqueues reminders for appointments that are confirmed at that moment, so nothing is ever sent. Cancel-after-publish: the cancellation transaction writes the retraction (BR-25). Both at once: the reminder enqueue and the cancellation each run in a transaction that touches the appointment row, so they serialise — either the reminder sees a cancelled appointment and skips, or the cancellation sees a set `reminder_published_at` and retracts. There is no interleaving that leaves a live reminder for a cancelled appointment.
- **Half-completed booking or cancellation.** Impossible by construction: booking and cancellation are single transactions (K-4, K-5), and slot openness is derived — future-dated and no confirmed appointment — never a stored flag that can drift (K-3). A cancelled appointment's slot reappears as bookable immediately (BR-13); the request stays terminal and is never reopened (BR-08, BR-14).
- **Paused project (Supabase Free auto-pause after ~7 days of low activity).** The highest-likelihood operational failure: the database pauses during exam-week silence and the demo opens dead. Mitigations — the sprint-zero keep-alive job and pre-demo checklist — are in Section 14 (risk R-1). If it happens anyway, manual restore takes minutes — and the static crisis content stays up throughout (NFR-11).

---

## 14. Deployment

### Development

- **Local stack via Supabase CLI (Docker)**: local Postgres + Auth run the full journey and the entire seven-area test suite (NFR-13) offline against seeded fixtures with every boundary on its contract mock (NFR-14) — identity adapter in fixture mode, a local mock Hub receiver that verifies signatures and the envelope schema, the S&C sink, and the helper on its keyword fallback — zero external dependencies.
- **Seed fixtures (BR-21)**: services, practitioner accounts and role assignments, the three TriageLevel rows, 6–10 demo users, and slots all load from fixtures; there is no in-app administration (OOS-17). One-command whole-dataset destruction + reseed is the NFR-09 reset procedure and itself a demonstrated deliverable.
- **Schema as migrations**: partial unique indexes (K-1/K-2), FKs and CHECKs (K-6/K-10), append-only triggers (K-12/K-13), and the transactional booking and audit-read `plpgsql` functions (K-4, K-13) are week-2 deliverables, proven by the two-parallel-bookings test before UI work.
- **Continuous integration (NFR-21)**: GitHub Actions runs lint, the full automated suite (unit, integration against the local stack, Playwright primary flow with axe accessibility checks — NFR-20), the OpenAPI 3.1 lint and route-coverage check (NFR-18), and the built-bundle key scan on every pull request; `main` stays green.
- **Repository documents (NFR-21)**: `README.md`, `openapi.yaml`, the event schemas, and `RUNBOOK.md` (health check, failure recovery, ownership) are deliverables reviewed like code. No student record — real or realistic — appears in the repository or in demo screenshots.
- **Env-var hygiene**: the service-role key, the identity-mode switch and Team 01 key-set URL, the Hub webhook URL, signing secret and machine credential, the LLM key, and the FR-22/FR-23 AI flags live only in server env vars; `.env.local` is never committed; no secret carries a `NEXT_PUBLIC_` prefix; `server-only` imports guard key-touching modules; `NEXT_TELEMETRY_DISABLED=1` in every environment (NFR-04); the built-bundle key scan runs in CI (PR-06). Full key-hygiene rationale: Section 12.
- **Git workflow**: GitHub repo; Vercel auto-deploys `main` with preview deployments per PR. Previews share the single hosted database — point previews at local config or accept reseeding (Supabase DB branching is paid). PR review rule: no `supabase.from()` in client components.

### Production

- **Topology**: Vercel Hobby serves the Next.js app (function region `sin1` — _Assumption: region selection available on Hobby; verify week 1_); Supabase Free hosts Postgres + Auth in `ap-southeast-1` (Singapore). Both card-free (NFR-16, C-04). Vercel Hobby is single-owner: one student's account owns the project, so env-var changes bottleneck on that person; the non-commercial licence covers a university project.
- **Headroom**: free-tier caps exceed the 30-user demo scale (NFR-15) by orders of magnitude; Hobby has no overages — hitting a cap pauses the deployment, implausible at demo load. No backups on Supabase Free — irrelevant by design (NFR-09: disposable seeded data).
- **Keep-alive and dispatch (mandatory, sprint zero)**: a scheduled GitHub Actions job calls the machine-credential-protected dispatcher route several times a day. One call does both jobs — it touches the database, comfortably clearing Supabase's ~7-day inactivity pause threshold (risk R-1), and it enqueues due reminders and retries pending webhook deliveries (NFR-17). Scheduled workflows can run late, so deliveries are also attempted inline right after booking and cancellation, and the demo uses the manual trigger. _(Assumption: a coarse schedule is acceptable for demo-grade reminder timing.)_
- **Pre-demo checklist**:
  - [ ] Supabase project active (not paused); restore and reseed if paused
  - [ ] Fixtures reseeded; NFR-09 reset procedure run once to confirm destroyability
  - [ ] Full seven-area suite green against seeded data (NFR-13)
  - [ ] Scripted journey rehearsal + urgent-escalation edge case: zero failed operations, every screen under 2 s (NFR-15)
  - [ ] Built client bundle scanned: service-role key absent (PR-06)
  - [ ] No analytics packages installed; telemetry disabled (NFR-04 evidence)
  - [ ] Identity mode confirmed for the demo (real Team 01 tokens, or fixture mode if Team 01 is down) and one sign-in tested in it (BR-26)
  - [ ] One reminder delivered end-to-end to the Notification Hub target with a valid signature; outbox shows no parked rows (NFR-17)
  - [ ] Helper checked twice: once answering by AI, once with the AI flag off answering by fallback (FR-23)
  - [ ] `GET /api/v1/health` green; `openapi.yaml` matches deployed routes; runbook owner names current (NFR-19, NFR-21)
- **Platform delivery sequence (C-12)** — how this PRD maps onto the platform's 14 weeks:
  - Weeks 1–2: ownership, domain model, API list (Sections 3, 8, 11); the schema invariants and the two-parallel-bookings test (R-4).
  - Weeks 3–4: freeze `openapi.yaml` v1 and the two event schemas with Teams 01, 20, and 23; stand up the mock Hub receiver and deliver a signed event to it — "mock the consumer".
  - Weeks 5–7: the connected vertical slice — identity adapter in real mode against Team 01, live webhook delivery to Team 20, registered in the Team 23 gateway catalogue.
  - Weeks 8–10: evaluate the FR-23 helper against a small fixed set of seeded test phrases — AI ranking versus keyword fallback versus the expected service — and record the results; rehearse every fallback trigger.
  - Weeks 11–14: security hardening, the full suite and accessibility checks, observability via correlation IDs and health, deployment, runbook, handover.
- **Week-1 free-tier verification (NFR-16 walkthrough)**:
  - [ ] Approved LLM: which models the course approves, and whether one is usable at 0 THB with no card (C-04, BR-24); if none is, raise it with the instructor immediately — the platform requires the AI capability
  - [ ] Vercel Hobby: no card required; non-commercial licence covers a university project; function region selectable (`sin1`); current invocation/transfer caps
  - [ ] Supabase Free: no card required; pause threshold and paused-project restore window; whether configurable inactivity session timeout is Free or Pro-only (NFR-08 — prototype the JWT-expiry fallback); free organizations allow multiple team members
  - [ ] Both: confirm no analytics/telemetry is enabled by default in newly created projects (NFR-04 verification evidence)

---

## 15. Constraints

- **C-01 — Simulated stakeholders**: a university student project; clinical and privacy stakeholders are likely simulated, with the instructor as proxy against written scenarios; every requirement invented under simulation is logged as an assumption, never presented as validated fact.
- **C-02 — Team**: 3–5 student developers.
- **C-03 — Time**: one semester, including the seven-test quality bar; scope must survive sprint-zero estimation; any scope addition must name the journey step or mandated test that needs it.
- **C-04 — Budget**: 0 THB; prefer free-tier services; no component of the build, demo, or test run may require payment (the chosen stack is card-free on both services).
- **C-05 — No enterprise complexity**: no high availability, no compliance-grade audit infrastructure, no configurable taxonomies or role engine, no multi-tenancy, no admin portal.
- **C-06 — Demo data only**: real student health data never enters the system (BR-18), and the system never touches the existing clinical records system. _(Assumption: prohibition to be confirmed in week 1 with the privacy office or instructor-as-proxy; the plan proceeds as if confirmed.)_
- **C-07 — Mockable boundaries, two of them real**: Identity, Notification Hub, Security & Compliance, and the LLM are consumed as contracts behind adapters, each with a contract mock so development and tests never depend on another team. Revision 2 narrows the original "all stubbed" position to meet the platform outcome (C-12): in the connected slice Identity sign-in and the outbound Notification Hub webhook are real, switched on by configuration. Security & Compliance stays on its mock at MVP. Contracts are drafted in week 1 — when pre-login browsing compatibility with the Identity constraint is also confirmed — and frozen with the owning teams in weeks 3–4.
- **C-08 — Fixed shape from the brief**: three core screens, four named entities (Service, Request, Appointment, TriageLevel), three hard-coded triage levels, one campus, one language; the only permitted additions are the minimal supplements the journey and mandated tests demand — the emergency-contacts page, the "my requests" view, the coordinator metadata view, the service-finder helper inside the existing finder screen (FR-23), and the supporting Slot, User, RequestStatusChange, AuditEvent, and OutboundEvent records (each justified in Section 8 against FR-14–FR-17, FR-03/BR-20, FR-12, FR-11/BR-07, and NFR-17/C-12 respectively); anything further must name its justifying journey step or test, or it is cut.
- **C-09 — Analytics prohibition**: no medical or counselling content may ever reach an analytics capability; shipping zero analytics is the mandated posture (NFR-04).
- **C-10 — Technology neutrality of the requirements**: the requirements layer prescribes no technologies, frameworks, hosting, vendors, or endpoint syntax; the team selected implementations during design within C-04 and C-05 — recorded as final: Option A, Vercel + Supabase (Section 10).
- **C-11 — Honest ceiling**: the realistic deliverable is a convincing privacy-by-design prototype on seeded data passing the seven mandated test areas — not a production system handling real student health information.
- **C-12 — Platform contract**: Team 16 is one of 24 services in the University Digital Campus Platform, and the platform PRD's outcome and definition of done bind this product alongside the team brief: a deployed vertical slice that can authenticate a real platform user (BR-26); a documented REST API — at least six operations, OpenAPI 3.1, `/api/v1`, correlation IDs (NFR-18); at least one event exchanged with another team in the signed platform envelope (FR-18, NFR-17); one AI capability with a deterministic fallback, working when AI is unavailable (FR-23, BR-24); seven or more automated tests; accessibility checks for the primary flow (NFR-20); README and runbook (NFR-21). Where the platform contract and Team 16's privacy posture pull apart, privacy wins by default and the disagreement is recorded as an open decision for the instructor rather than settled silently — currently one: OD-1.

---

## 16. Risks

Technical risks are the top five from the architecture decision (Option A: Vercel + Supabase — final); product risks carry forward from discovery. Every product risk rests on unvalidated assumptions and is marked accordingly.

| #             | Risk                                                                                                                                                     | Impact                                                                                                             | Mitigation                                                                                                                                                                                                                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-1 (tech)    | Supabase Free project auto-pauses after ~7 days of low activity — highest-likelihood failure, precisely during exam-week silence                         | Dead database on demo/grading day; instant failure of the NFR-15 zero-failure criterion                            | Sprint-zero, non-negotiable: scheduled GitHub Actions keep-alive query; pre-demo checklist item "project active + reseed"; the NFR-15 rehearsal run doubles as the check; verify the paused-project restore window in week 1                                                                            |
| R-2 (tech)    | Service-role key reaches the client bundle (a `NEXT_PUBLIC_` prefix or a server module imported into a client component)                                 | Total collapse of the Section 3 permission matrix — god-mode credentials in every browser                          | `server-only` imports; env-var naming convention; automated built-bundle scan for the key wired into the role-boundary suite (PR-06, NFR-13)                                                                                                                                                            |
| R-3 (tech)    | A teammate bypasses the enforcement layer via the tutorial-default Supabase client SDK                                                                   | The "quick feature" skips FR-21 authorization and FR-11 audit-on-read entirely                                     | Deny-all RLS (zero policies) on every table from day one, so any bypass returns nothing (Section 9, Database); PR review rule: no `supabase.from()` in client components; negative tests per matrix row (PR-06)                                                                                         |
| R-4 (tech)    | Booking atomicity written in JavaScript check-then-insert instead of the database                                                                        | Intermittent failures of the mandated two-parallel-bookings test (FR-17) — the worst kind of failure               | K-1/K-2 partial unique indexes and the K-4 transactional booking function are week-2 deliverables, proven by an automated concurrent-booking test before any UI exists                                                                                                                                  |
| R-5 (tech)    | Stacked learning curves (Next.js App Router + real SQL/plpgsql) compress the semester (C-03) for 3–5 students                                            | Scope misses the delivery window; the option's simplicity claim is falsified for this team                         | Assign a DB owner and an auth owner in sprint zero; walking skeleton (sign-in → submit request → concurrent-safe booking) due week 3; if it slips, review the portable Option B fallback design                                                                                                         |
| R-6 (product) | Wrong problem: counsellor capacity — not the intake channel — is the real barrier _(Assumption: the channel is the barrier; discovery §7.4)_             | A smoother form only lengthens the queue; the product improves nothing visible to students                         | Anonymous student survey + interviews (students are reachable even when clinical stakeholders are simulated); 30-minute check for an existing booking portal (discovery §7.11), which would narrow the differentiator to privacy framing + triage                                                       |
| R-7 (product) | Adoption depends on practitioners: no buy-in, or stale availability slots _(Assumptions: service participation, slot maintenance; discovery §7.2, §7.8)_ | Phantom bookings and instant loss of student trust — the classic two-sided cold-start failure; value evaporates    | Seeded slot data for the semester (BR-21); ask staff how they manage calendars today; instructor role-plays the service director against a written scenario; every invented requirement logged as an assumption                                                                                         |
| R-8 (product) | Simulated-stakeholder validation: privacy office, service leadership, and clinical governance are proxied by the instructor (C-01)                       | Requirements "validated" only under simulation may not survive real review; credibility of the privacy deliverable | Written proxy scenarios checked against the university's published data-protection policy; every simulation-derived requirement logged as an assumption, never presented as fact; the honest ceiling stated up front (C-11: privacy-by-design prototype on seeded data, not a production health system) |
| R-9 (tech)    | Cross-team dependency: Team 01's tokens or Team 20's webhook endpoint arrive late, change shape, or are down on demo day — the classic semester-killer this PRD originally avoided by stubbing everything | The connected slice (platform weeks 5–7) slips; demo-day failure caused by someone else's service | Adapters with contract mocks from week 1, so no Team 16 work ever waits on another team; contracts frozen in weeks 3–4 via schema pull requests; real mode is configuration only, and fixture/mock mode is the rehearsed demo-day fallback (BR-26, NFR-14); agree a named contact in each of Teams 01, 20, and 23 |
| R-10 (tech)   | The AI helper misbehaves: it surfaces unsafe or wrong guidance, a visitor in distress treats it as help, typed text leaks into logs, or a public endpoint burns the 0 THB budget | Harm at the most sensitive moment of the journey; a privacy incident from the one feature that touches an LLM; a paid bill | Output constrained to seeded service identifiers and validated — model-written text never reaches the screen; emergency contacts and a "cannot judge urgency" statement always beside it; typed text never stored or logged, no identity attached; global daily budget that degrades to the keyword fallback; peer-test the helper wording with the NFR-12 group (BR-24, NFR-10, NFR-19) |
| R-11 (tech)   | Reminder metadata still reveals too much: the Hub adds its own wording or the `source` to the notification, or retains the recipient-plus-time pair | The "you have an appointment" design is defeated downstream, outside Team 16's code | The four contract terms in Section 11.5, signed off by Team 20; the contract mock asserts Team 16's side; a manual check of what actually appears on a device during connected-slice testing; if Team 20 cannot honour retractions, the BR-16 lead-time rule already limits exposure |

### Open decisions

- **OD-1 — Data & Analytics feed.** The platform PRD says all material events are available to Data & Analytics "with privacy minimisation" and separately that wellbeing data requires "minimised analytics"; Team 16's brief makes shipping zero analytics the mandated posture (NFR-04, C-09). This PRD cannot settle that on its own. **Default until decided: zero** — no event of any kind goes to Team 21. **Owner:** the team lead raises it with the instructor and Team 21 by the week 3–4 contract freeze and records the answer here. **Pre-designed fallback if an exemption is refused:** two count-only events, `request.submitted` and `appointment.booked`, in the platform envelope with no `subject` and an empty `data` block — a type and a timestamp, nothing about who, which service, or how urgent — delivered through the existing dispatcher; adopting it requires the recorded privacy re-review NFR-03 demands and an update to NFR-04's test.

---

## 17. Acceptance Criteria

### MVP is complete when:

All seven mandated test areas run green against seeded demo data with every boundary on its contract mock (NFR-13, NFR-14), plus the two platform criteria added in revision 2 (AC-8, AC-9 — C-12) and the two operational criteria. Nothing in Section 18 or the OOS list counts toward completion.

**AC-1 — Privacy** (FR-04, FR-09, FR-11, FR-18, NFR-02–NFR-07, BR-06, BR-07)

- [ ] Identical-404 test: a denied access to an existing record belonging to someone else is byte-indistinguishable in response content from a record that does not exist (NFR-02, K-16).
- [ ] Queue-is-metadata test: the practitioner queue response contains no description, free text, or preferred times, and loading it any number of times produces zero audit events (FR-10, BR-07); the owning student reading their own request also produces none (FR-11).
- [ ] Audit-event-on-view test: a practitioner opening one request's content N times produces exactly N audit events, each containing only viewer identity, role, request id, timestamp — never content (FR-11, NFR-05, BR-07, K-13); no in-app role can read, edit, or delete them (PR-05).
- [ ] Sentinel test: a unique string submitted in request free text appears nowhere outside the granted request views — not in logs, error messages, or page addresses (NFR-07).
- [ ] Zero analytics-bound emissions asserted (NFR-04, C-09); persisted User and Request records match their NFR-03 allowlists exactly.
- [ ] The FR-04 privacy notice appears before submission; peer testers correctly answer "who can see my request" (NFR-12).

**AC-2 — Request** (FR-05, FR-06, FR-08, BR-08)

- [ ] A request is accepted only with the exact FR-05 field set and exactly one of the three hard-coded urgency levels (FR-06, BR-01); submission without a level is rejected.
- [ ] Content is frozen at submission — no role can edit it (K-11, PR-04); status moves only through the fixed BR-08 lifecycle, each change recorded with its actor (FR-12, K-12).
- [ ] In-review trigger test: a request stays Submitted until a practitioner of its service first opens its content; that read moves it to In review exactly once, with that practitioner recorded as actor, in the same transaction as the audit event; a second read changes nothing; no role can set In review by hand (BR-08, K-13).
- [ ] Double-click/retry of one submitted form yields exactly one request (K-17).

**AC-3 — Booking** (FR-15, FR-16, FR-17, BR-10, BR-11)

- [ ] Two-parallel-bookings test: two concurrent attempts on the same slot yield exactly one confirmed appointment and one clear rejection with refreshed availability (FR-17, K-1, K-4) — automated, passing by week 2, before any UI exists.
- [ ] Booking links exactly one student, one slot, one originating request and marks the request Handled in the same transaction (FR-16, BR-11, K-4, K-8).
- [ ] Only open (future-dated, unbooked, server-clock-checked) slots are bookable, and only by the owner of the underlying request (BR-10, K-3, K-9).
- [ ] Bookability test: booking the caller's own request is rejected with `409 request-not-bookable` while it is Submitted, after it is Handled (including after its appointment was cancelled), Escalated, or Closed, and succeeds only while it is In review; open slots are not listed to a student with no In-review request for that service (FR-15, FR-17, BR-10, K-8).

**AC-4 — Cancellation** (FR-19, FR-20, BR-13, BR-14, BR-15)

- [ ] A student cancels their own upcoming appointment in one confirmation action with no justification; the slot reappears as bookable immediately (FR-19, BR-13, K-5).
- [ ] After cancellation, the prior request's content surfaces nowhere; a new request starts empty with no carry-over (FR-20, BR-14, NFR-09).
- [ ] No no-show penalties, booking limits, or punitive mechanics exist anywhere (BR-15).
- [ ] Retraction test: cancelling before the reminder is published results in no reminder ever being sent; cancelling after it is published sends exactly one `appointment.cancelled` event whose `data` holds only the opaque reference; removing the freed slot afterwards succeeds and leaves no live reminder at the Hub target (BR-25, K-14, K-18, K-20).

**AC-5 — Role boundary** (FR-13, FR-21, Section 3 matrix, NFR-01, NFR-02, PR-01–PR-06)

- [ ] At least one negative case per Section 3 matrix row per role, all failing closed with content-free denials (PR-06, NFR-01, FR-21).
- [ ] Coordinator responses never contain description, free text, or preferred times — the metadata-only DTO is asserted (FR-13, PR-03).
- [ ] The built client bundle contains no service-role key (automated scan), and the browser client-SDK path returns nothing under deny-all RLS (mitigations for R-2/R-3, folded into this suite).
- [ ] After sign-out, back-navigation reveals no request content (NFR-08).

**AC-6 — Reminder** (FR-18, NFR-06, BR-16)

- [ ] Metadata-only payload test: the event delivered to the Notification Hub target is a valid platform envelope whose `data` contains exactly the appointment date/time, generic "you have an appointment" text, and an opaque non-derivable reference, whose `subject` identifies the recipient, and whose `type` and `source` are the fixed constants — never service name/type, practitioner, reason, triage level, or content anywhere in it (FR-18, NFR-06, NFR-17, K-14).
- [ ] A deliberately over-full `data` block is rejected before it is enqueued by the allowlist validator (NFR-06).
- [ ] Exactly one reminder per confirmed appointment, published at the lead time before its start and only while still confirmed (BR-16, K-14).
- [ ] Delivery test: the webhook carries a valid signature that the mock receiver verifies; a forced failure is retried with the same `eventId` and growing intervals; after the cap the row parks as failed and the appointment is unaffected; on success the outbox row's `subject` and `payload` are nulled (NFR-17, K-18, K-19).

**AC-7 — Urgent escalation** (FR-08, FR-12, FR-13, BR-03, BR-04, NFR-11)

- [ ] Selecting the highest urgency level foregrounds emergency contacts, states plainly the app cannot provide immediate help, and does not present booking as the crisis resolution — while still recording the request flagged for human escalation (FR-08, BR-03).
- [ ] A direct booking call against an acute-level request is rejected server-side with `409 request-not-bookable`, whatever its status (BR-10, K-8).
- [ ] A practitioner can mark the request Escalated, recording the out-of-app crisis handoff (FR-12); the coordinator view surfaces acute-flagged requests first (FR-13); a documented demo-world response-time policy with a named owner exists, signed off by the instructor-as-proxy (BR-04) _(Assumption: policy values unvalidated)_.
- [ ] Emergency contacts render with data access disabled (degraded-mode check), reachable within one interaction from every screen (NFR-11, BR-17).

**AC-8 — Platform definition of done** (C-12, BR-26, NFR-17–NFR-21)

- [ ] Real platform user: in the connected slice, a user issued by Team 01's Identity service signs in and completes the core journey; tokens with a bad signature, wrong audience, or past expiry are rejected; only the required claims are persisted (BR-26, FR-03). The same suite passes in fixture mode with no code change (NFR-14).
- [ ] Inter-team event: at least one `appointment.reminder` is delivered to Team 20's real endpoint and acknowledged, with the contract terms of Section 11.5 signed off by Team 20 — or, if Team 20 is not ready by the demo, delivered to the contract mock with Team 20's written agreement to the schema, and the gap stated openly at the demo.
- [ ] API contract: every route is under `/api/v1`, appears in `openapi.yaml` (OpenAPI 3.1, lint clean), and returns an `X-Correlation-Id`; at least six documented operations are demonstrable; the service is registered in the Team 23 gateway catalogue (NFR-18).
- [ ] `GET /api/v1/health` reports healthy with the database up and unhealthy with it down, revealing nothing else; a cross-origin cookie-authenticated POST is rejected (NFR-19).
- [ ] Accessibility: automated axe checks over the primary flow show zero serious or critical violations, and one keyboard-only walkthrough of request → booking → cancellation is recorded (NFR-20).
- [ ] README, runbook (health check, failure recovery, ownership), and event schemas are in the repository; CI is green on `main`; no student record appears in the repository or demo screenshots (NFR-21).

**AC-9 — AI plus fallback** (FR-23, BR-24, NFR-10)

- [ ] With the AI enabled and healthy, the helper returns a ranked list made only of seeded service identifiers, and the screen shows only seeded descriptions.
- [ ] Fallback test: with the flag off, with the LLM forced to error, to exceed the 3-second timeout, to return free text or an unknown identifier, and with the daily budget exhausted, the helper still answers from the keyword matcher every time and reports fallback mode — and steps 1–8 of the journey pass with AI unavailable throughout.
- [ ] Containment test: the helper's outbound AI call contains the typed text and the seeded catalogue and nothing else — no cookie, token, identity, or request field; a sentinel string typed into the helper appears in no log and no table; submitting a request produces zero AI-bound calls under every flag combination (NFR-10).
- [ ] The emergency contacts, the "cannot judge urgency" statement, and the full service list are visible beside the helper in every state, including AI failure (BR-24, NFR-11).
- [ ] Weeks 8–10 evaluation recorded: AI ranking versus keyword fallback versus expected service over the fixed seeded phrase set, with the team's conclusion.

**Operational criteria**

- [ ] NFR-15 rehearsal run: one complete scripted run of the core journey plus the urgent-escalation edge case with zero failed operations, every interactive screen responding within 2 seconds under up to 30 concurrent users, executed at a rehearsal session _(Assumption: thresholds are team choices)_.
- [ ] NFR-16 walkthrough: deployment demonstrated end-to-end at 0 THB with no paid component and no card on file (C-04), with the week-1 free-tier assumptions verified and recorded.

---

## 18. Future Improvements

Post-MVP only; each stays cut until the MVP acceptance criteria hold. Everything else on the OOS list remains cut by default unless it can name the journey step or mandated test that needs it (C-03).

- **Live Security & Compliance delivery, and any inbound event** (OOS-04, narrowed) — Identity sign-in and the Notification Hub webhook moved into the MVP in revision 2 (C-12). Sending audit events to Team 22's real endpoint waits only on that endpoint existing: the events are already envelope-shaped and the dispatcher already exists, so it is a configuration switch. Consuming another team's events waits for a journey step that needs one; its handler must be idempotent on `eventId` (NFR-17).
- **AI urgency suggestion behind the FR-22 flag** (OOS-01) — waits for safety validation a semester cannot provide (never under-triage a crisis, never over-triage into alert fatigue, clinician acceptance — discovery §7.3); if ever enabled it remains suggest-only with the emergency disclaimer, the student's choice final (BR-23).
- **Practitioner calendar sync** (OOS-05) — waits because calendar sync alone can eat half a semester; manual discrete slot entry already proves the booking flow (BR-12).
- **Reschedule flow** (OOS-06) — waits because cancel + rebook is functionally equivalent and deleting the extra state machine is what kept scope inside the semester (BR-14); revisit only if real usage shows the two-step flow losing bookings.
- **Analytics on aggregates only** (OOS-09) — an aggregate demand-vs-capacity signal (counts and wait times, never content) is the institution's most plausible post-MVP value; waits because shipping zero analytics is the mandated compliance posture at MVP (NFR-04, C-09) and any aggregate channel needs its own privacy review first (NFR-03).
