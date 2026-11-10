-- What this file does: creates the two tables for referrals from Team 14's Helpdesk (referral and its
-- callback outbox referral_event), and the functions that decide a referral and delete old ones.
-- Why it exists: a student on a Helpdesk ticket can ask to be sent to Wellbeing. A practitioner accepts
-- or declines, and we tell Helpdesk the result with a signed callback (docs/HELPDESK-REFERRALS.md).
-- Key idea: we store only a random ref, a service id and the consent time. A ref is never linked to an
-- appointment request, so Helpdesk can never learn whether or when a student booked a session.

-- ---------------------------------------------------------------------------
-- Referral: one row per ref that Helpdesk sent us. No name, email, student id or ticket text.
-- ---------------------------------------------------------------------------
create table referral (
  -- Helpdesk makes the ref: "hd-" and 32 random hex characters. It means nothing to us.
  ref          text primary key check (ref ~ '^hd-[0-9a-f]{32}$'),
  -- The service the student picked on Helpdesk, or null. If that service is ever deleted, the
  -- referral stays and the service becomes null ("set null").
  service_id   text references service (id) on delete set null,
  -- When the student ticked the consent box on Helpdesk.
  consent_at   timestamptz not null,
  status       text not null default 'received' check (status in ('received', 'approved', 'declined')),
  received_at  timestamptz not null default now(),
  decided_at   timestamptz,
  -- A referral that is still waiting has no decision time, and a decided one always has one.
  check ((status = 'received') = (decided_at is null))
);

-- For purge_old_referrals (delete by age) and the staff list (newest first).
create index referral_received_at_idx on referral (received_at);

-- ---------------------------------------------------------------------------
-- Outbox for our callbacks to Helpdesk. Each row is written in the same transaction as the decision,
-- so an accepted or declined referral can never lose its callback, even when Helpdesk is down.
-- ---------------------------------------------------------------------------
create table referral_event (
  -- Sent as eventId in the callback body, and the same on every retry, so Helpdesk can drop a copy
  -- it has already handled. decide_referral fills it; the default is the same format.
  event_id        text primary key default ('evt-' || gen_random_uuid()::text),
  -- "on delete cascade": when a referral is deleted (withdrawn or too old), its events go too.
  ref             text not null references referral (ref) on delete cascade,
  status          text not null check (status in ('approved', 'declined')),
  created_at      timestamptz not null default now(),
  -- Retry bookkeeping. A row is finished once delivered_at (sent) or gave_up_at (no more tries) is set.
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  delivered_at    timestamptz,
  gave_up_at      timestamptz,
  -- The HTTP status of Helpdesk's last answer (null when there was no answer).
  last_status     integer
);

-- A partial index (it only covers rows still waiting), so the sender finds due events fast.
create index referral_event_pending_idx on referral_event (next_attempt_at)
  where delivered_at is null and gave_up_at is null;
-- Makes the cascade delete (finding the events of one ref) fast.
create index referral_event_ref_idx on referral_event (ref);

-- ---------------------------------------------------------------------------
-- Deny-all backstop, the same as 20261109000001_rebuild_schema.sql: row level security on, zero
-- policies, and no table rights for the browser roles. Only the server's service_role can use them.
-- ---------------------------------------------------------------------------
alter table referral       enable row level security;
alter table referral_event enable row level security;

-- Supabase gives new tables to anon and authenticated by default, so take those rights away again.
revoke all on table referral, referral_event from anon, authenticated;

-- ---------------------------------------------------------------------------
-- referral_row_json: what the application may read back about a referral, as JSON.
-- ---------------------------------------------------------------------------
-- Every function below returns referrals through this one door. Times are written in UTC with no
-- fractions of a second, like 2026-11-10T10:00:00Z, the same format as the webhook times.
-- A null decided_at stays null.
create function referral_row_json(r referral) returns jsonb
  language sql stable as $$
  select jsonb_build_object(
    'ref',         r.ref,
    'service_id',  r.service_id,
    'consent_at',  to_char(r.consent_at  at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'status',      r.status,
    'received_at', to_char(r.received_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'decided_at',  to_char(r.decided_at  at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
$$;

-- ---------------------------------------------------------------------------
-- decide_referral: a practitioner's Accept ('approved') or Decline ('declined').
-- ---------------------------------------------------------------------------
-- Results (a code, never an error, so the route can answer simply):
--   unknown ref                         {"code":"not_found"}
--   the same decision again             {"code":"ok","referral":{...}} and NO new event
--   already decided the other way       {"code":"invalid_transition"}
--   first decision                      {"code":"ok","referral":{...},"event_id":"evt-..."}
-- The status change and its outbox event are saved in the same transaction: both or neither.
create function decide_referral(p_ref text, p_status text)
returns jsonb language plpgsql as $$
declare
  v_row   referral%rowtype;
  v_event text;
begin
  -- "for update" locks this row until the function ends. A second practitioner clicking at the same
  -- moment waits here, then sees the first decision, so only one event is ever created.
  select * into v_row from referral where ref = p_ref for update;
  if not found then
    return jsonb_build_object('code', 'not_found');
  end if;

  -- Only a final status is a decision. Anything else (including null) is not a valid action.
  if p_status is null or p_status not in ('approved', 'declined') then
    return jsonb_build_object('code', 'invalid_transition');
  end if;

  -- A repeated click of the same decision changes nothing, so Helpdesk never gets a second callback.
  if v_row.status = p_status then
    return jsonb_build_object('code', 'ok', 'referral', referral_row_json(v_row));
  end if;

  -- A decision is final: an accepted referral cannot be declined later, or the other way round.
  if v_row.status <> 'received' then
    return jsonb_build_object('code', 'invalid_transition');
  end if;

  update referral
     set status = p_status, decided_at = now()
   where ref = p_ref
  returning * into v_row;

  -- The callback event carries only the ref and the status, never times or anything about a session.
  v_event := 'evt-' || gen_random_uuid()::text;
  insert into referral_event (event_id, ref, status)
  values (v_event, p_ref, p_status);

  return jsonb_build_object('code', 'ok', 'referral', referral_row_json(v_row), 'event_id', v_event);
end $$;

-- ---------------------------------------------------------------------------
-- purge_old_referrals: deletes referrals that arrived more than p_days days ago.
-- ---------------------------------------------------------------------------
-- We keep no data we no longer need. Their events are deleted with them ("on delete cascade").
-- Returns how many referrals were deleted. A null or negative p_days deletes nothing.
create function purge_old_referrals(p_days integer default 30)
returns integer language plpgsql as $$
declare
  v_count integer;
begin
  if p_days is null or p_days < 0 then
    return 0;
  end if;
  delete from referral where received_at < now() - make_interval(days => p_days);
  -- row_count is the number of rows the last statement deleted.
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Browser-facing roles can execute nothing; only the server's service role can.
-- The same two lines as 20261109000002_rebuild_functions.sql, run again so they also cover the new
-- functions above.
revoke execute on all functions in schema public from public, anon, authenticated;
grant  execute on all functions in schema public to service_role;
