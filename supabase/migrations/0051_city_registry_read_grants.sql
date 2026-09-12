begin;

-- SIGNAL Migration 0051: city registry browser read contract.
-- Onboarding searches active cities + states directly. RLS already limits
-- both tables to active rows; grant only SELECT to browser roles.

grant select on table public.cities to anon, authenticated;
grant select on table public.states to anon, authenticated;

commit;
