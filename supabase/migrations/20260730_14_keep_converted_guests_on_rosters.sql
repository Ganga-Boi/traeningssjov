begin;

create or replace function public.convert_guest_to_member(
  p_person_id uuid
) returns public.payments
language plpgsql
security definer
set search_path = ''
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
      updated_at = pg_catalog.now()
  where id = p_person_id;

  insert into public.class_memberships(
    class_id,
    person_id,
    active
  )
  select
    training_class.id,
    p_person_id,
    true
  from public.classes training_class
  where training_class.active = true
  on conflict (class_id, person_id)
  do update set active = true;

  return v_payment;
end;
$$;

insert into public.class_memberships(
  class_id,
  person_id,
  active
)
select
  training_class.id,
  person.id,
  true
from public.people person
cross join public.classes training_class
where person.type = 'medlem'::public.person_type
  and person.active = true
  and training_class.active = true
  and exists (
    select 1
    from public.payments conversion
    where conversion.person_id = person.id
      and conversion.note = 'Gæstekonvertering registreret af Randi'
      and conversion.reversed_payment_id is null
      and not exists (
        select 1
        from public.payments reversal
        where reversal.reversed_payment_id = conversion.id
      )
  )
on conflict (class_id, person_id)
do update set active = true;

revoke all on function public.convert_guest_to_member(uuid)
from public;
grant execute on function public.convert_guest_to_member(uuid)
to anon, authenticated;

commit;

notify pgrst, 'reload schema';
