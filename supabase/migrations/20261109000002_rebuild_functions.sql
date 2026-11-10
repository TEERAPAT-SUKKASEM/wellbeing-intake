-- What this file does: the database functions that book, cancel and decide requests, fill and run
-- the webhook outbox, count budgets, set opening hours and reset the demo data.
-- Why it exists: each change happens inside one function, so all its steps succeed or fail together,
-- and two people clicking at the same moment cannot leave the data half-changed.
-- Key idea: the database is the final judge. Even if two bookings pass the app's checks at the same
-- time, the exclusion constraint lets only one of them take the slot.
--
-- Each function is one transaction. They return a result code rather than raising, so the route layer
-- can shape content-free responses.

-- What the application may read back about a request. The key hash never leaves the database.
-- request_row_json turns one row into JSON and removes ("-") the key hash, the submission key and
-- which staff member decided. Every function below returns rows through this one door.
create function request_row_json(r appointment_request) returns jsonb
  language sql stable as $$
  select to_jsonb(r) - 'access_key_hash' - 'submission_key' - 'decided_by' - 'decided_at';
$$;

-- ---------------------------------------------------------------------------
-- Outbox helpers. Superseded deliveries that have not gone out yet are neutralised first, so the
-- Hub can never receive an old time after a reschedule or a confirmation after a cancellation.
-- ---------------------------------------------------------------------------
-- neutralise_pending_events: stops every not-yet-sent event of one appointment. It marks them as
-- failed and deletes their payload, so the dispatcher will never send them.
create function neutralise_pending_events(p_reference text) returns void
  language sql as $$
  update outbound_event
     set failed_at = now(), payload = null
   where reference = p_reference and delivered_at is null and failed_at is null;
$$;

-- enqueue_confirmed: puts an appointment.confirmed event in the outbox, with exactly the four PRD
-- fields. Older unsent events of the same appointment are neutralised first. Times are written in
-- UTC, like 2026-11-10T10:00:00Z.
create function enqueue_confirmed(r appointment_request) returns void
  language plpgsql as $$
