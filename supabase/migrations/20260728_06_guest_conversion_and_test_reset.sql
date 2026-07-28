begin;

create or replace function public.convert_guest_to_member(
  p_person_id uuid
) returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person public.people;
  v_payment public.payments;
begin
  select * into v_person
  from public.people
  where id = p_person_id
  for update;

  if not found then
    raise exception 'PERSON_NOT_FOUND';
  end if;

  if v_person.type <> 'gæst'::public.person_type
    or v_person.balance is not null
  then
    raise exception 'PERSON_IS_NOT_GUEST';
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
    37500,
    10,
    'Gæstekonvertering registreret af Randi',
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

create or replace function public.get_reversible_guest_conversions()
returns table (
  payment_id uuid,
  person_id uuid,
  name text,
  paid_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    payment.id,
    person.id,
    person.name,
    payment.paid_at
  from public.payments payment
  join public.people person
    on person.id = payment.person_id
  where payment.note = 'Gæstekonvertering registreret af Randi'
    and payment.reversed_payment_id is null
    and payment.amount_ore = 37500
    and payment.clips = 10
    and person.type = 'medlem'::public.person_type
    and not exists (
      select 1
      from public.payments reversal
      where reversal.reversed_payment_id = payment.id
    )
    and not exists (
      select 1
      from public.payments later_payment
      where later_payment.person_id = payment.person_id
        and later_payment.paid_at > payment.paid_at
    )
    and not exists (
      select 1
      from public.attendance later_attendance
      where later_attendance.person_id = payment.person_id
        and later_attendance.attended_at > payment.paid_at
    )
  order by payment.paid_at desc;
$$;

create or replace function public.undo_guest_conversion(
  p_payment_id uuid
) returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original public.payments;
  v_person public.people;
  v_reversal public.payments;
begin
  select * into v_original
  from public.payments
  where id = p_payment_id
    and note = 'Gæstekonvertering registreret af Randi'
    and reversed_payment_id is null
    and amount_ore = 37500
    and clips = 10
  for update;

  if not found then
    raise exception 'GUEST_CONVERSION_NOT_FOUND';
  end if;

  if exists (
    select 1
    from public.payments
    where reversed_payment_id = v_original.id
  ) then
    raise exception 'GUEST_CONVERSION_ALREADY_REVERSED';
  end if;

  if exists (
    select 1
    from public.payments
    where person_id = v_original.person_id
      and paid_at > v_original.paid_at
  ) or exists (
    select 1
    from public.attendance
    where person_id = v_original.person_id
      and attended_at > v_original.paid_at
  ) then
    raise exception 'GUEST_CONVERSION_HAS_LATER_ACTIVITY';
  end if;

  select * into v_person
  from public.people
  where id = v_original.person_id
  for update;

  if not found then
    raise exception 'PERSON_NOT_FOUND';
  end if;

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
    'Gæstekonvertering tilbageført',
    null
  )
  returning * into v_reversal;

  update public.people
  set type = 'gæst'::public.person_type,
      balance = null,
      payment_status = 'skal_betale'::public.payment_status,
      updated_at = now()
  where id = v_original.person_id;

  return v_reversal;
end;
$$;

create or replace function public.reset_all_test_data(
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attendance_count integer;
  v_payment_count integer;
  v_session_count integer;
  v_guest_count integer;
  v_member_count integer;
begin
  if p_confirmation <> 'NULSTIL ALLE TESTDATA' then
    raise exception 'RESET_CONFIRMATION_REQUIRED';
  end if;

  select count(*) into v_attendance_count from public.attendance;
  select count(*) into v_payment_count from public.payments;
  select count(*) into v_session_count from public.sessions;
  select count(*) into v_guest_count
  from public.people
  where type = 'gæst'::public.person_type
    or balance is null;

  delete from public.attendance;
  delete from public.payments;
  delete from public.sessions;

  delete from public.class_memberships membership
  using public.people person
  where membership.person_id = person.id
    and (
      person.type = 'gæst'::public.person_type
      or person.balance is null
    );

  delete from public.people
  where type = 'gæst'::public.person_type
    or balance is null;

  update public.people
  set balance = 10,
      payment_status = 'ok'::public.payment_status,
      updated_at = now()
  where type = 'medlem'::public.person_type;

  get diagnostics v_member_count = row_count;

  return jsonb_build_object(
    'attendance_deleted', v_attendance_count,
    'payments_deleted', v_payment_count,
    'sessions_deleted', v_session_count,
    'guests_deleted', v_guest_count,
    'members_reset', v_member_count
  );
end;
$$;

revoke all on function public.convert_guest_to_member(uuid) from public;
revoke all on function public.get_reversible_guest_conversions() from public;
revoke all on function public.undo_guest_conversion(uuid) from public;
revoke all on function public.reset_all_test_data(text) from public;

grant execute on function public.convert_guest_to_member(uuid)
to anon, authenticated;
grant execute on function public.get_reversible_guest_conversions()
to anon, authenticated;
grant execute on function public.undo_guest_conversion(uuid)
to anon, authenticated;
grant execute on function public.reset_all_test_data(text)
to anon, authenticated;

commit;

notify pgrst, 'reload schema';
