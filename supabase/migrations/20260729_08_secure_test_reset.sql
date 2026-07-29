begin;

-- Test-reset må aldrig kunne kaldes fra den offentlige browserklient.
-- Funktionen bevares til kontrolleret brug fra Supabase SQL Editor/service_role.
revoke all on function public.reset_all_test_data(text)
from public, anon, authenticated;

grant execute on function public.reset_all_test_data(text)
to service_role;

commit;

notify pgrst, 'reload schema';
