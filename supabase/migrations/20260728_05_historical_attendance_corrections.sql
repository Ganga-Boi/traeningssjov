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
set search_path = public
as $$
  with selected_class as (
    select id, start_time, end_time
    from public.classes
    where id = p_class_id
  ),
  context as (
    select
      (now() at time zone 'Europe/Copenhagen')::date as today,
      (
        (p_snapshot_date + selected_class.end_time)
        at time zone 'Europe/Copenhagen'
      ) as cutoff_at
    from selected_class
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
  from public.class_memberships membership
  join public.people person
    on person.id = membership.person_id
  cross join context
  left join historical_balance
    on historical_balance.person_id = person.id
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

create or replace function public.correct_historical_attendance(
  p_person_id uuid,
  p_session_id uuid,
  p_should_attend boolean
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person public.people;
  v_session public.sessions;
  v_class public.classes;
  v_attendance public.attendance;
  v_target_time timestamptz;
  v_today date;
  v_prior_balance integer;
  v_delta integer := 0;
  v_next_payment_at timestamptz;
  v_new_current_balance integer;
begin
  v_today := (now() at time zone 'Europe/Copenhagen')::date;

  select * into v_session
  from public.sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  if v_session.session_date >= v_today then
    raise exception 'SESSION_IS_NOT_HISTORICAL';
  end if;

  if v_session.status = 'aflyst' then
    raise exception 'SESSION_CANCELLED';
  end if;

  select * into v_class
  from public.classes
  where id = v_session.class_id;

  if not found then
    raise exception 'CLASS_NOT_FOUND';
  end if;

  v_target_time := (
    (v_session.session_date + v_class.end_time)
    at time zone 'Europe/Copenhagen'
  );

  select * into v_person
  from public.people
  where id = p_person_id
  for update;

  if not found then
    raise exception 'PERSON_NOT_FOUND';
  end if;

  select * into v_attendance
  from public.attendance
  where person_id = p_person_id
    and session_id = p_session_id
  for update;

  if p_should_attend and found then
    return false;
  end if;

  if not p_should_attend and not found then
    return false;
  end if;

  if not p_should_attend then
    if v_attendance.type = 'normal'::public.attendance_type then
      v_delta := 1;
    end if;

    delete from public.attendance
    where id = v_attendance.id;
  elsif v_person.type = 'gæst'::public.person_type then
    insert into public.attendance(
      person_id,
      session_id,
      session_key,
      type,
      balance_after,
      attended_at
    )
    values (
      p_person_id,
      p_session_id,
      'session:' || p_session_id::text,
      'prøvetime'::public.attendance_type,
      null,
      now()
    );
  else
    select event.balance_after
    into v_prior_balance
    from (
      select
        attendance.id as event_id,
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
      where attendance.person_id = p_person_id

      union all

      select
        payment.id,
        payment.balance_after,
        payment.paid_at,
        1
      from public.payments payment
      where payment.person_id = p_person_id
    ) event
    where event.event_time < v_target_time
    order by
      event.event_time desc,
      event.event_order desc,
      event.event_id desc
    limit 1;

    if v_prior_balance is null then
      raise exception 'HISTORY_BASELINE_MISSING';
    end if;

    if v_prior_balance <= 0 then
      raise exception 'PAYMENT_REQUIRED';
    end if;

    v_delta := -1;

    insert into public.attendance(
      person_id,
      session_id,
      session_key,
      type,
      balance_after,
      attended_at
    )
    values (
      p_person_id,
      p_session_id,
      'session:' || p_session_id::text,
      'normal'::public.attendance_type,
      v_prior_balance - 1,
      now()
    );
  end if;

  if v_delta <> 0 then
    select min(payment.paid_at)
    into v_next_payment_at
    from public.payments payment
    where payment.person_id = p_person_id
      and payment.paid_at > v_target_time;

    if exists (
      select 1
      from public.attendance later_attendance
      join public.sessions later_session
        on later_session.id = later_attendance.session_id
      join public.classes later_class
        on later_class.id = later_session.class_id
      where later_attendance.person_id = p_person_id
        and later_attendance.type = 'normal'::public.attendance_type
        and (
          (later_session.session_date + later_class.end_time)
          at time zone 'Europe/Copenhagen'
        ) > v_target_time
        and (
          v_next_payment_at is null
          or (
            (later_session.session_date + later_class.end_time)
            at time zone 'Europe/Copenhagen'
          ) < v_next_payment_at
        )
        and (
          later_attendance.balance_after + v_delta < 0
          or later_attendance.balance_after + v_delta > 10
        )
    ) then
      raise exception 'HISTORICAL_BALANCE_OUT_OF_RANGE';
    end if;

    update public.attendance attendance_to_update
    set balance_after = attendance_to_update.balance_after + v_delta
    from public.sessions later_session,
         public.classes later_class
    where later_session.id = attendance_to_update.session_id
      and later_class.id = later_session.class_id
      and attendance_to_update.person_id = p_person_id
      and attendance_to_update.type = 'normal'::public.attendance_type
      and (
        (later_session.session_date + later_class.end_time)
        at time zone 'Europe/Copenhagen'
      ) > v_target_time
      and (
        v_next_payment_at is null
        or (
          (later_session.session_date + later_class.end_time)
          at time zone 'Europe/Copenhagen'
        ) < v_next_payment_at
      );

    if v_next_payment_at is null then
      v_new_current_balance := coalesce(v_person.balance, 0) + v_delta;

      if v_new_current_balance < 0 or v_new_current_balance > 10 then
        raise exception 'CURRENT_BALANCE_OUT_OF_RANGE';
      end if;

      update public.people
      set balance = v_new_current_balance,
          payment_status = case
            when v_new_current_balance = 0
              then 'skal_betale'::public.payment_status
            else 'ok'::public.payment_status
          end,
          updated_at = now()
      where id = p_person_id;
    end if;
  end if;

  update public.sessions
  set status = case
    when exists (
      select 1
      from public.attendance
      where session_id = p_session_id
    ) then 'afholdt'
    else 'planlagt'
  end
  where id = p_session_id;

  return true;
end;
$$;

revoke all on function public.correct_historical_attendance(uuid, uuid, boolean)
from public;
grant execute on function public.correct_historical_attendance(uuid, uuid, boolean)
to anon, authenticated;

commit;

notify pgrst, 'reload schema';
