begin;

-- Migration 0045: remove SECURITY DEFINER behavior from the unused
-- public_profiles compatibility view and keep profile access behind
-- explicit authenticated RPC contracts.
alter view public.public_profiles set (security_invoker = true);
revoke all on table public.public_profiles from public,anon,authenticated;

commit;
