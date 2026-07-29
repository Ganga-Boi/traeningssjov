begin;

create or replace function public.toggle_attendance(
  p_person_id uuid,
  p_session_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions;
  v_person public.people;
  v_attendance public.attendance;
  v_new_balance integer;
begin
  if p_person_id is null or p_session_id is null then
    raise exception 'INVALID_ATTENDANCE_ARGUMENTS';
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

  select * into v_person
  from public.people
  where id = p_person_id
    and active = true
  for update;

  if not found then
    raise exception 'PERSON_NOT_FOUND_OR_INACTIVE';
  end if;

  select * into v_attendance
  from public.attendance
  where person_id = p_person_id
    and session_id = p_session_id
  for update;

  if found then
    delete from public.attendance
    where id = v_attendance.id;

    if v_person.type = 'medlem'::public.person_type
      and v_attendance.type = 'normal'::public.attendance_type
    then
      v_new_balance := least(coalesce(v_person.balance, 0) + 1, 10);

      update public.people
      set balance = v_new_balance,
          payment_status = case
            when v_new_balance = 0
              then 'skal_betale'::public.payment_status
            else 'ok'::public.payment_status
          end,
          updated_at = pg_catalog.now()
      where id = p_person_id;
    else
      v_new_balance := null;
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

    return jsonb_build_object(
      'attended', false,
      'person_id', p_person_id,
      'session_id', p_session_id,
      'balance_after', v_new_balance
    );
  end if;

  if v_person.type = 'medlem'::public.person_type then
    if v_person.balance is null or v_person.balance <= 0 then
      raise exception 'PAYMENT_REQUIRED';
    end if;

    v_new_balance := v_person.balance - 1;

    insert into public.attendance(
      person_id,
      session_id,
      session_key,
      type,
      balance_after,
      attended_at
    )
    values (
      p_person_id,
      p_session_id,
      'session:' || p_session_id::text,
      'normal'::public.attendance_type,
      v_new_balance,
      pg_catalog.now()
    )
    returning * into v_attendance;

    update public.people
    set balance = v_new_balance,
        payment_status = case
          when v_new_balance = 0
            then 'skal_betale'::public.payment_status
          else 'ok'::public.payment_status
        end,
        updated_at = pg_catalog.now()
    where id = p_person_id;
  else
    if exists (
      select 1
      from public.attendance previous_attendance
      join public.sessions previous_session
        on previous_session.id = previous_attendance.session_id
      where previous_attendance.person_id = p_person_id
        and previous_attendance.type = 'prøvetime'::public.attendance_type
        and previous_session.session_date < v_session.session_date
    ) then
      raise exception 'PAYMENT_REQUIRED';
    end if;

    v_new_balance := null;

    insert into public.attendance(
      person_id,
      session_id,
      session_key,
      type,
      balance_after,
      attended_at
    )
    values (
      p_person_id,
      p_session_id,
      'session:' || p_session_id::text,
      'prøvetime'::public.attendance_type,
      null,
      pg_catalog.now()
    )
    returning * into v_attendance;
  end if;

  update public.sessions
  set status = 'afholdt'
  where id = p_session_id
    and status = 'planlagt';

  return jsonb_build_object(
    'attended', true,
    'person_id', p_person_id,
    'session_id', p_session_id,
    'attendance_id', v_attendance.id,
    'balance_after', v_new_balance
  );
end;
$$;

revoke all on function public.toggle_attendance(uuid, uuid) from public;
grant execute on function public.toggle_attendance(uuid, uuid)
to anon, authenticated;

commit;

notify pgrst, 'reload schema';
