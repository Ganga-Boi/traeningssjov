begin;

do $$
declare
  policy record;
begin
  for policy in
    select tablename, policyname
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and 'anon'::name = any(roles)
  loop
    execute format(
      'drop policy if exists %I on public.%I',
      policy.policyname,
      policy.tablename
    );
  end loop;
end;
$$;

revoke all privileges on table public.attendance from anon;
revoke all privileges on table public.class_memberships from anon;
revoke all privileges on table public.classes from anon;
do $$
begin
  if pg_catalog.to_regclass('public.clip_transactions') is not null then
    execute 'revoke all privileges on table public.clip_transactions from anon';
  end if;
end;
$$;
revoke all privileges on table public.payments from anon;
revoke all privileges on table public.people from anon;
revoke all privileges on table public.sessions from anon;
revoke all privileges on table public.session_roster_snapshots from anon;
revoke all privileges on table public.audit_events from anon;

grant select on table public.attendance to authenticated;
grant select on table public.classes to authenticated;
grant select on table public.people to authenticated;
grant select on table public.sessions to authenticated;

drop policy if exists "authenticated reads attendance"
on public.attendance;
create policy "authenticated reads attendance"
on public.attendance
for select to authenticated
using (true);

drop policy if exists "authenticated reads active classes"
on public.classes;
create policy "authenticated reads active classes"
on public.classes
for select to authenticated
using (active = true);

drop policy if exists "authenticated reads people"
on public.people;
create policy "authenticated reads people"
on public.people
for select to authenticated
using (true);

drop policy if exists "authenticated reads sessions"
on public.sessions;
create policy "authenticated reads sessions"
on public.sessions
for select to authenticated
using (true);

revoke execute on function public.get_class_roster_snapshot(uuid, date)
from anon;
grant execute on function public.get_class_roster_snapshot(uuid, date)
to authenticated;

revoke execute on function public.get_or_create_session(uuid, date)
from anon;
grant execute on function public.get_or_create_session(uuid, date)
to authenticated;

revoke execute on function public.toggle_attendance(uuid, uuid)
from anon;
grant execute on function public.toggle_attendance(uuid, uuid)
to authenticated;

revoke execute on function public.create_guest_for_session(text, uuid)
from anon;
grant execute on function public.create_guest_for_session(text, uuid)
to authenticated;

revoke execute on function public.convert_guest_to_member(uuid)
from anon;
grant execute on function public.convert_guest_to_member(uuid)
to authenticated;

revoke execute on function public.register_payment(uuid, integer, integer, text)
from anon;
grant execute on function public.register_payment(uuid, integer, integer, text)
to authenticated;

revoke execute on function public.get_inactive_members(uuid)
from anon;
grant execute on function public.get_inactive_members(uuid)
to authenticated;

revoke execute on function public.deactivate_member(uuid)
from anon;
grant execute on function public.deactivate_member(uuid)
to authenticated;

revoke execute on function public.reactivate_member(uuid)
from anon;
grant execute on function public.reactivate_member(uuid)
to authenticated;

revoke execute on function public.get_reversible_guest_conversions()
from anon;
grant execute on function public.get_reversible_guest_conversions()
to authenticated;

revoke execute on function public.undo_guest_conversion(uuid)
from anon;
grant execute on function public.undo_guest_conversion(uuid)
to authenticated;

revoke execute on function public.set_session_cancelled(uuid, date, boolean)
from anon;
grant execute on function public.set_session_cancelled(uuid, date, boolean)
to authenticated;

revoke execute on function public.correct_historical_attendance(uuid, uuid, boolean)
from anon;
grant execute on function public.correct_historical_attendance(uuid, uuid, boolean)
to authenticated;

revoke execute on function public.remove_unpaid_guest(uuid)
from anon;
grant execute on function public.remove_unpaid_guest(uuid)
to authenticated;

commit;

notify pgrst, 'reload schema';
