begin;

-- ============================================================
-- SIGNAL / joinv2
-- 0007_signal_activity_policy_authority.sql
--
-- Purpose:
--   1. Establish stable grouping-policy family authority.
--   2. Keep grouping policy versions separate from activity
--      catalog identity.
--   3. Add approved V1 grouping policies where missing.
--   4. Map production activities to policy families.
--
-- Architecture:
--
--   activity
--     -> grouping_policy_code (stable family)
--     -> latest active grouping_policies version at formation
--     -> exact grouping_policy_id persisted on signal_groups
--
-- Important:
--   - Activities do NOT point to a specific policy version.
--   - Existing signal_groups are NOT rewritten.
--   - Existing grouping policy rows are NOT rewritten.
--   - Existing fixture activities are NOT deleted.
--   - "creative" remains the production activity slug for now.
--     It maps to the stable "fun" policy family.
-- ============================================================


-- ============================================================
-- 1. GROUPING POLICY FAMILY AUTHORITY
-- ============================================================

create table public.grouping_policy_families (
  code text primary key,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),

  constraint grouping_policy_families_code_nonempty_check
    check (length(btrim(code)) > 0)
);

comment on table public.grouping_policy_families is
  'Stable grouping-policy family identities. Individual grouping_policies rows are versioned implementations of these families.';


-- ============================================================
-- 2. PRESERVE EVERY EXISTING POLICY FAMILY
--
-- Existing grouping policy codes may include development/test
-- fixtures. Preserve them rather than assuming only production
-- codes exist.
-- ============================================================

insert into public.grouping_policy_families (
  code
)
select distinct
  gp.code
from public.grouping_policies gp
where gp.code is not null
  and length(btrim(gp.code)) > 0
on conflict (code) do nothing;


-- ============================================================
-- 3. ENSURE APPROVED PRODUCTION POLICY FAMILIES EXIST
-- ============================================================

insert into public.grouping_policy_families (
  code
)
values
  ('drinks'),
  ('sports'),
  ('fun'),
  ('food'),
  ('music'),
  ('outdoors'),
  ('chill'),
  ('explore'),
  ('nightlife')
on conflict (code) do nothing;


-- ============================================================
-- 4. BIND VERSIONED POLICIES TO STABLE FAMILIES
--
-- grouping_policies.code remains the family identity used by
-- formation. The existing (code, version) uniqueness remains
-- the version authority.
-- ============================================================

alter table public.grouping_policies
  add constraint grouping_policies_code_family_fkey
  foreign key (code)
  references public.grouping_policy_families(code)
  on update restrict
  on delete restrict;


-- ============================================================
-- 5. APPROVED V1 POLICY CONTRACT
--
-- drinks      3 / 5 / 8
-- sports      4 / 6 / 10
-- fun         3 / 5 / 8
-- food        3 / 4 / 6
-- music       3 / 5 / 8
-- outdoors    3 / 6 / 10
-- chill       2 / 4 / 6
-- explore     3 / 5 / 8
-- nightlife   5 / 6 / 8
--
-- Existing rows are never silently overwritten.
-- If a code/version already exists with different values,
-- abort the migration rather than mutating history.
-- ============================================================

do $$
declare
  mismatch record;
begin
  with approved (
    code,
    version,
    activation_threshold,
    target_capacity,
    max_capacity
  ) as (
    values
      ('drinks',    1, 3, 5,  8),
      ('sports',    1, 4, 6, 10),
      ('fun',       1, 3, 5,  8),
      ('food',      1, 3, 4,  6),
      ('music',     1, 3, 5,  8),
      ('outdoors',  1, 3, 6, 10),
      ('chill',     1, 2, 4,  6),
      ('explore',   1, 3, 5,  8),
      ('nightlife', 1, 5, 6,  8)
  )
  select
    gp.code,
    gp.version,
    gp.activation_threshold,
    gp.target_capacity,
    gp.max_capacity,
    a.activation_threshold as approved_activation_threshold,
    a.target_capacity as approved_target_capacity,
    a.max_capacity as approved_max_capacity
  into mismatch
  from approved a
  join public.grouping_policies gp
    on gp.code = a.code
   and gp.version = a.version
  where
    gp.activation_threshold <> a.activation_threshold
    or gp.target_capacity <> a.target_capacity
    or gp.max_capacity <> a.max_capacity
  limit 1;

  if found then
    raise exception
      'Existing grouping policy %.v% is %/%/% but approved contract requires %/%/%',
      mismatch.code,
      mismatch.version,
      mismatch.activation_threshold,
      mismatch.target_capacity,
      mismatch.max_capacity,
      mismatch.approved_activation_threshold,
      mismatch.approved_target_capacity,
      mismatch.approved_max_capacity;
  end if;
