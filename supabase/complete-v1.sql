-- Træningssjov: samlet reparation og færdiggørelse af v1.
-- Kan køres flere gange i Supabase SQL Editor.
-- Forudsætter, at schema.sql og classes-sessions-migration.sql er kørt.

begin;

-- Ældre databaser mangler denne kolonne, selv om den findes i den nyeste schema.sql.
alter table public.people
  add column if not exists privacy_notice_given_at timestamptz;

create unique index if not exists payments_one_reversal_per_payment
  on public.payments(reversed_payment_id)
  where reversed_payment_id is not null;

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
  if p_amount_ore <= 0 or p_clips <= 0 then
    raise exception 'Amount and clips must be positive';
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

  v_new_balance := coalesce(v_person.balance, 0) + p_clips;

  update public.people
  set type = 'medlem',
      balance = v_new_balance,
      payment_status = case
        when v_new_balance < 0 then 'blokeret'::public.payment_status
        when v_new_balance = 0 then 'skal_betale'::public.payment_status
        else 'ok'::public.payment_status
      end,
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

  if v_person.type = 'medlem' and v_attendance.type in ('normal', 'kredit') then
    v_new_balance := coalesce(v_person.balance, 0) + 1;

    update public.people
    set balance = v_new_balance,
        payment_status = case
          when v_new_balance < 0 then 'blokeret'::public.payment_status
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

  v_new_balance := coalesce(v_person.balance, 0) - v_original.clips;

  update public.people
  set balance = v_new_balance,
      payment_status = case
        when v_new_balance < 0 then 'blokeret'::public.payment_status
        when v_new_balance = 0 then 'skal_betale'::public.payment_status
        else 'ok'::public.payment_status
      end,
      updated_at = now()
  where id = v_original.person_id;

  return v_reversal;
end;
$$;

alter table public.people enable row level security;
alter table public.classes enable row level security;
alter table public.sessions enable row level security;
alter table public.attendance enable row level security;
alter table public.payments enable row level security;

drop policy if exists "anon can read people" on public.people;
drop policy if exists "anon can create people" on public.people;
drop policy if exists "anon can update people" on public.people;
drop policy if exists "anon can read classes" on public.classes;
drop policy if exists "anon can read sessions" on public.sessions;
drop policy if exists "anon can create sessions" on public.sessions;
drop policy if exists "anon can read attendance" on public.attendance;
drop policy if exists "anon can create attendance" on public.attendance;
drop policy if exists "anon can read payments" on public.payments;
drop policy if exists "anon can create payments" on public.payments;

create policy "anon can read people"
on public.people for select
to anon
using (true);

create policy "anon can create people"
on public.people for insert
to anon
with check (true);

create policy "anon can read classes"
on public.classes for select
to anon
using (true);

create policy "anon can read sessions"
on public.sessions for select
to anon
using (true);

create policy "anon can read attendance"
on public.attendance for select
to anon
using (true);

create policy "anon can read payments"
on public.payments for select
to anon
using (true);

grant usage on schema public to anon;

revoke all privileges on table
  public.people,
  public.classes,
  public.sessions,
  public.attendance,
  public.payments
from anon;

grant select on table
  public.people,
  public.classes,
  public.sessions,
  public.attendance,
  public.payments
to anon;

grant insert on table public.people to anon;

revoke all on function public.get_or_create_session(uuid, date) from public, anon;
revoke all on function public.register_attendance_for_session(uuid, uuid, public.attendance_type) from public, anon;
revoke all on function public.register_payment(uuid, integer, integer, text) from public, anon;
revoke all on function public.undo_attendance_for_session(uuid, uuid) from public, anon;
revoke all on function public.reverse_payment(uuid, text) from public, anon;

grant execute on function public.get_or_create_session(uuid, date) to anon;
grant execute on function public.register_attendance_for_session(uuid, uuid, public.attendance_type) to anon;
grant execute on function public.register_payment(uuid, integer, integer, text) to anon;
grant execute on function public.undo_attendance_for_session(uuid, uuid) to anon;
grant execute on function public.reverse_payment(uuid, text) to anon;

-- Fiktive deltagere til v1-test. Eksisterende navne oprettes ikke igen.
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
) as demo(name, balance)
where not exists (
  select 1
  from public.people existing
  where lower(existing.name) = lower(demo.name)
);

insert into public.people(
  name,
  type,
  balance,
  payment_status,
  privacy_notice_given_at
)
select
  'Sofie (gæst)',
  'gæst'::public.person_type,
  null,
  'skal_betale'::public.payment_status,
  now()
where not exists (
  select 1
  from public.people
  where lower(name) = lower('Sofie (gæst)')
);

commit;

-- Sørg for, at nye RPC-funktioner straks bliver synlige for appen.
notify pgrst, 'reload schema';
