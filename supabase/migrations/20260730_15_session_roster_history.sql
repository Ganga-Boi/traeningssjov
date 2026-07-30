begin;

create table if not exists public.session_roster_snapshots (
  session_id uuid not null references public.sessions(id) on delete cascade,
  person_id uuid not null references public.people(id),
  name text not null,
  person_type text not null,
  payment_status text not null,
  balance_at_start integer,
  primary key (session_id, person_id)
);

alter table public.session_roster_snapshots enable row level security;
revoke all privileges on table public.session_roster_snapshots
from public, anon, authenticated;

create or replace function public.capture_session_roster()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.session_roster_snapshots(
    session_id,
    person_id,
    name,
    person_type,
    payment_status,
    balance_at_start
  )
  select
    new.id,
    person.id,
    person.name,
    person.type::text,
    person.payment_status::text,
    person.balance
  from public.people person
  where person.active = true
    and (
      person.type = 'gæst'::public.person_type
      or exists (
        select 1
        from public.class_memberships membership
        where membership.class_id = new.class_id
          and membership.person_id = person.id
          and membership.active = true
      )
    )
  on conflict (session_id, person_id) do nothing;

  return new;
end;
$$;

drop trigger if exists sessions_capture_roster
on public.sessions;
create trigger sessions_capture_roster
after insert on public.sessions
for each row execute function public.capture_session_roster();

create or replace function public.capture_attendee_in_session_roster()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.session_roster_snapshots(
    session_id,
    person_id,
    name,
    person_type,
    payment_status,
    balance_at_start
  )
  select
    new.session_id,
    person.id,
    person.name,
    person.type::text,
    person.payment_status::text,
    case
      when new.type = 'normal'::public.attendance_type
        then least(coalesce(new.balance_after, person.balance) + 1, 10)
      else person.balance
    end
  from public.people person
  where person.id = new.person_id
  on conflict (session_id, person_id) do nothing;

  return new;
end;
$$;

drop trigger if exists attendance_capture_roster
on public.attendance;
create trigger attendance_capture_roster
after insert on public.attendance
for each row execute function public.capture_attendee_in_session_roster();

create or replace function public.sync_future_membership_rosters()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.active = true then
    insert into public.session_roster_snapshots(
      session_id,
      person_id,
      name,
      person_type,
      payment_status,
      balance_at_start
    )
    select
      session.id,
      person.id,
      person.name,
      person.type::text,
      person.payment_status::text,
      person.balance
    from public.sessions session
    join public.people person
      on person.id = new.person_id
    where session.class_id = new.class_id
      and session.session_date >=
        (pg_catalog.now() at time zone 'Europe/Copenhagen')::date
      and person.active = true
    on conflict (session_id, person_id)
    do update set
      name = excluded.name,
      person_type = excluded.person_type,
      payment_status = excluded.payment_status,
      balance_at_start = excluded.balance_at_start;
  else
    delete from public.session_roster_snapshots snapshot
    using public.sessions session
    where snapshot.session_id = session.id
      and snapshot.person_id = new.person_id
      and session.class_id = new.class_id
      and session.session_date >=
        (pg_catalog.now() at time zone 'Europe/Copenhagen')::date;
  end if;

  return new;
end;
$$;

drop trigger if exists class_memberships_sync_future_rosters
on public.class_memberships;
create trigger class_memberships_sync_future_rosters
after insert or update of active on public.class_memberships
for each row execute function public.sync_future_membership_rosters();

create or replace function public.sync_future_person_rosters()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.active = false then
    delete from public.session_roster_snapshots snapshot
    using public.sessions session
    where snapshot.session_id = session.id
      and snapshot.person_id = new.id
      and session.session_date >=
        (pg_catalog.now() at time zone 'Europe/Copenhagen')::date;
  else
    update public.session_roster_snapshots snapshot
    set name = new.name,
        person_type = new.type::text,
        payment_status = new.payment_status::text,
        balance_at_start = new.balance
    from public.sessions session
    where snapshot.session_id = session.id
      and snapshot.person_id = new.id
      and session.session_date >=
        (pg_catalog.now() at time zone 'Europe/Copenhagen')::date;
  end if;

  return new;
end;
$$;

