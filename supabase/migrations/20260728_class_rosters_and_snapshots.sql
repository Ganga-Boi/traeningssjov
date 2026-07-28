begin;

create table if not exists public.class_memberships (
  class_id uuid not null references public.classes(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (class_id, person_id)
);

alter table public.class_memberships enable row level security;
grant select, insert, update, delete on public.class_memberships to anon;

drop policy if exists "anon class memberships" on public.class_memberships;
create policy "anon class memberships"
on public.class_memberships
for all to anon
using (true)
with check (true);

-- Testfordeling:
-- Mandag 17-18: Benny, Emma, Allan
-- Mandag 18-19: Camilla, Ole, Pia
-- Torsdag og søndag: begge mandagshold samlet.
delete from public.class_memberships
where person_id in (
  select id from public.people
  where name in ('Benny Hansen','Emma Larsen','Allan Maharaj','Camilla Friis','Ole Hansen','Pia Nielsen')
);

with test_people as (
  select id, name from public.people
  where name in ('Benny Hansen','Emma Larsen','Allan Maharaj','Camilla Friis','Ole Hansen','Pia Nielsen')
),
class_map as (
  select
    id,
    weekday,
    start_time,
    case
      when weekday = 1 and start_time = time '17:00' then 'monday_early'
      when weekday = 1 and start_time = time '18:00' then 'monday_late'
      when weekday in (4,7) then 'combined'
      else null
    end as group_key
  from public.classes
  where active = true
)
insert into public.class_memberships (class_id, person_id, active)
select c.id, p.id, true
from class_map c
cross join test_people p
where
  (c.group_key = 'monday_early' and p.name in ('Benny Hansen','Emma Larsen','Allan Maharaj'))
  or
  (c.group_key = 'monday_late' and p.name in ('Camilla Friis','Ole Hansen','Pia Nielsen'))
  or
  (c.group_key = 'combined')
on conflict (class_id, person_id) do update set active = excluded.active;

create or replace function public.get_class_roster_snapshot(
  p_class_id uuid,
  p_snapshot_date date
)
returns table (
  person_id uuid,
  name text,
  person_type text,
  payment_status text,
  clip_count integer,
  attended boolean
)
language sql
security definer
set search_path = public
as $$
  with selected_class as (
    select id, start_time, end_time
    from public.classes
    where id = p_class_id
  ),
  cutoff as (
    select
      p_snapshot_date::timestamp + coalesce(end_time, start_time, time '23:59') as cutoff_at
    from selected_class
  )
  select
    p.id,
    p.name,
    p.type::text,
    p.payment_status::text,
    case
      when p.type::text = 'gæst' then null
      else coalesce(
        (
          select ct.clip_count_after
          from public.clip_transactions ct, cutoff co
          where ct.person_id = p.id
            and ct.transaction_date <= co.cutoff_at
          order by ct.transaction_date desc, ct.created_at desc
          limit 1
        ),
        p.balance
      )
    end as clip_count,
    exists (
      select 1
      from public.attendance a
      join public.sessions s on s.id = a.session_id
      where a.person_id = p.id
        and s.class_id = p_class_id
        and s.session_date = p_snapshot_date
    ) as attended
  from public.class_memberships cm
  join public.people p on p.id = cm.person_id
  where cm.class_id = p_class_id
    and cm.active = true
  order by
    case when p.type::text = 'gæst' then 0 else 1 end,
    p.name;
$$;

grant execute on function public.get_class_roster_snapshot(uuid, date) to anon;

commit;
