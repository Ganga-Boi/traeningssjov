begin;

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
  context as (
    select
      (pg_catalog.now() at time zone 'Europe/Copenhagen')::date as today,
      (
        (p_snapshot_date + selected_class.end_time)
        at time zone 'Europe/Copenhagen'
      ) as cutoff_at
    from selected_class
  ),
  roster_person as (
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
    person.id,
    person.name,
    person.type::text,
    person.payment_status::text,
    case
      when person.type = 'gæst'::public.person_type then null
      when p_snapshot_date < context.today then historical_balance.balance_after
      else person.balance
    end,
    exists (
      select 1
      from public.attendance attendance
      join public.sessions session
        on session.id = attendance.session_id
      where attendance.person_id = person.id
        and session.class_id = p_class_id
        and session.session_date = p_snapshot_date
    )
  from roster_person roster
  join public.people person
    on person.id = roster.person_id
  cross join context
  left join historical_balance
    on historical_balance.person_id = person.id
  where person.active = true
    or (
      p_snapshot_date < context.today
      and exists (
        select 1
        from public.attendance historical_attendance
        join public.sessions historical_session
          on historical_session.id = historical_attendance.session_id
        where historical_attendance.person_id = person.id
          and historical_session.class_id = p_class_id
          and historical_session.session_date = p_snapshot_date
      )
    )
  order by
    case when person.type = 'gæst'::public.person_type then 0 else 1 end,
    person.name;
$$;

revoke all on function public.get_class_roster_snapshot(uuid, date)
from public;
grant execute on function public.get_class_roster_snapshot(uuid, date)
to anon, authenticated;

commit;

notify pgrst, 'reload schema';
