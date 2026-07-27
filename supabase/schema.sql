create extension if not exists pgcrypto;

create type public.person_type as enum ('medlem', 'gæst');
create type public.payment_status as enum ('ok', 'skal_betale');
create type public.attendance_type as enum ('normal', 'prøvetime');

create table public.people (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) > 0),
  type public.person_type not null default 'gæst',
  balance integer,
  payment_status public.payment_status not null default 'skal_betale',
  privacy_notice_given_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guest_balance_is_null check (
    (type = 'gæst' and balance is null) or
    (type = 'medlem' and balance is not null)
  ),
  constraint member_balance_between_zero_and_ten check (
    type = 'gæst' or balance between 0 and 10
  )
);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete cascade,
  session_key text not null,
  attended_at timestamptz not null default now(),
  type public.attendance_type not null default 'normal',
  created_at timestamptz not null default now(),
  unique (person_id, session_key)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete restrict,
  amount_ore integer not null,
  clips integer not null,
  paid_at timestamptz not null default now(),
  reversed_payment_id uuid references public.payments(id),
  note text,
  created_at timestamptz not null default now()
);

create index attendance_session_key_idx on public.attendance(session_key);
create index payments_person_id_idx on public.payments(person_id);

create or replace function public.register_attendance(
  p_person_id uuid,
  p_session_key text,
  p_type public.attendance_type default 'normal'
) returns public.attendance
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person public.people;
  v_attendance public.attendance;
begin
  select * into v_person from public.people where id = p_person_id for update;
  if not found then raise exception 'PERSON_NOT_FOUND'; end if;

  select * into v_attendance
  from public.attendance
  where person_id = p_person_id
    and session_key = p_session_key;

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
  elsif p_type::text <> 'prøvetime' then
    raise exception 'ATTENDANCE_TYPE_NOT_ALLOWED';
  end if;

  insert into public.attendance(person_id, session_key, type)
  values (p_person_id, p_session_key, p_type)
  returning * into v_attendance;

  if v_person.type = 'medlem'::public.person_type then
    update public.people
    set balance = v_person.balance - 1,
        payment_status = case
          when v_person.balance - 1 = 0
            then 'skal_betale'::public.payment_status
          else 'ok'::public.payment_status
        end,
        updated_at = now()
    where id = p_person_id;
  end if;

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

  if not found then raise exception 'PERSON_NOT_FOUND'; end if;

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

alter table public.people enable row level security;
alter table public.attendance enable row level security;
alter table public.payments enable row level security;

-- Policies are intentionally not opened to anonymous users.
-- Add authenticated admin policies after Randi's login account is created.
