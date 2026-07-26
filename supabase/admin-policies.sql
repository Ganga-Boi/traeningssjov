-- Træningssjov v1: Kun godkendte Supabase-brugere må bruge appen.
-- Kør denne fil i Supabase SQL Editor efter admin-brugeren er oprettet.

create policy "authenticated admins can read people"
on public.people for select
to authenticated
using (true);

create policy "authenticated admins can create people"
on public.people for insert
to authenticated
with check (true);

create policy "authenticated admins can update people"
on public.people for update
to authenticated
using (true)
with check (true);

create policy "authenticated admins can delete people"
on public.people for delete
to authenticated
using (true);

create policy "authenticated admins can read attendance"
on public.attendance for select
to authenticated
using (true);

create policy "authenticated admins can create attendance"
on public.attendance for insert
to authenticated
with check (true);

create policy "authenticated admins can delete attendance"
on public.attendance for delete
to authenticated
using (true);

create policy "authenticated admins can read payments"
on public.payments for select
to authenticated
using (true);

create policy "authenticated admins can create payments"
on public.payments for insert
to authenticated
with check (true);

revoke all on function public.register_attendance(uuid, text, attendance_type) from public;
grant execute on function public.register_attendance(uuid, text, attendance_type) to authenticated;

revoke all on function public.register_payment(uuid, numeric, integer, text) from public;
grant execute on function public.register_payment(uuid, numeric, integer, text) to authenticated;
