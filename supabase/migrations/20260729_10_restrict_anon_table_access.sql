begin;

create or replace function public.create_guest_for_session(
  p_name text,
  p_session_id uuid
) returns public.people
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_session public.sessions;
  v_person public.people;
begin
  v_name := btrim(p_name);

  if v_name is null or char_length(v_name) = 0 then
    raise exception 'INVALID_PERSON_NAME';
  end if;

  select * into v_session
  from public.sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  if v_session.status = 'aflyst' then
    raise exception 'SESSION_CANCELLED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(lower(v_name), 0)
  );

  if exists (
    select 1
    from public.people
    where lower(btrim(name)) = lower(v_name)
  ) then
    raise exception 'PERSON_ALREADY_EXISTS';
  end if;

  insert into public.people(
    name,
    type,
    balance,
    payment_status,
    privacy_notice_given_at,
    active
  )
  values (
    v_name,
    'gæst'::public.person_type,
    null,
    'skal_betale'::public.payment_status,
    pg_catalog.now(),
    true
  )
  returning * into v_person;

  insert into public.class_memberships(
    class_id,
    person_id,
    active
  )
  values (
    v_session.class_id,
    v_person.id,
    true
  )
  on conflict (class_id, person_id)
  do update set active = true;

  insert into public.attendance(
    person_id,
    session_id,
    session_key,
    type,
    balance_after,
    attended_at
  )
  values (
    v_person.id,
    p_session_id,
    'session:' || p_session_id::text,
    'prøvetime'::public.attendance_type,
    null,
    pg_catalog.now()
  );

  update public.sessions
  set status = 'afholdt'
  where id = p_session_id
    and status = 'planlagt';

  return v_person;
end;
$$;

revoke all on function public.create_guest_for_session(text, uuid)
from public;
grant execute on function public.create_guest_for_session(text, uuid)
to anon, authenticated;

drop policy if exists "anon attendance" on public.attendance;
drop policy if exists "anon can create attendance" on public.attendance;
drop policy if exists "anon can read attendance" on public.attendance;
drop policy if exists "anon class memberships" on public.class_memberships;
drop policy if exists "Public read classes" on public.classes;
drop policy if exists "anon can read classes" on public.classes;
drop policy if exists "anon classes" on public.classes;
drop policy if exists "anon clip transactions" on public.clip_transactions;
drop policy if exists "anon can create payments" on public.payments;
drop policy if exists "anon can read payments" on public.payments;
drop policy if exists "anon payments" on public.payments;
drop policy if exists "anon can read people" on public.people;
drop policy if exists "anon can update people" on public.people;
drop policy if exists "anon people" on public.people;
drop policy if exists "anon can create sessions" on public.sessions;
drop policy if exists "anon can read sessions" on public.sessions;
drop policy if exists "anon sessions" on public.sessions;

revoke all privileges on table public.attendance from anon;
revoke all privileges on table public.class_memberships from anon;
revoke all privileges on table public.classes from anon;
revoke all privileges on table public.clip_transactions from anon;
revoke all privileges on table public.payments from anon;
revoke all privileges on table public.people from anon;
revoke all privileges on table public.sessions from anon;

grant select (person_id, session_id)
on public.attendance to anon;
grant select (id, name, weekday, start_time, end_time, active)
on public.classes to anon;
grant select (id, balance)
on public.people to anon;
grant select (id, class_id, session_date, status)
on public.sessions to anon;

create policy "anon reads attendance"
on public.attendance
for select to anon
using (true);

create policy "anon reads active classes"
on public.classes
for select to anon
using (active = true);

create policy "anon reads person balances"
on public.people
for select to anon
using (true);

create policy "anon reads sessions"
on public.sessions
for select to anon
using (true);

commit;

notify pgrst, 'reload schema';
