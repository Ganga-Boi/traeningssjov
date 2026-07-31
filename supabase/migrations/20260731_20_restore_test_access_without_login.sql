begin;

grant select (person_id, session_id)
on public.attendance to anon;
grant select (id, name, weekday, start_time, end_time, active)
on public.classes to anon;
grant select (id, balance)
on public.people to anon;
grant select (id, class_id, session_date, status)
on public.sessions to anon;

drop policy if exists "anon reads attendance"
on public.attendance;
create policy "anon reads attendance"
on public.attendance
for select to anon
using (true);

drop policy if exists "anon reads active classes"
on public.classes;
create policy "anon reads active classes"
on public.classes
for select to anon
using (active = true);

drop policy if exists "anon reads person balances"
on public.people;
create policy "anon reads person balances"
on public.people
for select to anon
using (true);

drop policy if exists "anon reads sessions"
on public.sessions;
create policy "anon reads sessions"
on public.sessions
for select to anon
using (true);

grant execute on function public.get_class_roster_snapshot(uuid, date)
to anon;
grant execute on function public.get_or_create_session(uuid, date)
to anon;
grant execute on function public.toggle_attendance(uuid, uuid)
to anon;
grant execute on function public.create_guest_for_session(text, uuid)
to anon;
grant execute on function public.convert_guest_to_member(uuid)
to anon;
grant execute on function public.register_payment(uuid, integer, integer, text)
to anon;
grant execute on function public.get_inactive_members(uuid)
to anon;
grant execute on function public.deactivate_member(uuid)
to anon;
grant execute on function public.reactivate_member(uuid)
to anon;
grant execute on function public.get_reversible_guest_conversions()
to anon;
grant execute on function public.undo_guest_conversion(uuid)
to anon;
grant execute on function public.set_session_cancelled(uuid, date, boolean)
to anon;
grant execute on function public.correct_historical_attendance(uuid, uuid, boolean)
to anon;
grant execute on function public.remove_unpaid_guest(uuid)
to anon;

commit;

notify pgrst, 'reload schema';
