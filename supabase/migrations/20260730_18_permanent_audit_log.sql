begin;

create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamp with time zone not null default pg_catalog.now(),
  action_type text not null,
  entity_type text not null,
  entity_id uuid,
  person_id uuid,
  session_id uuid,
  balance_before integer,
  balance_after integer,
  actor_role text not null,
  details jsonb not null default '{}'::jsonb
);

create index if not exists audit_events_person_time_idx
on public.audit_events(person_id, occurred_at desc);

create index if not exists audit_events_session_time_idx
on public.audit_events(session_id, occurred_at desc);

alter table public.audit_events enable row level security;

revoke all privileges on table public.audit_events
from public, anon, authenticated;
grant select on table public.audit_events to service_role;

create or replace function public.capture_audit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action_type text;
  v_entity_id uuid;
  v_person_id uuid;
  v_session_id uuid;
  v_balance_before integer;
  v_balance_after integer;
  v_details jsonb;
  v_actor_role text;
begin
  if pg_catalog.current_setting('app.audit_disabled', true) = 'true' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  v_actor_role := coalesce(
    nullif(
      pg_catalog.current_setting('request.jwt.claim.role', true),
      ''
    ),
    current_user
  );

  if tg_table_name = 'attendance' then
    if tg_op = 'DELETE' then
      v_entity_id := old.id;
      v_person_id := old.person_id;
      v_session_id := old.session_id;
    else
      v_entity_id := new.id;
      v_person_id := new.person_id;
      v_session_id := new.session_id;
    end if;

    if tg_op = 'INSERT' then
      v_action_type := 'attendance_registered';
      v_balance_before := case
        when new.balance_after is null then null
        else least(new.balance_after + 1, 10)
      end;
      v_balance_after := new.balance_after;
      v_details := jsonb_build_object(
        'attendance_type', new.type::text
      );
    elsif tg_op = 'DELETE' then
      v_action_type := 'attendance_removed';
      v_balance_before := old.balance_after;
      v_balance_after := case
        when old.balance_after is null then null
        else least(old.balance_after + 1, 10)
      end;
      v_details := jsonb_build_object(
        'attendance_type', old.type::text
      );
    else
      v_action_type := 'attendance_corrected';
      v_balance_before := old.balance_after;
      v_balance_after := new.balance_after;
      v_details := jsonb_build_object(
        'old', to_jsonb(old),
        'new', to_jsonb(new)
      );
    end if;

  elsif tg_table_name = 'payments' then
    if tg_op = 'DELETE' then
      v_entity_id := old.id;
      v_person_id := old.person_id;
    else
      v_entity_id := new.id;
      v_person_id := new.person_id;
    end if;

    if tg_op = 'INSERT' then
      v_action_type := case
        when new.reversed_payment_id is null
          then 'payment_registered'
        else 'payment_reversed'
      end;
      v_balance_before := new.balance_after - new.clips;
      v_balance_after := new.balance_after;
      v_details := jsonb_build_object(
        'amount_ore', new.amount_ore,
        'clips', new.clips,
        'reversed_payment_id', new.reversed_payment_id,
        'note', new.note
      );
    elsif tg_op = 'DELETE' then
      v_action_type := 'payment_deleted';
      v_balance_before := old.balance_after;
      v_balance_after := null;
      v_details := to_jsonb(old);
    else
      v_action_type := 'payment_corrected';
      v_balance_before := old.balance_after;
      v_balance_after := new.balance_after;
      v_details := jsonb_build_object(
        'old', to_jsonb(old),
        'new', to_jsonb(new)
      );
    end if;

  elsif tg_table_name = 'people' then
    if tg_op = 'DELETE' then
      v_entity_id := old.id;
      v_balance_before := old.balance;
      v_balance_after := null;
    elsif tg_op = 'INSERT' then
      v_entity_id := new.id;
      v_balance_before := null;
      v_balance_after := new.balance;
    else
      v_entity_id := new.id;
      v_balance_before := old.balance;
      v_balance_after := new.balance;
    end if;
    v_person_id := v_entity_id;

    if tg_op = 'INSERT' then
      v_action_type := case
        when new.type = 'gæst'::public.person_type
          then 'guest_created'
        else 'member_created'
      end;
      v_balance_before := null;
      v_details := jsonb_build_object(
        'name', new.name,
        'person_type', new.type::text
      );
    elsif tg_op = 'DELETE' then
      v_action_type := 'person_deleted';
      v_balance_after := null;
      v_details := jsonb_build_object(
        'name', old.name,
        'person_type', old.type::text
      );
    elsif old.type = 'gæst'::public.person_type
      and new.type = 'medlem'::public.person_type
    then
      v_action_type := 'guest_converted';
      v_details := jsonb_build_object('name', new.name);
    elsif old.type = 'medlem'::public.person_type
      and new.type = 'gæst'::public.person_type
    then
      v_action_type := 'guest_conversion_reversed';
      v_details := jsonb_build_object('name', new.name);
    elsif old.active is distinct from new.active then
      v_action_type := case
        when new.active then 'member_reactivated'
        else 'member_deactivated'
      end;
      v_details := jsonb_build_object('name', new.name);
    elsif old.balance is distinct from new.balance then
      v_action_type := 'balance_changed';
      v_details := jsonb_build_object(
        'name', new.name,
        'reason', 'database_update'
      );
    else
      v_action_type := 'person_updated';
      v_details := jsonb_build_object(
        'old_name', old.name,
        'new_name', new.name,
        'old_payment_status', old.payment_status::text,
        'new_payment_status', new.payment_status::text
      );
    end if;

  elsif tg_table_name = 'sessions' then
    if tg_op = 'DELETE' then
      v_entity_id := old.id;
    else
      v_entity_id := new.id;
    end if;
    v_session_id := v_entity_id;

    if tg_op = 'INSERT' then
      v_action_type := 'session_created';
      v_details := jsonb_build_object(
        'class_id', new.class_id,
        'session_date', new.session_date,
        'status', new.status
      );
    elsif tg_op = 'DELETE' then
      v_action_type := 'session_deleted';
      v_details := to_jsonb(old);
    elsif old.status is distinct from new.status then
      v_action_type := case
        when new.status = 'aflyst' then 'session_cancelled'
        else 'session_reopened'
      end;
      v_details := jsonb_build_object(
        'old_status', old.status,
        'new_status', new.status,
        'session_date', new.session_date
      );
    else
      v_action_type := 'session_updated';
      v_details := jsonb_build_object(
        'old', to_jsonb(old),
        'new', to_jsonb(new)
      );
    end if;

  elsif tg_table_name = 'class_memberships' then
    v_entity_id := null;
    if tg_op = 'DELETE' then
      v_person_id := old.person_id;
    else
      v_person_id := new.person_id;
    end if;

    if tg_op = 'INSERT' then
      v_action_type := 'membership_added';
      v_details := jsonb_build_object(
        'class_id', new.class_id,
        'active', new.active
      );
    elsif tg_op = 'DELETE' then
      v_action_type := 'membership_removed';
      v_details := jsonb_build_object(
        'class_id', old.class_id,
        'active', old.active
      );
    else
      v_action_type := case
        when new.active then 'membership_reactivated'
        else 'membership_deactivated'
      end;
      v_details := jsonb_build_object(
        'class_id', new.class_id,
        'old_active', old.active,
        'new_active', new.active
      );
    end if;
  else
    raise exception 'AUDIT_TABLE_NOT_SUPPORTED: %', tg_table_name;
  end if;

  insert into public.audit_events(
    action_type,
    entity_type,
    entity_id,
    person_id,
    session_id,
    balance_before,
    balance_after,
    actor_role,
    details
  )
  values (
    v_action_type,
    tg_table_name,
    v_entity_id,
    v_person_id,
    v_session_id,
    v_balance_before,
    v_balance_after,
    v_actor_role,
    coalesce(v_details, '{}'::jsonb)
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.capture_audit_event()
from public, anon, authenticated;

drop trigger if exists attendance_audit_log on public.attendance;
create trigger attendance_audit_log
after insert or update or delete on public.attendance
for each row execute function public.capture_audit_event();

drop trigger if exists payments_audit_log on public.payments;
create trigger payments_audit_log
after insert or update or delete on public.payments
for each row execute function public.capture_audit_event();

drop trigger if exists people_audit_log on public.people;
create trigger people_audit_log
after insert or update or delete on public.people
for each row execute function public.capture_audit_event();

drop trigger if exists sessions_audit_log on public.sessions;
create trigger sessions_audit_log
after insert or update or delete on public.sessions
for each row execute function public.capture_audit_event();

drop trigger if exists class_memberships_audit_log
on public.class_memberships;
create trigger class_memberships_audit_log
after insert or update or delete on public.class_memberships
for each row execute function public.capture_audit_event();

create or replace function public.get_audit_events(
  p_person_id uuid default null,
  p_session_id uuid default null,
  p_limit integer default 200
)
returns table (
  id bigint,
  occurred_at timestamp with time zone,
  action_type text,
  entity_type text,
  entity_id uuid,
  person_id uuid,
  session_id uuid,
  balance_before integer,
  balance_after integer,
  actor_role text,
  details jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    event.id,
    event.occurred_at,
    event.action_type,
    event.entity_type,
    event.entity_id,
    event.person_id,
    event.session_id,
    event.balance_before,
    event.balance_after,
    event.actor_role,
    event.details
  from public.audit_events event
  where (p_person_id is null or event.person_id = p_person_id)
    and (p_session_id is null or event.session_id = p_session_id)
  order by event.occurred_at desc, event.id desc
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
$$;

revoke all on function public.get_audit_events(uuid, uuid, integer)
from public, anon, authenticated;
grant execute on function public.get_audit_events(uuid, uuid, integer)
to service_role;

create or replace function public.reset_all_test_data(
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attendance_count integer;
  v_payment_count integer;
  v_session_count integer;
  v_guest_count integer;
  v_member_count integer;
  v_test_guest_ids uuid[];
begin
  if p_confirmation <> 'NULSTIL ALLE TESTDATA' then
    raise exception 'RESET_CONFIRMATION_REQUIRED';
  end if;

  select coalesce(
    array_agg(distinct person.id),
    array[]::uuid[]
  )
  into v_test_guest_ids
  from public.people person
  where person.type = 'gæst'::public.person_type
    or person.balance is null
    or exists (
      select 1
      from public.payments conversion
      where conversion.person_id = person.id
        and conversion.note = 'Gæstekonvertering registreret af Randi'
    );

  v_guest_count := cardinality(v_test_guest_ids);

  select count(*) into v_attendance_count from public.attendance;
  select count(*) into v_payment_count from public.payments;
  select count(*) into v_session_count from public.sessions;

  perform pg_catalog.set_config('app.audit_disabled', 'true', true);

  truncate table
    public.audit_events,
    public.session_roster_snapshots,
    public.attendance,
    public.payments,
    public.sessions
  restart identity;

  delete from public.class_memberships
  where person_id = any(v_test_guest_ids);

  delete from public.people
  where id = any(v_test_guest_ids);

  update public.people
  set balance = 10,
      payment_status = 'ok'::public.payment_status,
      updated_at = pg_catalog.now()
  where type = 'medlem'::public.person_type;

  get diagnostics v_member_count = row_count;

  perform pg_catalog.set_config('app.audit_disabled', 'false', true);

  insert into public.audit_events(
    action_type,
    entity_type,
    actor_role,
    details
  )
  values (
    'test_data_reset',
    'system',
    current_user,
    jsonb_build_object(
      'attendance_deleted', v_attendance_count,
      'payments_deleted', v_payment_count,
      'sessions_deleted', v_session_count,
      'guests_deleted', v_guest_count,
      'members_reset', v_member_count
    )
  );

  return jsonb_build_object(
    'attendance_deleted', v_attendance_count,
    'payments_deleted', v_payment_count,
    'sessions_deleted', v_session_count,
    'guests_deleted', v_guest_count,
    'members_reset', v_member_count
  );
end;
$$;

revoke all on function public.reset_all_test_data(text)
from public, anon, authenticated;
grant execute on function public.reset_all_test_data(text)
to service_role;

commit;

notify pgrst, 'reload schema';
