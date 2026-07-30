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
begin
  if p_confirmation <> 'NULSTIL ALLE TESTDATA' then
    raise exception 'RESET_CONFIRMATION_REQUIRED';
  end if;

  select count(*) into v_attendance_count from public.attendance;
  select count(*) into v_payment_count from public.payments;
  select count(*) into v_session_count from public.sessions;
  select count(*) into v_guest_count
  from public.people
  where type = 'gæst'::public.person_type
    or balance is null;

  truncate table
    public.session_roster_snapshots,
    public.attendance,
    public.payments,
    public.sessions;

  delete from public.class_memberships membership
  using public.people person
  where membership.person_id = person.id
    and (
      person.type = 'gæst'::public.person_type
      or person.balance is null
    );

  delete from public.people
  where type = 'gæst'::public.person_type
    or balance is null;

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