drop trigger if exists people_sync_future_rosters
on public.people;
create trigger people_sync_future_rosters
after update of name, type, payment_status, active on public.people
for each row execute function public.sync_future_person_rosters();

insert into public.session_roster_snapshots(
  session_id,
  person_id,
  name,
  person_type,
  payment_status,
  balance_at_start
)
select
  session.id,
  person.id,
  person.name,
  person.type::text,
  person.payment_status::text,
  person.balance
from public.sessions session
join public.people person
  on person.active = true
where person.type = 'gæst'::public.person_type
  or exists (
    select 1
    from public.class_memberships membership
    where membership.class_id = session.class_id
      and membership.person_id = person.id
      and membership.active = true
  )
on conflict (session_id, person_id) do nothing;

create or replace function public.get_class_roster_snapshot(
  p_class_id uuid,
  p_snapshot_date date
)
returns table (
  person_id uuid,
  name text,
  person_type text,
  payment_status text,
  clip_count integer,
  attended boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with selected_class as (
    select id, start_time, end_time
    from public.classes
    where id = p_class_id
  ),
  selected_session as (
    select id
    from public.sessions
    where class_id = p_class_id
      and session_date = p_snapshot_date
  ),
  context as (
    select
      (pg_catalog.now() at time zone 'Europe/Copenhagen')::date as today,
      (
        (p_snapshot_date + selected_class.end_time)
        at time zone 'Europe/Copenhagen'
      ) as cutoff_at
    from selected_class
  ),
  dynamic_person as (
    select membership.person_id
    from public.class_memberships membership
    where membership.class_id = p_class_id
      and membership.active = true

    union

    select guest.id
    from public.people guest
    cross join context
    where guest.type = 'gæst'::public.person_type
      and guest.active = true
      and guest.created_at <= context.cutoff_at
      and p_snapshot_date >= context.today
  ),
  roster as (
    select
      snapshot.person_id,
      snapshot.name,
      snapshot.person_type,
      snapshot.payment_status,
      snapshot.balance_at_start
    from public.session_roster_snapshots snapshot
    join selected_session session
      on session.id = snapshot.session_id
    cross join context
    where p_snapshot_date < context.today

    union all

    select
      person.id,
      person.name,
      person.type::text,
      person.payment_status::text,
      person.balance
    from dynamic_person dynamic
    join public.people person
      on person.id = dynamic.person_id
    cross join context
    where not (
      p_snapshot_date < context.today
      and exists (select 1 from selected_session)
    )
      and person.active = true
  ),
  historical_event as (
    select
      attendance.id as event_id,
      attendance.person_id,
      attendance.balance_after,
      (
        (session.session_date + training_class.end_time)
        at time zone 'Europe/Copenhagen'
      ) as event_time,
      2 as event_order
    from public.attendance attendance
    join public.sessions session
      on session.id = attendance.session_id
    join public.classes training_class
      on training_class.id = session.class_id

    union all

    select
      payment.id,
      payment.person_id,
      payment.balance_after,
      payment.paid_at,
      1
    from public.payments payment
  ),
  historical_balance as (
    select distinct on (event.person_id)
      event.person_id,
      event.balance_after
    from historical_event event
    cross join context
    where event.event_time <= context.cutoff_at
    order by
      event.person_id,
      event.event_time desc,
      event.event_order desc,
      event.event_id desc
  )
  select
    roster.person_id,
    roster.name,
    roster.person_type,
    roster.payment_status,
    case
      when roster.person_type = 'gæst' then null
      when p_snapshot_date < context.today
        then coalesce(
          historical_balance.balance_after,
          roster.balance_at_start
        )
      else roster.balance_at_start
    end,
    exists (
      select 1
      from public.attendance attendance
      join public.sessions session
        on session.id = attendance.session_id
      where attendance.person_id = roster.person_id
        and session.class_id = p_class_id
        and session.session_date = p_snapshot_date
    )
  from roster
  cross join context
  left join historical_balance
    on historical_balance.person_id = roster.person_id
  order by
    case when roster.person_type = 'gæst' then 0 else 1 end,
    roster.name;
$$;

revoke all on function public.get_class_roster_snapshot(uuid, date)
from public;
grant execute on function public.get_class_roster_snapshot(uuid, date)
to anon, authenticated;

commit;

notify pgrst, 'reload schema';
