-- Træningssjov: fast historisk klipsaldo pr. handling.
-- Kan køres flere gange. Sletter ingen personer, betalinger eller fremmøder.

begin;

alter table public.attendance
  add column if not exists balance_after integer;

alter table public.payments
  add column if not exists balance_after integer;

-- Backfill eksisterende historik baglæns fra personens nuværende saldo.
-- En betaling sætter altid saldoen til 10. Før betalingen var saldoen 0.
do $$
declare
  v_person record;
  v_event record;
  v_balance integer;
  v_event_balance integer;
begin
  for v_person in
    select id, balance
    from public.people
  loop
    v_balance := v_person.balance;

    for v_event in
      select *
      from (
        select
          2 as event_order,
          'attendance'::text as event_kind,
          attendance.id as event_id,
          coalesce(attendance.attended_at, attendance.created_at) as event_time,
          attendance.type::text as attendance_type,
          attendance.balance_after,
          null::integer as clips
        from public.attendance attendance
        where attendance.person_id = v_person.id

        union all

        select
          1 as event_order,
          'payment'::text as event_kind,
          payment.id as event_id,
          coalesce(payment.paid_at, payment.created_at) as event_time,
          null::text as attendance_type,
          payment.balance_after,
          payment.clips
        from public.payments payment
        where payment.person_id = v_person.id
      ) person_event
      order by
        person_event.event_time desc,
        person_event.event_order desc,
        person_event.event_id desc
    loop
      if v_event.event_kind = 'attendance' then
        if v_event.attendance_type = 'prøvetime' then
          update public.attendance
          set balance_after = null
          where id = v_event.event_id
            and balance_after is not null;
        else
          v_event_balance := greatest(
            0,
            least(coalesce(v_event.balance_after, v_balance, 0), 10)
          );

          update public.attendance
          set balance_after = v_event_balance
          where id = v_event.event_id
            and balance_after is null;

          v_balance := least(v_event_balance + 1, 10);
        end if;
      elsif v_event.clips > 0 then
        update public.payments
        set balance_after = 10
        where id = v_event.event_id
          and balance_after is distinct from 10;

        v_balance := 0;
      else
        v_event_balance := greatest(
          0,
          least(coalesce(v_event.balance_after, v_balance, 0), 10)
        );

        update public.payments
        set balance_after = v_event_balance
        where id = v_event.event_id
          and balance_after is null;

        v_balance := least(v_event_balance + abs(v_event.clips), 10);
      end if;
    end loop;
  end loop;
end;
$$;

-- Alle betalinger skal have et fast øjebliksbillede efter backfill.
update public.payments
set balance_after = case
  when clips > 0 then 10
  else 0
end
where balance_after is null;

alter table public.attendance
  drop constraint if exists attendance_balance_after_range;

alter table public.attendance
  add constraint attendance_balance_after_range check (
    balance_after is null or balance_after between 0 and 10
  );

alter table public.payments
  drop constraint if exists payments_balance_after_range;

alter table public.payments
  add constraint payments_balance_after_range check (
    balance_after between 0 and 10
  );

alter table public.payments
  alter column balance_after set not null;

create or replace function public.register_attendance_for_session(
  p_person_id uuid,
  p_session_id uuid,
  p_type public.attendance_type default 'normal'
) returns public.attendance
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.sessions;
  v_person public.people;
  v_attendance public.attendance;
  v_new_balance integer;
begin
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
    and session_id = p_session_id;

  if found then
    return v_attendance;
  end if;

  if v_person.type = 'medlem'::public.person_type then
    if p_type::text <> 'normal' then
      raise exception 'ATTENDANCE_TYPE_NOT_ALLOWED';
    end if;

    if v_person.balance is null or v_person.balance <= 0 then
      raise exception 'PAYMENT_REQUIRED';
    end if;

    v_new_balance := v_person.balance - 1;
  else
    if p_type::text <> 'prøvetime' then
      raise exception 'ATTENDANCE_TYPE_NOT_ALLOWED';
    end if;

    if exists (
      select 1
      from public.attendance previous_attendance
      join public.sessions previous_session
        on previous_session.id = previous_attendance.session_id
      where previous_attendance.person_id = p_person_id
        and previous_attendance.type::text = 'prøvetime'
        and previous_session.session_date < v_session.session_date
    ) then
      raise exception 'PAYMENT_REQUIRED';
    end if;
  end if;

  insert into public.attendance(
    person_id,
    session_id,
    session_key,
    type,
    balance_after
  )
  values (
    p_person_id,
    p_session_id,
    'session:' || p_session_id::text,
    p_type,
    v_new_balance
  )
  returning * into v_attendance;

  if v_person.type = 'medlem'::public.person_type then
    update public.people
    set balance = v_new_balance,
        payment_status = case
          when v_new_balance = 0
            then 'skal_betale'::public.payment_status
          else 'ok'::public.payment_status
        end,
        updated_at = now()
    where id = p_person_id;
  end if;

  update public.sessions
  set status = 'afholdt'
  where id = p_session_id
    and status = 'planlagt';

  return v_attendance;
