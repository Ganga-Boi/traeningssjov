begin;

do $$
begin
  if exists (
    select 1
    from public.people
    group by lower(btrim(name))
    having count(*) > 1
  ) then
    raise exception 'DUPLICATE_PERSON_NAMES_MUST_BE_RESOLVED';
  end if;
end;
$$;

create unique index if not exists people_normalized_name_unique
  on public.people (lower(btrim(name)));

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
    privacy_notice_given_at,
    active
  )
  values (
    v_name,
    'gæst'::public.person_type,
    null,
    'skal_betale'::public.payment_status,
    now(),
    true
  )
  returning * into v_person;

  insert into public.attendance(
    person_id,
    session_id,
    session_key,
    type,
    balance_after,
    attended_at
  )
  values (
    v_person.id,
    p_session_id,
    'session:' || p_session_id::text,
    'prøvetime'::public.attendance_type,
    null,
    now()
  );

  update public.sessions
  set status = 'afholdt'
  where id = p_session_id
    and status = 'planlagt';

  return v_person;
end;
$$;

commit;

notify pgrst, 'reload schema';
