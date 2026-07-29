begin;

create or replace function public.undo_guest_conversion(
  p_payment_id uuid
) returns public.payments
language plpgsql
security definer
set search_path = ''
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
    0
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

revoke all on function public.undo_guest_conversion(uuid) from public;
grant execute on function public.undo_guest_conversion(uuid)
to anon, authenticated;

commit;

notify pgrst, 'reload schema';
