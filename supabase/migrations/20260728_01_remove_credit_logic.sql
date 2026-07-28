begin;

-- Normalisér kun ugyldige legacy-tilstande. Historik slettes ikke.
update public.people
set
  balance = greatest(coalesce(balance, 0), 0),
  payment_status = case
    when greatest(coalesce(balance, 0), 0) = 0
      then 'skal_betale'::public.payment_status
    else 'ok'::public.payment_status
  end,
  updated_at = now()
where type = 'medlem'::public.person_type
  and (
    balance < 0
    or payment_status::text = 'blokeret'
  );

alter table public.people
  drop constraint if exists member_balance_between_minus_one_and_ten;

alter table public.people
  drop constraint if exists member_balance_between_zero_and_ten;

alter table public.people
  add constraint member_balance_between_zero_and_ten check (
    balance is null or balance between 0 and 10
  );

alter table public.people
  drop constraint if exists person_state_is_consistent;

alter table public.people
  add constraint person_state_is_consistent check (
    (
      type = 'gæst'::public.person_type
      and balance is null
      and payment_status = 'skal_betale'::public.payment_status
    )
    or
    (
      type = 'medlem'::public.person_type
      and balance between 1 and 10
      and payment_status = 'ok'::public.payment_status
    )
    or
    (
      type = 'medlem'::public.person_type
      and balance = 0
      and payment_status = 'skal_betale'::public.payment_status
    )
  );

alter table public.attendance
  drop constraint if exists attendance_type_no_credit;

alter table public.attendance
  add constraint attendance_type_no_credit check (
    type::text in ('normal', 'prøvetime')
  );

-- Fjern legacy-indgange, der kan omgå 0-10-reglen.
drop function if exists public.register_attendance(uuid, text, public.attendance_type);
drop function if exists public.purchase_clips(uuid, integer, text);
drop function if exists public.register_payment(uuid, numeric, integer, text);

commit;

notify pgrst, 'reload schema';
