begin;
create or replace function public.search_signal_profiles(p_query text,p_limit integer default 12)
returns table(user_id uuid,display_name text,avatar_path text,city_name text,state_code text)
language plpgsql stable security definer set search_path=public,pg_temp
as $function$
declare v_viewer uuid:=auth.uid(); v_query text:=left(btrim(coalesce(p_query,'')),80); v_limit integer:=least(greatest(coalesce(p_limit,12),1),24);
begin
 if v_viewer is null then raise exception 'authentication_required' using errcode='42501'; end if;
 if char_length(v_query)<2 then return; end if;
 return query select up.user_id,coalesce(up.display_name,'SIGNAL member'),up.avatar_path,c.name,s.code
 from public.user_profiles up left join public.cities c on c.id=up.home_city_id left join public.states s on s.id=c.state_id
 where up.completion_state='complete'::public.profile_completion_state and up.user_id<>v_viewer
 and up.display_name ilike '%' || v_query || '%' and not public.users_have_block_relation(v_viewer,up.user_id)
 order by case when lower(up.display_name)=lower(v_query) then 0 when lower(up.display_name) like lower(v_query) || '%' then 1 else 2 end,lower(up.display_name),up.user_id limit v_limit;
end;$function$;
alter function public.search_signal_profiles(text,integer) owner to postgres;
revoke all on function public.search_signal_profiles(text,integer) from public,anon;
grant execute on function public.search_signal_profiles(text,integer) to authenticated;
comment on function public.search_signal_profiles(text,integer) is 'Bounded authenticated people search over completed public profile identity only. Excludes caller, blocked relationships, private matching preferences and protected account fields.';
commit;
