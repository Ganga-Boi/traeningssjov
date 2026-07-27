-- Træningssjov: ikke-slettende stabilisering af gæster, klip og fremmøde.
-- Kan køres flere gange i Supabase SQL Editor.

begin;

-- Gæster har ingen klipsaldo. Medlemmer har altid 0-10 klip.
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
  and (
    balance is null
    or balance < 0
    or balance > 10
    or payment_status <> case
      when greatest(0, least(coalesce(balance, 0), 10)) = 0
        then 'skal_betale'::public.payment_status
      else 'ok'::public.payment_status
    end
  );

alter table public.people
  drop constraint if exists guest_balance_is_null;

alter table public.people
  drop constraint if exists member_balance_between_zero_and_ten;

alter table public.people
  drop constraint if exists person_state_is_consistent;

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

alter table public.people
  add constraint person_state_is_consistent check (
    (
      type = 'gæst'::public.person_type
      and balance is null
      and payment_status = 'skal_betale'::public.payment_status
    )
    or
    (
      type = 'medlem'::public.person_type
      and balance between 1 and 10
      and payment_status = 'ok'::public.payment_status
    )
    or
    (
      type = 'medlem'::public.person_type
      and balance = 0
      and payment_status = 'skal_betale'::public.payment_status
    )
  );

create unique index if not exists attendance_person_session_id_unique
  on public.attendance(person_id, session_id)
  where session_id is not null;

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

  insert into public.attendance(person_id, session_id, session_key, type)
  values (
    p_person_id,
    p_session_id,
    'session:' || p_session_id::text,
    p_type
  )
  returning * into v_attendance;

  if v_person.type = 'medlem'::public.person_type then
    v_new_balance := v_person.balance - 1;

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
  v_session public.sessions;
  v_attendance public.attendance;
  v_person public.people;
  v_new_balance integer;
begin
  select * into v_session
  from public.sessions
  where id = p_session_id
  for update;

  if not found then
    return false;
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
    and session_id = p_session_id
  for update;

  if not found then
    return false;
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
          when v_new_balance = 0
            then 'skal_betale'::public.payment_status
          else 'ok'::public.payment_status
        end,
        updated_at = now()
    where id = p_person_id;
  end if;

  if not exists (
    select 1
    from public.attendance
    where session_id = p_session_id
  ) then
    update public.sessions
    set status = 'planlagt'
    where id = p_session_id
      and status = 'afholdt';
  end if;

  return true;
end;
$$;

create or replace function public.create_guest_for_session(
  p_name text,
  p_session_id uuid
) returns public.people
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_session public.sessions;
  v_person public.people;
begin
  v_name := btrim(p_name);

  if v_name is null or char_length(v_name) = 0 then
    raise exception 'INVALID_PERSON_NAME';
  end if;

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

  perform pg_advisory_xact_lock(hashtextextended(lower(v_name), 0));

  if exists (
    select 1
    from public.people
    where lower(btrim(name)) = lower(v_name)
  ) then
    raise exception 'PERSON_ALREADY_EXISTS';
  end if;

  insert into public.people(
    name,
    type,
    balance,
    payment_status,
    privacy_notice_given_at
  )
  values (
    v_name,
    'gæst'::public.person_type,
    null,
    'skal_betale'::public.payment_status,
    now()
  )
  returning * into v_person;

  insert into public.attendance(person_id, session_id, session_key, type)
  values (
    v_person.id,
    p_session_id,
    'session:' || p_session_id::text,
    'prøvetime'::public.attendance_type
  );

  update public.sessions
  set status = 'afholdt'
  where id = p_session_id
    and status = 'planlagt';

  return v_person;
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
  delete from public.people person
  where person.id = p_person_id
    and person.type = 'gæst'::public.person_type
    and person.balance is null
    and person.payment_status = 'skal_betale'::public.payment_status
    and not exists (
      select 1
      from public.payments payment
      where payment.person_id = person.id
    )
  returning person.id into v_deleted_id;

  return v_deleted_id is not null;
end;
$$;

drop policy if exists "anon can create people" on public.people;
revoke insert on table public.people from anon;

revoke all on function public.create_guest_for_session(text, uuid)
from public, anon;
grant execute on function public.create_guest_for_session(text, uuid)
to anon;

revoke all on function public.register_attendance_for_session(
  uuid,
  uuid,
  public.attendance_type
) from public, anon;
grant execute on function public.register_attendance_for_session(
  uuid,
  uuid,
  public.attendance_type
) to anon;

revoke all on function public.register_payment(uuid, integer, integer, text)
from public, anon;
grant execute on function public.register_payment(uuid, integer, integer, text)
to anon;

revoke all on function public.undo_attendance_for_session(uuid, uuid)
from public, anon;
grant execute on function public.undo_attendance_for_session(uuid, uuid)
to anon;

revoke all on function public.remove_unpaid_guest(uuid)
from public, anon;
grant execute on function public.remove_unpaid_guest(uuid)
to anon;

commit;

notify pgrst, 'reload schema';
