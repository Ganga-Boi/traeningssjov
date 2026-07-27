-- Træningssjov: faste hold + konkrete træningsgange.
-- Kør én gang i Supabase SQL Editor.

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  weekday smallint not null check (weekday between 1 and 7),
  start_time time not null,
  end_time time not null,
  active boolean not null default true,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete restrict,
  session_date date not null,
  status text not null default 'planlagt' check (status in ('planlagt', 'afholdt', 'aflyst')),
  created_at timestamptz not null default now(),
  unique (class_id, session_date)
);

alter table public.attendance
  add column if not exists session_id uuid references public.sessions(id) on delete cascade;

create unique index if not exists attendance_person_session_id_unique
  on public.attendance(person_id, session_id)
  where session_id is not null;

insert into public.classes(name, weekday, start_time, end_time, sort_order)
select * from (values
  ('Søndag', 7, '09:00'::time, '10:00'::time, 1),
  ('Mandag hold 1', 1, '17:00'::time, '18:00'::time, 2),
  ('Mandag hold 2', 1, '18:00'::time, '19:00'::time, 3),
  ('Torsdag', 4, '17:30'::time, '18:30'::time, 4)
) as seed(name, weekday, start_time, end_time, sort_order)
where not exists (select 1 from public.classes);

create or replace function public.get_or_create_session(
  p_class_id uuid,
  p_session_date date
) returns public.sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.sessions;
begin
  insert into public.sessions(class_id, session_date)
  values (p_class_id, p_session_date)
  on conflict (class_id, session_date)
  do update set class_id = excluded.class_id
  returning * into v_session;

  return v_session;
end;
$$;

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

  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if v_session.status = 'aflyst' then raise exception 'SESSION_CANCELLED'; end if;

  select * into v_person
  from public.people
  where id = p_person_id
  for update;

  if not found then raise exception 'PERSON_NOT_FOUND'; end if;

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
  values (p_person_id, p_session_id, 'session:' || p_session_id::text, p_type)
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

  update public.sessions set status = 'afholdt' where id = p_session_id and status = 'planlagt';
  return v_attendance;
end;
$$;

alter table public.classes enable row level security;
alter table public.sessions enable row level security;

create policy "authenticated admins can read classes"
on public.classes for select to authenticated using (true);

create policy "authenticated admins can read sessions"
on public.sessions for select to authenticated using (true);

create policy "authenticated admins can create sessions"
on public.sessions for insert to authenticated with check (true);

create policy "authenticated admins can update sessions"
on public.sessions for update to authenticated using (true) with check (true);

revoke all on function public.get_or_create_session(uuid, date) from public;
grant execute on function public.get_or_create_session(uuid, date) to authenticated;

revoke all on function public.register_attendance_for_session(uuid, uuid, attendance_type) from public;
grant execute on function public.register_attendance_for_session(uuid, uuid, attendance_type) to authenticated;