end;
$$;

create or replace function public.register_payment(
  p_person_id uuid,
  p_amount_ore integer default 37500,
  p_clips integer default 10,
  p_note text default null
) returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person public.people;
  v_payment public.payments;
begin
  if p_amount_ore <> 37500 or p_clips <> 10 then
    raise exception 'INVALID_CLIP_CARD';
  end if;

  select * into v_person
  from public.people
  where id = p_person_id
  for update;

  if not found then
    raise exception 'PERSON_NOT_FOUND';
  end if;

  if (
    v_person.type = 'medlem'::public.person_type
    and coalesce(v_person.balance, 0) > 0
  ) then
    raise exception 'PAYMENT_NOT_REQUIRED';
  end if;

  insert into public.payments(
    person_id,
    amount_ore,
    clips,
    note,
    balance_after
  )
  values (
    p_person_id,
    p_amount_ore,
    p_clips,
    p_note,
    10
  )
  returning * into v_payment;

  update public.people
  set type = 'medlem'::public.person_type,
      balance = 10,
      payment_status = 'ok'::public.payment_status,
      updated_at = now()
  where id = p_person_id;

  return v_payment;
end;
$$;

create or replace function public.reverse_payment(
  p_payment_id uuid,
  p_note text default 'Betaling fortrudt'
) returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original public.payments;
  v_reversal public.payments;
  v_person public.people;
  v_new_balance integer;
begin
  select * into v_original
  from public.payments
  where id = p_payment_id
    and reversed_payment_id is null
    and amount_ore > 0
    and clips > 0
  for update;

  if not found then
    raise exception 'Original payment not found';
  end if;

  if exists (
    select 1
    from public.payments
    where reversed_payment_id = p_payment_id
  ) then
    raise exception 'Payment is already reversed';
  end if;

  select * into v_person
  from public.people
  where id = v_original.person_id
  for update;

  if not found then
    raise exception 'Person not found';
  end if;

  v_new_balance := greatest(
    coalesce(v_person.balance, 0) - v_original.clips,
    0
  );

  insert into public.payments(
    person_id,
    amount_ore,
    clips,
    reversed_payment_id,
    note,
    balance_after
  )
  values (
    v_original.person_id,
    -v_original.amount_ore,
    -v_original.clips,
    v_original.id,
    p_note,
    v_new_balance
  )
  returning * into v_reversal;

  update public.people
  set balance = v_new_balance,
      payment_status = case
        when v_new_balance = 0
          then 'skal_betale'::public.payment_status
        else 'ok'::public.payment_status
      end,
      updated_at = now()
  where id = v_original.person_id;

  return v_reversal;
end;
$$;

-- Returnerer seneste gemte saldo ved afslutningen af det valgte hold.
-- Personer uden historik før tidspunktet returneres ikke.
create or replace function public.get_historical_people_state(
  p_class_id uuid,
  p_session_date date
) returns table (
  person_id uuid,
  person_type public.person_type,
  balance_after integer
)
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select
      (
        (p_session_date + training_class.end_time)
        at time zone 'Europe/Copenhagen'
      ) as cutoff
    from public.classes training_class
    where training_class.id = p_class_id
  ),
  historical_event as (
    select
      attendance.id as event_id,
      attendance.person_id,
      case
        when attendance.type::text = 'prøvetime'
          then 'gæst'::public.person_type
        else 'medlem'::public.person_type
      end as person_type,
      attendance.balance_after,
      (
        (training_session.session_date + training_class.end_time)
        at time zone 'Europe/Copenhagen'
      ) as event_time,
      2 as event_order
    from public.attendance attendance
    join public.sessions training_session
      on training_session.id = attendance.session_id
    join public.classes training_class
      on training_class.id = training_session.class_id

    union all

    select
      payment.id as event_id,
      payment.person_id,
      'medlem'::public.person_type as person_type,
      payment.balance_after,
      coalesce(payment.paid_at, payment.created_at) as event_time,
      1 as event_order
    from public.payments payment
  ),
  latest_event as (
    select distinct on (event.person_id)
      event.person_id,
      event.person_type,
      event.balance_after
    from historical_event event
    cross join target
    where event.event_time <= target.cutoff
    order by
      event.person_id,
      event.event_time desc,
      event.event_order desc,
      event.event_id desc
  )
  select
    person.id as person_id,
    latest_event.person_type,
    latest_event.balance_after
  from latest_event
  join public.people person
    on person.id = latest_event.person_id
  cross join target
  where person.created_at <= target.cutoff;
$$;

revoke all on function public.get_historical_people_state(uuid, date)
from public, anon, authenticated;
grant execute on function public.get_historical_people_state(uuid, date)
to anon, authenticated;

commit;

notify pgrst, 'reload schema';
