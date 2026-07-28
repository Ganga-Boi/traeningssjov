begin;

create or replace function public.set_session_cancelled(
  p_class_id uuid,
  p_session_date date,
  p_cancelled boolean
) returns public.sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.sessions;
  v_today date;
begin
  v_today := (now() at time zone 'Europe/Copenhagen')::date;

  insert into public.sessions(class_id, session_date)
  values (p_class_id, p_session_date)
  on conflict (class_id, session_date)
  do update set class_id = excluded.class_id
  returning * into v_session;

  select * into v_session
  from public.sessions
  where id = v_session.id
  for update;

  if exists (
    select 1
    from public.attendance
    where session_id = v_session.id
  ) then
    raise exception 'SESSION_HAS_ATTENDANCE';
  end if;

  if p_cancelled then
    if v_session.status <> 'planlagt' then
      raise exception 'SESSION_NOT_PLANNED';
    end if;

    update public.sessions
    set status = 'aflyst'
    where id = v_session.id
    returning * into v_session;
  else
    if p_session_date <> v_today then
      raise exception 'CANCELLATION_CAN_ONLY_BE_REVERSED_SAME_DAY';
    end if;

    if v_session.status <> 'aflyst' then
      raise exception 'SESSION_NOT_CANCELLED';
    end if;

    update public.sessions
    set status = 'planlagt'
    where id = v_session.id
    returning * into v_session;
  end if;

  return v_session;
end;
$$;

revoke all on function public.set_session_cancelled(uuid, date, boolean) from public;
grant execute on function public.set_session_cancelled(uuid, date, boolean)
to anon, authenticated;

commit;

notify pgrst, 'reload schema';
