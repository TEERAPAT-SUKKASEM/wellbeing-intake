-- Each function is one transaction. They return a result code rather than raising, so the route layer
-- can shape content-free responses.

-- What the application may read back about a request. The key hash never leaves the database.
create function request_row_json(r appointment_request) returns jsonb
  language sql stable as $$
  select to_jsonb(r) - 'access_key_hash' - 'submission_key' - 'decided_by' - 'decided_at';
$$;

-- ---------------------------------------------------------------------------
-- Outbox helpers. Superseded deliveries that have not gone out yet are neutralised first, so the
-- Hub can never receive an old time after a reschedule or a confirmation after a cancellation.
-- ---------------------------------------------------------------------------
create function neutralise_pending_events(p_reference text) returns void
  language sql as $$
  update outbound_event
     set failed_at = now(), payload = null
   where reference = p_reference and delivered_at is null and failed_at is null;
$$;

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
  if p_submission_key is not null then
    select * into v_row from appointment_request where submission_key = p_submission_key;
    if found then
      return jsonb_build_object('code', 'ok', 'created', false, 'request', request_row_json(v_row));
    end if;
  end if;

  select * into v_service from service where id = p_service and is_active;
  if not found then
    return jsonb_build_object('code', 'service_not_found');
  end if;

  if p_start <= now() then                                  -- server clock decides
    return jsonb_build_object('code', 'slot_unavailable');
  end if;

  v_end := p_start + make_interval(mins => v_service.duration_minutes);

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
      if p_submission_key is not null then
        select * into v_row from appointment_request where submission_key = p_submission_key;
        if found then
          return jsonb_build_object('code', 'ok', 'created', false, 'request', request_row_json(v_row));
        end if;
      end if;
      if sqlstate = '23P01' then                             -- exclusion_violation: someone else holds the time
        return jsonb_build_object('code', 'slot_unavailable');
      end if;
      raise;
  end;

  return jsonb_build_object('code', 'ok', 'created', true, 'request', request_row_json(v_row));
end $$;

-- ---------------------------------------------------------------------------
-- cancel_request_by_key: a wrong key is indistinguishable from a request that does not exist.
-- ---------------------------------------------------------------------------
create function cancel_request_by_key(p_id text, p_key_hash text)
returns jsonb language plpgsql as $$
declare
  v_row appointment_request%rowtype;
  v_was text;
begin
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
  if v_row.slot_start <= now() then
    return jsonb_build_object('code', 'too_late');
  end if;

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
create function decide_request(p_id text, p_actor uuid, p_status text, p_new_start timestamptz)
returns jsonb language plpgsql as $$
declare
  v_row       appointment_request%rowtype;
  v_duration  integer;
  v_end       timestamptz;
  v_was       text;
begin
  select * into v_row from appointment_request where id = p_id for update;
  if not found then
    return jsonb_build_object('code', 'not_found');
  end if;
  v_was := v_row.status;

  if p_status = 'CONFIRMED' then
    if v_was not in ('PENDING', 'CONFIRMED') then
      return jsonb_build_object('code', 'invalid_transition');
    end if;

    if p_new_start is not null and p_new_start <> v_row.slot_start then
      if p_new_start <= now() then
        return jsonb_build_object('code', 'slot_unavailable');
      end if;
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
      perform enqueue_confirmed(v_row);
      return jsonb_build_object('code', 'ok', 'notify', true, 'request', request_row_json(v_row));
    end if;

    if v_was = 'CONFIRMED' then                                  -- a repeated click sends no second event
      return jsonb_build_object('code', 'ok', 'notify', false, 'request', request_row_json(v_row));
    end if;
    if v_row.slot_start <= now() then
      return jsonb_build_object('code', 'slot_unavailable');
    end if;

    update appointment_request
       set status = 'CONFIRMED', decided_by = p_actor, decided_at = now()
     where id = p_id
    returning * into v_row;
    perform enqueue_confirmed(v_row);
    return jsonb_build_object('code', 'ok', 'notify', true, 'request', request_row_json(v_row));
  end if;

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

  return jsonb_build_object('code', 'invalid_transition');
end $$;

-- ---------------------------------------------------------------------------
-- Outbox delivery state
-- ---------------------------------------------------------------------------
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

create function mark_outbound_delivered(p_event uuid, p_status integer)
returns void language sql as $$
  update outbound_event
     set delivered_at = now(), last_status = p_status, payload = null
   where event_id = p_event and delivered_at is null;
$$;

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
create function set_availability(p_windows jsonb)
returns void language plpgsql as $$
begin
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
create function reset_demo_data() returns void
  language plpgsql security definer set search_path = public as $$
begin
  truncate table appointment_request, outbound_event, inbound_event, ai_call_budget,
                 request_rate_bucket, availability_window, staff, service
    restart identity cascade;
end $$;

-- Browser-facing roles can execute nothing; only the server's service role can.
revoke execute on all functions in schema public from public, anon, authenticated;
grant  execute on all functions in schema public to service_role;