begin
  perform neutralise_pending_events(r.id);
  insert into outbound_event (type, reference, payload)
  values ('appointment.confirmed', r.id, jsonb_build_object(
    'event_type', 'appointment.confirmed',
    'appointment_id', r.id,
    'scheduled_time', to_char(r.slot_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'privacy_buffer_end', to_char(r.buffer_end at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
end $$;

-- enqueue_cancelled: puts an appointment.cancelled event (event type and id only) in the outbox,
-- after neutralising older unsent events of the same appointment.
create function enqueue_cancelled(r appointment_request) returns void
  language plpgsql as $$
begin
  perform neutralise_pending_events(r.id);
  insert into outbound_event (type, reference, payload)
  values ('appointment.cancelled', r.id, jsonb_build_object(
    'event_type', 'appointment.cancelled',
    'appointment_id', r.id));
end $$;

-- ---------------------------------------------------------------------------
-- create_appointment_request: the buffer rule is decided by the exclusion constraint.
-- ---------------------------------------------------------------------------
-- Books one new anonymous request. The steps:
--   1. Replay check: if this submission_key was used before, return that row (created = false).
--   2. The service must exist and be active.
--   3. The start must be in the future, by the database clock.
--   4. Insert. The end and the buffer end are worked out here from the service, never sent in.
-- The app has already checked that the start is on the slot grid. Overlaps are decided only by the
-- exclusion constraint, at the moment of the insert.
create function create_appointment_request(
  p_key_hash       text,
  p_submission_key uuid,
  p_service        text,
  p_alias          text,
  p_note           text,
  p_urgency        text,
  p_mode           text,
  p_start          timestamptz
) returns jsonb language plpgsql as $$
declare
  v_service service%rowtype;
  v_row     appointment_request%rowtype;
  v_end     timestamptz;
begin
  -- A replay (the same submit sent again after a double click or a lost response) is safe: it finds
  -- the first row and returns it, so nothing is booked twice and the student gets the same answer.
  if p_submission_key is not null then
    select * into v_row from appointment_request where submission_key = p_submission_key;
    if found then
      return jsonb_build_object('code', 'ok', 'created', false, 'request', request_row_json(v_row));
    end if;
  end if;

  -- An inactive service cannot be booked.
  select * into v_service from service where id = p_service and is_active;
  if not found then
    return jsonb_build_object('code', 'service_not_found');
  end if;

  if p_start <= now() then                                  -- server clock decides
    return jsonb_build_object('code', 'slot_unavailable');
  end if;

  -- Session end = start + the service's duration. Buffer end = session end + 15 minutes.
  v_end := p_start + make_interval(mins => v_service.duration_minutes);

  -- An inner begin ... exception block. If the insert fails, only the insert is undone, and we can
  -- still return a clear result code instead of an error.
  begin
    insert into appointment_request
      (access_key_hash, submission_key, service_id, alias, intake_note, urgency_level, triage_mode,
       slot_start, slot_end, buffer_end)
    values
      (p_key_hash, p_submission_key, p_service, nullif(p_alias, ''), p_note, p_urgency, p_mode,
       p_start, v_end, v_end + interval '15 minutes')
    returning * into v_row;
  exception
    when exclusion_violation or unique_violation then
      -- The same submission racing itself is a retry, whichever constraint noticed first.
      -- (Both copies passed step 1 before either was saved. The second one now finds the first.)
      if p_submission_key is not null then
        select * into v_row from appointment_request where submission_key = p_submission_key;
        if found then
          return jsonb_build_object('code', 'ok', 'created', false, 'request', request_row_json(v_row));
        end if;
      end if;
      if sqlstate = '23P01' then                             -- exclusion_violation: someone else holds the time
        return jsonb_build_object('code', 'slot_unavailable');
      end if;
      -- Any other duplicate (for example the same key hash, which should never happen) is a real error.
      raise;
  end;

  return jsonb_build_object('code', 'ok', 'created', true, 'request', request_row_json(v_row));
end $$;

-- ---------------------------------------------------------------------------
-- cancel_request_by_key: a wrong key is indistinguishable from a request that does not exist.
-- ---------------------------------------------------------------------------
-- The student's anonymous cancel (PRD endpoint 5). The app sends the HASH of the access key, and the
-- row must match both the id and that hash. A wrong key gets the same "not_found" as a missing id,
-- so nobody can find out which request ids exist.
create function cancel_request_by_key(p_id text, p_key_hash text)
returns jsonb language plpgsql as $$
declare
  v_row appointment_request%rowtype;
  v_was text;
begin
  -- "for update" locks this row until the function ends. A practitioner's decision on the same
  -- request at the same moment waits, so the two changes cannot mix.
  select * into v_row from appointment_request
   where id = p_id and access_key_hash = p_key_hash
   for update;
  if not found then
    return jsonb_build_object('code', 'not_found');
  end if;

  if v_row.status = 'CANCELLED' then
    return jsonb_build_object('code', 'ok', 'notify', false);    -- a repeated click changes nothing
  end if;
  if v_row.status = 'REJECTED' then
    return jsonb_build_object('code', 'invalid_transition');
  end if;
  -- A session that has already started can no longer be cancelled online.
  if v_row.slot_start <= now() then
    return jsonb_build_object('code', 'too_late');
  end if;

  -- CANCELLED frees the slot and its buffer at once (TEST-04), because the exclusion constraint
  -- only covers live rows.
  v_was := v_row.status;
  update appointment_request set status = 'CANCELLED' where id = p_id returning * into v_row;

  -- The Hub only ever heard about confirmed appointments, so only those need a retraction.
  if v_was = 'CONFIRMED' then
    perform enqueue_cancelled(v_row);
  end if;
  return jsonb_build_object('code', 'ok', 'notify', v_was = 'CONFIRMED');
end $$;

-- ---------------------------------------------------------------------------
-- decide_request: the practitioner's Approve, Reschedule, Reject and Cancel actions.
--   CONFIRMED + no new time   approve a pending request
--   CONFIRMED + new time      reschedule, and confirm if it was still pending
--   REJECTED                  from pending only
--   CANCELLED                 from pending or confirmed
-- ---------------------------------------------------------------------------
-- p_actor is the staff id that is saved in decided_by. A repeated click of the same action returns
-- "ok" with notify = false, so the Hub never gets the same event twice.
create function decide_request(p_id text, p_actor uuid, p_status text, p_new_start timestamptz)
returns jsonb language plpgsql as $$
declare
  v_row       appointment_request%rowtype;
  v_duration  integer;
  v_end       timestamptz;
  v_was       text;
begin
  -- Lock the row first, so two practitioners (or a practitioner and a student) are served in turn.
  select * into v_row from appointment_request where id = p_id for update;
  if not found then
    return jsonb_build_object('code', 'not_found');
  end if;
  v_was := v_row.status;

  if p_status = 'CONFIRMED' then
    if v_was not in ('PENDING', 'CONFIRMED') then
      return jsonb_build_object('code', 'invalid_transition');
    end if;

    -- Reschedule: a new start time that is different from the current one.
    if p_new_start is not null and p_new_start <> v_row.slot_start then
      if p_new_start <= now() then
        return jsonb_build_object('code', 'slot_unavailable');
      end if;
      -- The new end and buffer end come from the service's duration, the same way as on create.
      select duration_minutes into v_duration from service where id = v_row.service_id;
      v_end := p_new_start + make_interval(mins => v_duration);
      begin
        -- Updating the row itself means it only conflicts with OTHER live requests.
        update appointment_request
           set slot_start = p_new_start, slot_end = v_end, buffer_end = v_end + interval '15 minutes',
               status = 'CONFIRMED', decided_by = p_actor, decided_at = now()
         where id = p_id
        returning * into v_row;
      exception when exclusion_violation then
        return jsonb_build_object('code', 'slot_unavailable');
      end;
      -- The Hub gets a new "confirmed" event with the new time; any older unsent one is neutralised.
      perform enqueue_confirmed(v_row);
      return jsonb_build_object('code', 'ok', 'notify', true, 'request', request_row_json(v_row));
    end if;

    if v_was = 'CONFIRMED' then                                  -- a repeated click sends no second event
      return jsonb_build_object('code', 'ok', 'notify', false, 'request', request_row_json(v_row));
    end if;
    -- Approve: only a pending request whose time has not started yet.
    if v_row.slot_start <= now() then
      return jsonb_build_object('code', 'slot_unavailable');
    end if;

    -- The outbox row is written in this same transaction, so a confirmation can never lose its event.
    update appointment_request
       set status = 'CONFIRMED', decided_by = p_actor, decided_at = now()
     where id = p_id
    returning * into v_row;
    perform enqueue_confirmed(v_row);
    return jsonb_build_object('code', 'ok', 'notify', true, 'request', request_row_json(v_row));
  end if;

  -- Reject: only a pending request. The Hub never heard about it, so no event is sent.
  if p_status = 'REJECTED' then
    if v_was = 'REJECTED' then
      return jsonb_build_object('code', 'ok', 'notify', false, 'request', request_row_json(v_row));
    end if;
    if v_was <> 'PENDING' then
      return jsonb_build_object('code', 'invalid_transition');
    end if;
    update appointment_request
       set status = 'REJECTED', decided_by = p_actor, decided_at = now()
     where id = p_id
    returning * into v_row;
    return jsonb_build_object('code', 'ok', 'notify', false, 'request', request_row_json(v_row));
  end if;

  -- Practitioner cancel: an event is sent only if the Hub was told before that it was confirmed.
  if p_status = 'CANCELLED' then
    if v_was = 'CANCELLED' then
      return jsonb_build_object('code', 'ok', 'notify', false, 'request', request_row_json(v_row));
    end if;
    if v_was not in ('PENDING', 'CONFIRMED') then
      return jsonb_build_object('code', 'invalid_transition');
    end if;
    update appointment_request
       set status = 'CANCELLED', decided_by = p_actor, decided_at = now()
     where id = p_id
    returning * into v_row;
    if v_was = 'CONFIRMED' then
      perform enqueue_cancelled(v_row);
    end if;
    return jsonb_build_object('code', 'ok', 'notify', v_was = 'CONFIRMED', 'request', request_row_json(v_row));
  end if;

  -- Any other status value is not a valid action.
  return jsonb_build_object('code', 'invalid_transition');
end $$;

-- ---------------------------------------------------------------------------
-- Outbox delivery state
-- ---------------------------------------------------------------------------
-- claim_outbound_events: gives the dispatcher up to p_limit events that are due to be sent.
-- "for update skip locked" locks the chosen rows, and a second dispatcher running at the same moment
-- skips locked rows instead of waiting, so two dispatchers never take the same event.
-- The lease (next_attempt_at moved into the future) keeps the rows hidden after this transaction
-- ends, while the dispatcher is still sending them. "attempts" counts every try.
create function claim_outbound_events(p_limit integer, p_lease interval)
returns setof outbound_event language plpgsql as $$
begin
  return query
  update outbound_event o
     set attempts = o.attempts + 1,
         next_attempt_at = now() + p_lease          -- lease: a concurrent dispatcher skips it
   where o.event_id in (
           select e.event_id from outbound_event e
            where e.delivered_at is null and e.failed_at is null and e.next_attempt_at <= now()
            order by e.next_attempt_at
            limit p_limit
            for update skip locked)
  returning o.*;
end $$;

-- mark_outbound_delivered: records a successful send and deletes the payload, because we keep no data
-- we no longer need. Calling it twice changes nothing ("delivered_at is null").
create function mark_outbound_delivered(p_event uuid, p_status integer)
returns void language sql as $$
  update outbound_event
     set delivered_at = now(), last_status = p_status, payload = null
   where event_id = p_event and delivered_at is null;
$$;

-- mark_outbound_attempt_failed: records a failed send and plans the next try with exponential
-- backoff (each wait is double the one before: base, 2 x base, 4 x base, ...). After p_max_attempts
-- tries, failed_at is set and the event is "parked": it is not tried again.
create function mark_outbound_attempt_failed(
  p_event uuid, p_status integer, p_base interval, p_max_attempts integer
) returns jsonb language plpgsql as $$
declare
  v_row outbound_event%rowtype;
begin
  update outbound_event
     set last_status = p_status,
         next_attempt_at = now() + (p_base * power(2, greatest(attempts - 1, 0))),
         failed_at = case when attempts >= p_max_attempts then now() else null end
   -- `failed_at is null`: never un-park a row that a later decision has neutralised
   where event_id = p_event and delivered_at is null and failed_at is null
  returning * into v_row;
  return jsonb_build_object('attempts', v_row.attempts,
                            'next_attempt_at', v_row.next_attempt_at,
                            'parked', v_row.failed_at is not null);
end $$;

-- ---------------------------------------------------------------------------
-- record_inbound_event: true only the first time an event id is seen
-- ---------------------------------------------------------------------------
-- Used for delivery receipts from the Notification Hub. "on conflict do nothing" means a receipt
-- that arrives twice is stored once, and the second call returns false.
create function record_inbound_event(
  p_event uuid, p_source text, p_type text, p_reference text, p_occurred timestamptz
) returns boolean language plpgsql as $$
declare
  v_inserted uuid;
begin
  insert into inbound_event (event_id, source, type, reference, occurred_at)
  values (p_event, p_source, p_type, p_reference, p_occurred)
  on conflict (event_id) do nothing
  returning event_id into v_inserted;
  return v_inserted is not null;
end $$;

-- ---------------------------------------------------------------------------
-- consume_request_budget: global hourly cap on anonymous submissions
-- ---------------------------------------------------------------------------
-- One statement adds 1 to this hour's counter, but only while the counter is below p_limit. When
-- the cap is reached, the update is skipped, nothing is returned, and the function returns false.
-- Because it is a single statement, many clients at once still cannot go over the cap.
-- consume_ai_budget (in the 20260920 migration) works the same way for AI calls, per day.
create function consume_request_budget(p_limit integer)
returns boolean language plpgsql as $$
declare
  v_calls integer;
begin
  if p_limit < 1 then
    return false;
  end if;
  insert into request_rate_bucket (hour, calls) values (date_trunc('hour', now()), 1)
  on conflict (hour) do update set calls = request_rate_bucket.calls + 1
    where request_rate_bucket.calls < p_limit
  returning calls into v_calls;
  return v_calls is not null;
end $$;

-- ---------------------------------------------------------------------------
-- set_availability: replaces the whole weekly calendar in one step. Existing requests keep their times.
-- ---------------------------------------------------------------------------
-- p_windows is a JSON list such as [{"weekday":1,"start_time":"09:00","end_time":"12:00"}].
-- The delete and the insert are one transaction, so nobody ever sees an empty calendar halfway.
-- Requests are not linked to windows, so changing the hours never moves or cancels a booking.
create function set_availability(p_windows jsonb)
returns void language plpgsql as $$
begin
  -- "where true" deletes every row. The explicit where keeps tools that refuse a bare DELETE happy.
  delete from availability_window where true;
  insert into availability_window (weekday, start_time, end_time)
  select w.weekday, w.start_time, w.end_time
    from jsonb_to_recordset(p_windows) as w(weekday smallint, start_time time, end_time time);
end $$;

-- ---------------------------------------------------------------------------
-- reset_demo_data: whole-dataset destruction; the seed script then reloads fixtures
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER: truncating with RESTART IDENTITY needs ownership of the sequences, which the
-- service role does not have. Execution is still granted to the service role only.
-- Called only by scripts/seed.ts before it loads the demo data again. "truncate" empties tables fast.
create function reset_demo_data() returns void
  language plpgsql security definer set search_path = public as $$
begin
  truncate table appointment_request, outbound_event, inbound_event, ai_call_budget,
                 request_rate_bucket, availability_window, staff, service
    restart identity cascade;
end $$;

-- Browser-facing roles can execute nothing; only the server's service role can.
-- So even with the public Supabase key, a browser cannot book, cancel or reset anything directly.
revoke execute on all functions in schema public from public, anon, authenticated;
grant  execute on all functions in schema public to service_role;
