-- ENGANGSNULSTILLING AF TRÆNINGSSJOV V1.
-- Kør hele filen én gang i Supabase SQL Editor før den første rigtige test.
-- Filen sletter alle nuværende personer, gæster, fremmøder og testbetalinger.

begin;

alter table public.people
  add column if not exists privacy_notice_given_at timestamptz;

-- Ældre Træningssjov-databaser brugte amount (kroner) og clip_count.
-- Migrér dem til det nuværende skema uden at slette betalingshistorik.
do $migration$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payments'
      and column_name = 'amount'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payments'
      and column_name = 'amount_ore'
  ) then
    alter table public.payments rename column amount to amount_ore;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payments'
      and column_name = 'amount_ore'
      and data_type = 'numeric'
  ) then
    alter table public.payments
      alter column amount_ore type integer
      using round(amount_ore * 100)::integer;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payments'
      and column_name = 'clip_count'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payments'
      and column_name = 'clips'
  ) then
    alter table public.payments rename column clip_count to clips;
  end if;
end;
$migration$;

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
  v_new_balance integer;
begin
  if p_amount_ore <= 0 or p_clips <= 0 or p_clips > 10 then
    raise exception 'Amount must be positive and clips must be between 1 and 10';
  end if;

  select * into v_person
  from public.people
  where id = p_person_id
  for update;

  if not found then
    raise exception 'Person not found';
  end if;

  insert into public.payments(person_id, amount_ore, clips, note)
  values (p_person_id, p_amount_ore, p_clips, p_note)
  returning * into v_payment;

  v_new_balance := p_clips;

  update public.people
  set type = 'medlem',
      balance = v_new_balance,
      payment_status = 'ok'::public.payment_status,
      updated_at = now()
  where id = p_person_id;

  return v_payment;
end;
$$;

create or replace function public.remove_unpaid_guest(
  p_person_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted_id uuid;
begin
  delete from public.people
  where id = p_person_id
    and type = 'gæst'::public.person_type
  returning id into v_deleted_id;

  return v_deleted_id is not null;
end;
$$;

revoke all on function public.register_payment(uuid, integer, integer, text)
from public, anon;
revoke all on function public.remove_unpaid_guest(uuid)
from public, anon;

grant execute on function public.register_payment(uuid, integer, integer, text)
to anon;
grant execute on function public.remove_unpaid_guest(uuid)
to anon;

delete from public.attendance;
delete from public.sessions;
delete from public.payments;
delete from public.people;

insert into public.people(
  name,
  type,
  balance,
  payment_status,
  privacy_notice_given_at
)
select
  demo.name,
  'medlem'::public.person_type,
  demo.balance,
  case
    when demo.balance = 0 then 'skal_betale'::public.payment_status
    else 'ok'::public.payment_status
  end,
  now()
from (
  values
    ('Anna Madsen', 8),
    ('Birgit Holm', 5),
    ('Camilla Friis', 2),
    ('Dorte Larsen', 10),
    ('Eva Nielsen', 0),
    ('Freja Bach', 7),
    ('Helle Møller', 4),
    ('Ida Thomsen', 9),
    ('Karen Sørensen', 6),
    ('Lene Andersen', 3)
) as demo(name, balance);

commit;

notify pgrst, 'reload schema';
