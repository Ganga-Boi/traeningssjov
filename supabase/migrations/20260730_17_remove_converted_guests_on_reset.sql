begin;

create or replace function public.reset_all_test_data(
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attendance_count integer;
  v_payment_count integer;
  v_session_count integer;
  v_guest_count integer;
  v_member_count integer;
  v_test_guest_ids uuid[];
begin
  if p_confirmation <> 'NULSTIL ALLE TESTDATA' then
    raise exception 'RESET_CONFIRMATION_REQUIRED';
  end if;

  select coalesce(
    array_agg(distinct person.id),
    array[]::uuid[]
  )
  into v_test_guest_ids
  from public.people person
  where person.type = 'gæst'::public.person_type
    or person.balance is null
    or exists (
      select 1
      from public.payments conversion
      where conversion.person_id = person.id
        and conversion.note = 'Gæstekonvertering registreret af Randi'
    );

  v_guest_count := cardinality(v_test_guest_ids);

  select count(*) into v_attendance_count from public.attendance;
  select count(*) into v_payment_count from public.payments;
  select count(*) into v_session_count from public.sessions;

  truncate table
    public.session_roster_snapshots,
    public.attendance,
    public.payments,
    public.sessions;

  delete from public.class_memberships
  where person_id = any(v_test_guest_ids);

  delete from public.people
  where id = any(v_test_guest_ids);

  update public.people
  set balance = 10,
      payment_status = 'ok'::public.payment_status,
      updated_at = pg_catalog.now()
  where type = 'medlem'::public.person_type;

  get diagnostics v_member_count = row_count;

  return jsonb_build_object(
    'attendance_deleted', v_attendance_count,
    'payments_deleted', v_payment_count,
    'sessions_deleted', v_session_count,
    'guests_deleted', v_guest_count,
    'members_reset', v_member_count
  );
end;
$$;

revoke all on function public.reset_all_test_data(text)
from public, anon, authenticated;
grant execute on function public.reset_all_test_data(text)
to service_role;

commit;

notify pgrst, 'reload schema';