end;
$$;


insert into public.grouping_policies (
  code,
  version,
  activation_threshold,
  target_capacity,
  max_capacity,
  is_active
)
values
  ('drinks',    1, 3, 5,  8, true),
  ('sports',    1, 4, 6, 10, true),
  ('fun',       1, 3, 5,  8, true),
  ('food',      1, 3, 4,  6, true),
  ('music',     1, 3, 5,  8, true),
  ('outdoors',  1, 3, 6, 10, true),
  ('chill',     1, 2, 4,  6, true),
  ('explore',   1, 3, 5,  8, true),
  ('nightlife', 1, 5, 6,  8, true)
on conflict (code, version) do nothing;


-- ============================================================
-- 6. ACTIVITY -> POLICY FAMILY AUTHORITY
--
-- Nullable by design:
--   Existing fixtures/custom activities are not forced into a
--   production mapping that has not been explicitly approved.
-- ============================================================

alter table public.activities
  add column grouping_policy_code text;

comment on column public.activities.grouping_policy_code is
  'Stable grouping-policy family code. Formation resolves this family to the latest active grouping_policies version and persists that exact policy row on the Signal group.';


-- ============================================================
-- 7. MAP CURRENT PRODUCTION ACTIVITIES
--
-- The current production "creative" activity is intentionally
-- preserved. It maps to the approved "fun" policy family.
-- ============================================================

with production_mapping (
  activity_slug,
  policy_code
) as (
  values
    ('drinks',    'drinks'),
    ('sports',    'sports'),
    ('creative',  'fun'),
    ('food',      'food'),
    ('music',     'music'),
    ('outdoors',  'outdoors'),
    ('chill',     'chill'),
    ('explore',   'explore'),
    ('nightlife', 'nightlife')
)
update public.activities a
set grouping_policy_code = pm.policy_code
from production_mapping pm
where a.slug = pm.activity_slug;


-- ============================================================
-- 8. VERIFY ALL NINE PRODUCTION ACTIVITIES WERE MAPPED
--
-- Fail rather than silently ship an incomplete production
-- catalog relationship.
-- ============================================================

do $$
declare
  missing_slugs text;
begin
  with required(activity_slug) as (
    values
      ('drinks'),
      ('sports'),
      ('creative'),
      ('food'),
      ('music'),
      ('outdoors'),
      ('chill'),
      ('explore'),
      ('nightlife')
  )
  select string_agg(r.activity_slug, ', ' order by r.activity_slug)
  into missing_slugs
  from required r
  left join public.activities a
    on a.slug = r.activity_slug
  where a.id is null
     or a.grouping_policy_code is null;

  if missing_slugs is not null then
    raise exception
      'Required production activities missing policy-family mapping: %',
      missing_slugs;
  end if;
end;
$$;


-- ============================================================
-- 9. REFERENTIAL INTEGRITY
-- ============================================================

alter table public.activities
  add constraint activities_grouping_policy_code_fkey
  foreign key (grouping_policy_code)
  references public.grouping_policy_families(code)
  on update restrict
  on delete restrict;


-- ============================================================
-- 10. AUTHENTICATED CATALOG READ
--
-- Existing activities RLS remains authoritative.
-- This only exposes the new non-sensitive catalog field through
-- the already-established authenticated activity read boundary.
-- ============================================================

grant select (
  grouping_policy_code
)
on public.activities
to authenticated;


-- ============================================================
-- 11. CONTRACT COMMENTS
-- ============================================================

comment on constraint grouping_policies_code_family_fkey
on public.grouping_policies is
  'Each versioned grouping policy belongs to one stable grouping-policy family.';

comment on constraint activities_grouping_policy_code_fkey
on public.activities is
  'Activities reference a grouping-policy family, never a specific grouping-policy version.';


commit;
