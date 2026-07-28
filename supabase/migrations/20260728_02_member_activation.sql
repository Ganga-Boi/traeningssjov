begin;

alter table public.people
  add column if not exists active boolean not null default true;

create or replace function public.deactivate_member(
  p_person_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.people
  set active = false,
      updated_at = now()
  where id = p_person_id
    and type = 'medlem'::public.person_type
    and active = true;

  return found;
end;
$$;

create or replace function public.reactivate_member(
  p_person_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.people
  set active = true,
      updated_at = now()
  where id = p_person_id
    and type = 'medlem'::public.person_type
    and active = false;

  return found;
end;
$$;

create or replace function public.get_inactive_members(
  p_class_id uuid
) returns table (
  person_id uuid,
  name text,
  balance integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    person.id,
    person.name,
    person.balance
  from public.class_memberships membership
  join public.people person
    on person.id = membership.person_id
  where membership.class_id = p_class_id
    and membership.active = true
    and person.type = 'medlem'::public.person_type
    and person.active = false
  order by person.name;
$$;

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
security definer
set search_path = public
as $$
  with selected_class as (
    select id, start_time, end_time
    from public.classes
    where id = p_class_id
  ),
  cutoff as (
    select
      p_snapshot_date::timestamp
      + coalesce(end_time, start_time, time '23:59') as cutoff_at
    from selected_class
  ),
  context as (
    select
      ((now() at time zone 'Europe/Copenhagen')::date) as today
  )
  select
    person.id,
    person.name,
    person.type::text,
    person.payment_status::text,
    case
      when person.type = 'gæst'::public.person_type then null
      else coalesce(
        (
          select transaction.clip_count_after
          from public.clip_transactions transaction,
               cutoff
          where transaction.person_id = person.id
            and transaction.transaction_date <= cutoff.cutoff_at
          order by
            transaction.transaction_date desc,
            transaction.created_at desc
          limit 1
        ),
        person.balance
      )
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
  from public.class_memberships membership
  join public.people person
    on person.id = membership.person_id
  cross join context
  where membership.class_id = p_class_id
    and membership.active = true
    and (
      person.active = true
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
    )
  order by
    case when person.type = 'gæst'::public.person_type then 0 else 1 end,
    person.name;
$$;

revoke all on function public.deactivate_member(uuid) from public;
revoke all on function public.reactivate_member(uuid) from public;
revoke all on function public.get_inactive_members(uuid) from public;

grant execute on function public.deactivate_member(uuid) to anon, authenticated;
grant execute on function public.reactivate_member(uuid) to anon, authenticated;
grant execute on function public.get_inactive_members(uuid) to anon, authenticated;

commit;

notify pgrst, 'reload schema';
