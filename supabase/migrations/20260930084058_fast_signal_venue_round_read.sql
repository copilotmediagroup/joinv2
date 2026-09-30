create or replace function public.get_my_signal_venue_round(
  p_signal_group_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_round public.signal_venue_rounds%rowtype;
  v_activity_slug text;
  v_city_slug text;
  v_places jsonb;
  v_vote_counts jsonb;
  v_current_option_id uuid;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.signal_group_memberships m
    join public.signal_groups g on g.id = m.signal_group_id
    where m.signal_group_id = p_signal_group_id
      and m.user_id = v_user_id
      and m.state in ('matched', 'confirmed')
      and g.state in ('locked', 'coordinating')
  ) then
    raise exception 'signal_membership_required' using errcode = '42501';
  end if;

  select r.*
  into v_round
  from public.signal_venue_rounds r
  where r.signal_group_id = p_signal_group_id
  order by r.round_number desc
  limit 1;

  if v_round.id is null then
    return null;
  end if;

  select a.slug, c.slug
  into v_activity_slug, v_city_slug
  from public.signal_groups g
  join public.activities a on a.id = g.activity_id
  join public.cities c on c.id = g.city_id
  where g.id = p_signal_group_id;

  select coalesce(
    jsonb_agg(o.payload || jsonb_build_object('optionId', o.id) order by o.source_rank),
    '[]'::jsonb
  )
  into v_places
  from public.signal_venue_options o
  where o.round_id = v_round.id;

  select coalesce(jsonb_object_agg(v.option_id::text, v.vote_count), '{}'::jsonb)
  into v_vote_counts
  from (
    select option_id, count(*)::integer as vote_count
    from public.signal_venue_votes
    where round_id = v_round.id
    group by option_id
  ) v;

  select vv.option_id
  into v_current_option_id
  from public.signal_venue_votes vv
  where vv.round_id = v_round.id
    and vv.user_id = v_user_id
  limit 1;

  return jsonb_build_object(
    'version', 'signal-venue-vote-v1',
    'source', 'database',
    'query', null,
    'activitySlug', v_activity_slug,
    'citySlug', v_city_slug,
    'round', jsonb_build_object(
      'id', v_round.id,
      'roundNumber', v_round.round_number,
      'roundKind', v_round.round_kind,
      'state', v_round.state,
      'opensAt', v_round.opens_at,
      'closesAt', v_round.closes_at,
      'winnerOptionId', v_round.winner_option_id,
      'eligibleVoterCount', v_round.eligible_voter_count,
      'majorityRequired', v_round.majority_required,
      'currentUserOptionId', v_current_option_id,
      'voteCounts', v_vote_counts
    ),
    'places', v_places
  );
end;
$$;

revoke all on function public.get_my_signal_venue_round(uuid) from public;
revoke all on function public.get_my_signal_venue_round(uuid) from anon;
grant execute on function public.get_my_signal_venue_round(uuid) to authenticated;
