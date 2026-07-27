-- Træningssjov: et klippekort har altid 0-10 klip.
-- Kan køres flere gange i Supabase SQL Editor og sletter ingen personer.

begin;

update public.people
set balance = null,
    payment_status = 'skal_betale'::public.payment_status,
    updated_at = now()
where type = 'gæst'::public.person_type
  and (
    balance is not null
    or payment_status <> 'skal_betale'::public.payment_status
  );

update public.people
set balance = greatest(0, least(coalesce(balance, 0), 10)),
    payment_status = case
      when greatest(0, least(coalesce(balance, 0), 10)) = 0
        then 'skal_betale'::public.payment_status
      else 'ok'::public.payment_status
    end,
    updated_at = now()
where type = 'medlem'::public.person_type
  and (balance is null or balance < 0 or balance > 10);

alter table public.people
  drop constraint if exists guest_balance_is_null;

alter table public.people
  drop constraint if exists member_balance_between_zero_and_ten;

alter table public.people
  add constraint guest_balance_is_null check (
    (type = 'gæst'::public.person_type and balance is null)
    or
    (type = 'medlem'::public.person_type and balance is not null)
  );

alter table public.people
  add constraint member_balance_between_zero_and_ten check (
    balance is null or balance between 0 and 10
  );

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

  insert into public.payments(person_id, amount_ore, clips, note)
  values (p_person_id, p_amount_ore, p_clips, p_note)
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

create or replace function public.undo_attendance_for_session(
  p_person_id uuid,
  p_session_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attendance public.attendance;
  v_person public.people;
  v_new_balance integer;
begin
  select * into v_attendance
  from public.attendance
  where person_id = p_person_id
    and session_id = p_session_id
  for update;

  if not found then
    return false;
  end if;

  select * into v_person
  from public.people
  where id = p_person_id
  for update;

  if not found then
    raise exception 'Person not found';
  end if;

  delete from public.attendance
  where id = v_attendance.id;

  if (
    v_person.type = 'medlem'::public.person_type
    and v_attendance.type::text <> 'prøvetime'
  ) then
    v_new_balance := least(coalesce(v_person.balance, 0) + 1, 10);

    update public.people
    set balance = v_new_balance,
        payment_status = case
          when v_new_balance = 0 then 'skal_betale'::public.payment_status
          else 'ok'::public.payment_status
        end,
        updated_at = now()
    where id = p_person_id;
  end if;

  if not exists (
    select 1 from public.attendance where session_id = p_session_id
  ) then
    update public.sessions
    set status = 'planlagt'
    where id = p_session_id
      and status = 'afholdt';
  end if;

  return true;
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

  insert into public.payments(
    person_id,
    amount_ore,
    clips,
    reversed_payment_id,
    note
  )
  values (
    v_original.person_id,
    -v_original.amount_ore,
    -v_original.clips,
    v_original.id,
    p_note
  )
  returning * into v_reversal;

  v_new_balance := greatest(
    coalesce(v_person.balance, 0) - v_original.clips,
    0
  );

  update public.people
  set balance = v_new_balance,
      payment_status = case
        when v_new_balance = 0 then 'skal_betale'::public.payment_status
        else 'ok'::public.payment_status
      end,
      updated_at = now()
  where id = v_original.person_id;

  return v_reversal;
end;
$$;

commit;

notify pgrst, 'reload schema';
