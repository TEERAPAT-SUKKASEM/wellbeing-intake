-- Rebuild for the new PRD (docs/PRD.md, 2026-11-09): anonymous requests with a Private Access Key,
-- one shared calendar, and a mandatory 15-minute privacy buffer.
--
-- DESTRUCTIVE: this drops the old student-account schema and its data. That data is seeded demo data
-- only. Roll back to the old system with the git tag `v1-old-design` plus a database reset.

-- ---------------------------------------------------------------------------
-- Remove the old system. Kept: ai_call_budget, inbound_event, jsonb_sorted_keys, consume_ai_budget.
-- ---------------------------------------------------------------------------
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
  id                text primary key check (id ~ '^srv_[a-z0-9_]+$'),
  name              text not null unique,
  description       text not null default '',
  duration_minutes  integer not null check (duration_minutes between 15 and 120 and duration_minutes % 5 = 0),
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
  unique (weekday, start_time)
);

-- ---------------------------------------------------------------------------
-- Staff: practitioners and administrators only. Students are never stored.
-- ---------------------------------------------------------------------------
create table staff (
  id            uuid primary key default gen_random_uuid(),
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
  access_key_hash  text not null unique check (access_key_hash ~ '^[0-9a-f]{64}$'),  -- the key itself is never stored
  submission_key   uuid unique,                                                     -- makes a retried submit safe
  service_id       text not null references service (id) on delete restrict,
  alias            text check (alias is null or char_length(alias) between 1 and 40),
  intake_note      text not null check (char_length(intake_note) between 1 and 2000),
  urgency_level    text not null check (urgency_level in ('ROUTINE', 'URGENT')),
  triage_mode      text not null check (triage_mode in ('AI_ASSISTED', 'DETERMINISTIC_FALLBACK')),
  slot_start       timestamptz not null,
  slot_end         timestamptz not null,
  buffer_end       timestamptz not null,
  status           text not null default 'PENDING' check (status in ('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED')),
  decided_by       uuid references staff (id) on delete set null,                   -- who approved, rejected or moved it
  decided_at       timestamptz,
  created_at       timestamptz not null default now(),

  check (slot_end > slot_start),
  -- The 15-minute Privacy & Sanitization Buffer is a fact of every row.
  check (buffer_end = slot_end + interval '15 minutes'),

  -- THE rule of this product. No two live requests can overlap, buffer included, on the one shared
  -- calendar, however many clients race. Cancelling or rejecting a row releases its time at once.
  constraint appointment_request_no_overlap
    exclude using gist (tstzrange(slot_start, buffer_end, '[)') with &&)
    where (status in ('PENDING', 'CONFIRMED'))
);

create index appointment_request_queue_idx on appointment_request (status, urgency_level desc, slot_start);

-- ---------------------------------------------------------------------------
-- Transactional outbox. Each row is written in the same transaction as the decision that caused it.
-- ---------------------------------------------------------------------------
create table outbound_event (
  event_id         uuid primary key default gen_random_uuid(),   -- stable across retries; sent as X-Event-Id
  type             text not null check (type in ('appointment.confirmed', 'appointment.cancelled')),
  reference        text not null,                                -- by value: not a foreign key
  payload          jsonb,                                        -- nulled once delivered or neutralised
  occurred_at      timestamptz not null default now(),
  attempts         integer not null default 0,
  next_attempt_at  timestamptz not null default now(),
  last_status      integer,
  delivered_at     timestamptz,
  failed_at        timestamptz,
  -- Zero sensitive data: the allowlist is enforced here as well as in the application.
  check (
    payload is null
    or (type = 'appointment.confirmed'
        and jsonb_sorted_keys(payload) = array['appointment_id', 'event_type', 'privacy_buffer_end', 'scheduled_time'])
    or (type = 'appointment.cancelled'
        and jsonb_sorted_keys(payload) = array['appointment_id', 'event_type'])
  )
);

create index outbound_event_pending_idx on outbound_event (next_attempt_at)
  where delivered_at is null and failed_at is null;
create index outbound_event_reference_idx on outbound_event (reference);

-- ---------------------------------------------------------------------------
-- Hourly cap on anonymous submissions across all visitors: stops a script filling the calendar.
-- It holds a counter only, with no visitor identifier.
-- ---------------------------------------------------------------------------
create table request_rate_bucket (
  hour   timestamptz primary key,
  calls  integer not null default 0
);

-- ---------------------------------------------------------------------------
-- Deny-all backstop: row level security on, zero policies, no grants to browser roles.
-- ---------------------------------------------------------------------------
alter table service              enable row level security;
alter table availability_window  enable row level security;
alter table staff                enable row level security;
alter table appointment_request  enable row level security;
alter table outbound_event       enable row level security;
alter table request_rate_bucket  enable row level security;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
