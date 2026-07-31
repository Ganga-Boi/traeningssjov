begin;

grant select on table public.people to service_role;
grant select on table public.sessions to service_role;
grant select on table public.classes to service_role;

commit;

notify pgrst, 'reload schema';
