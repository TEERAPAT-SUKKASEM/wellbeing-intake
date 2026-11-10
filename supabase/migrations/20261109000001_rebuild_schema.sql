-- What this file does: creates the tables of the rebuilt system: services, opening hours, staff,
-- appointment requests, the webhook outbox and the hourly submit counter.
-- Why it exists: the new PRD needs anonymous requests, one shared calendar and a 15-minute privacy
-- buffer after every session, and the old student-account tables did not fit that.
-- Key idea: an exclusion constraint on appointment_request makes double booking (buffer included)
-- impossible inside the database itself, even when two students click at the same moment.
--
-- Rebuild for the new PRD (docs/PRD.md, 2026-11-09): anonymous requests with a Private Access Key,
-- one shared calendar, and a mandatory 15-minute privacy buffer.
--
-- DESTRUCTIVE: this drops the old student-account schema and its data. That data is seeded demo data
-- only. Roll back to the old system with the git tag `v1-old-design` plus a database reset.

-- ---------------------------------------------------------------------------
-- Remove the old system. Kept: ai_call_budget, inbound_event, jsonb_sorted_keys, consume_ai_budget.
-- ---------------------------------------------------------------------------
-- The kept items come from the 20260920 migrations:
--   consume_ai_budget(p_limit) adds 1 to today's row in ai_call_budget and returns false once the
--   daily limit is reached. It is one statement, so parallel calls cannot go over the limit.
--   jsonb_sorted_keys(j) returns the key names of a JSON object in sorted order.
--   inbound_event remembers each webhook receipt id from the Notification Hub.
-- "if exists" lets this run on any database; "cascade" also drops objects that depend on a table.
drop function if exists
  create_request, read_request_content, update_request_status, book_appointment, cancel_appointment,
  enqueue_due_reminders, claim_outbound_events, mark_outbound_delivered, mark_outbound_attempt_failed,
  remove_slot, record_inbound_event, reset_demo_data;

drop table if exists
  audit_event, request_status_change, appointment, slot, request, outbound_event,
  app_user, service, triage_level
  cascade;

drop function if exists forbid_change, request_content_immutable;

-- Appointment ids are now text (req_...), so a delivery receipt's reference is too.
alter table inbound_event alter column reference type text using reference::text;

-- ---------------------------------------------------------------------------
-- Service: the categories a student chooses from. Stable ids survive a reseed.
-- ---------------------------------------------------------------------------
create table service (
  -- Readable ids such as srv_academic_stress, matching the PRD's "srv_123" style.
  id                text primary key check (id ~ '^srv_[a-z0-9_]+$'),
  name              text not null unique,
  description       text not null default '',
  -- 15 to 120 minutes, in steps of 5. With the buffer, one booking blocks at most 135 minutes.
  duration_minutes  integer not null check (duration_minutes between 15 and 120 and duration_minutes % 5 = 0),
  -- An inactive service is hidden from students and cannot be booked, but its old requests stay.
  is_active         boolean not null default true
);

-- ---------------------------------------------------------------------------
-- Availability: weekly opening hours of the one shared calendar, in campus time.
-- Slots are calculated from these rows and are never stored, so they cannot run out or drift.
-- ---------------------------------------------------------------------------
create table availability_window (
  id          bigint generated always as identity primary key,
  weekday     smallint not null check (weekday between 0 and 6),    -- 0 = Sunday
  start_time  time not null,
  end_time    time not null,
  check (start_time < end_time),
  -- One day can have several windows (e.g. morning and afternoon), but not two that start together.
  unique (weekday, start_time)
);

