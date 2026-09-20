begin;
insert into public.grouping_policies(code,version,activation_threshold,target_capacity,max_capacity,is_active)
select 'chill',2,2,2,2,true where not exists(select 1 from public.grouping_policies where code='chill' and version=2);
comment on table public.chill_dating_preferences is 'Private explicit opt-in preferences for two-person Chill matching; active Chill policy is pair-only.';
commit;
