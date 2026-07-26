-- Træningssjov v1 uden login.
-- Kør én gang i Supabase SQL Editor.

create policy "anon can read people"
on public.people for select
to anon
using (true);

create policy "anon can create people"
on public.people for insert
to anon
with check (true);

create policy "anon can update people"
on public.people for update
to anon
using (true)
with check (true);

create policy "anon can read classes"
on public.classes for select
to anon
using (true);

create policy "anon can read sessions"
on public.sessions for select
to anon
using (true);

create policy "anon can create sessions"
on public.sessions for insert
to anon
with check (true);

create policy "anon can read attendance"
on public.attendance for select
to anon
using (true);

create policy "anon can create attendance"
on public.attendance for insert
to anon
with check (true);

create policy "anon can read payments"
on public.payments for select
to anon
using (true);

create policy "anon can create payments"
on public.payments for insert
to anon
with check (true);

grant execute on function public.get_or_create_session(uuid, date) to anon;
grant execute on function public.register_attendance_for_session(uuid, uuid, attendance_type) to anon;
grant execute on function public.register_payment(uuid, numeric, integer, text) to anon;