-- ---------------------------------------------------------------------------
-- Staff: practitioners and administrators only. Students are never stored.
-- ---------------------------------------------------------------------------
create table staff (
  id            uuid primary key default gen_random_uuid(),
  -- The id that the sign-in system gives this person. It links a signed-in user to a staff row.
  identity_ref  text not null unique,
  email         text not null,
  display_name  text not null,
  role          text not null check (role in ('practitioner', 'admin')),
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- AppointmentRequest: holds no legal name, email, student id or IP address.
-- ---------------------------------------------------------------------------
create table appointment_request (
  -- Random and unrelated to the access key: this id is published in the webhook.
  id               text primary key default ('req_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  -- SHA-256 hash (a one-way fingerprint) of the Private Access Key, as 64 hex characters. To check a
  -- key, the server hashes what the student typed and compares the two hashes.
  access_key_hash  text not null unique check (access_key_hash ~ '^[0-9a-f]{64}$'),  -- the key itself is never stored
  -- submission_key is the optional Idempotency-Key header. "unique" means a second submit with the
  -- same key can never create a second row; it finds and returns the first one.
  submission_key   uuid unique,                                                     -- makes a retried submit safe
  -- "on delete restrict": a service that has requests cannot be deleted, only made inactive.
  service_id       text not null references service (id) on delete restrict,
  -- An optional nickname. There is no column for a legal name, email or student id at all.
  alias            text check (alias is null or char_length(alias) between 1 and 40),
  intake_note      text not null check (char_length(intake_note) between 1 and 2000),
  -- Both come from assessUrgency in src/lib/urgency/assess.ts.
  urgency_level    text not null check (urgency_level in ('ROUTINE', 'URGENT')),
  triage_mode      text not null check (triage_mode in ('AI_ASSISTED', 'DETERMINISTIC_FALLBACK')),
  -- slot_start to slot_end is the session. slot_end to buffer_end is the 15-minute privacy buffer.
  -- timestamptz stores an exact instant, so time zones cannot cause mistakes.
  slot_start       timestamptz not null,
  slot_end         timestamptz not null,
  buffer_end       timestamptz not null,
  -- PENDING and CONFIRMED are "live": they hold their time. REJECTED and CANCELLED hold no time.
  status           text not null default 'PENDING' check (status in ('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED')),
  decided_by       uuid references staff (id) on delete set null,                   -- who approved, rejected or moved it
  decided_at       timestamptz,
  created_at       timestamptz not null default now(),

  check (slot_end > slot_start),
  -- The 15-minute Privacy & Sanitization Buffer is a fact of every row.
  check (buffer_end = slot_end + interval '15 minutes'),

  -- THE rule of this product. No two live requests can overlap, buffer included, on the one shared
  -- calendar, however many clients race. Cancelling or rejecting a row releases its time at once.
  --
  -- An exclusion constraint is a database rule that rejects two rows whose time ranges overlap.
  -- tstzrange(slot_start, buffer_end, '[)') is the time from session start to buffer end.
  -- '[)' means the start is included and the end is not. So a session may start exactly when the
  -- previous buffer ends (11:00 after a buffer that ends at 11:00), but not one minute earlier.
  -- "&&" means "overlaps". "gist" is the index type that can compare ranges quickly.
  -- The "where" part limits the rule to live rows, so cancelled or rejected rows block nothing.
  -- If two inserts race, the database lets one win and the other gets an exclusion_violation error.
  constraint appointment_request_no_overlap
    exclude using gist (tstzrange(slot_start, buffer_end, '[)') with &&)
    where (status in ('PENDING', 'CONFIRMED'))
);

-- For the practitioner queue. 'URGENT' sorts after 'ROUTINE' alphabetically, so "urgency_level desc"
-- puts URGENT requests at the top, then the earliest slot first.
create index appointment_request_queue_idx on appointment_request (status, urgency_level desc, slot_start);

-- ---------------------------------------------------------------------------
-- Transactional outbox. Each row is written in the same transaction as the decision that caused it.
-- ---------------------------------------------------------------------------
-- An outbox is a table of webhook messages waiting to be sent. A transaction is a group of changes
-- that is saved all together or not at all. So if a confirmation is saved, its event is saved too,
-- and a dispatcher sends it later with retries. A Hub outage can delay an event but never lose it.
create table outbound_event (
  event_id         uuid primary key default gen_random_uuid(),   -- stable across retries; sent as X-Event-Id
  type             text not null check (type in ('appointment.confirmed', 'appointment.cancelled')),
  reference        text not null,                                -- by value: not a foreign key
  payload          jsonb,                                        -- nulled once delivered or neutralised
  occurred_at      timestamptz not null default now(),
  -- Retry bookkeeping. A row is finished once delivered_at (sent) or failed_at (given up) is set.
  attempts         integer not null default 0,
  next_attempt_at  timestamptz not null default now(),
  last_status      integer,
  delivered_at     timestamptz,
  failed_at        timestamptz,
  -- Zero sensitive data: the allowlist is enforced here as well as in the application.
  -- The payload must have EXACTLY these keys (PRD section 6), so an intake note or alias can never
  -- be added to a webhook by mistake.
  check (
    payload is null
    or (type = 'appointment.confirmed'
        and jsonb_sorted_keys(payload) = array['appointment_id', 'event_type', 'privacy_buffer_end', 'scheduled_time'])
    or (type = 'appointment.cancelled'
        and jsonb_sorted_keys(payload) = array['appointment_id', 'event_type'])
  )
);

-- A partial index (it only covers rows still waiting), so the dispatcher finds due events fast.
create index outbound_event_pending_idx on outbound_event (next_attempt_at)
  where delivered_at is null and failed_at is null;
-- Used to find all waiting events of one appointment, to neutralise them (see the functions file).
create index outbound_event_reference_idx on outbound_event (reference);

-- ---------------------------------------------------------------------------
-- Hourly cap on anonymous submissions across all visitors: stops a script filling the calendar.
-- It holds a counter only, with no visitor identifier.
-- ---------------------------------------------------------------------------
-- One row per hour (the start of the hour) with a counter. consume_request_budget updates it.
create table request_rate_bucket (
  hour   timestamptz primary key,
  calls  integer not null default 0
);

-- ---------------------------------------------------------------------------
-- Deny-all backstop: row level security on, zero policies, no grants to browser roles.
-- ---------------------------------------------------------------------------
-- Row level security (RLS) is a set of rules that decide which rows a database role may see.
-- With RLS on and NO rules, the browser roles "anon" and "authenticated" can read or change
-- nothing, even with the public Supabase key. Our server uses the secret service_role key, which
-- skips RLS, so every read and write must go through our API routes and their checks.
alter table service              enable row level security;
alter table availability_window  enable row level security;
alter table staff                enable row level security;
alter table appointment_request  enable row level security;
alter table outbound_event       enable row level security;
alter table request_rate_bucket  enable row level security;

-- A second lock: also take away the table rights themselves, in case a policy is ever added by mistake.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
