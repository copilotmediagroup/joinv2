begin;

-- Profile bios are intentionally compact social identity copy. Keep the same
-- authority at the database boundary so clients cannot bypass the UI limit.
alter table public.user_profiles
  drop constraint if exists user_profiles_bio_length_check;

alter table public.user_profiles
  add constraint user_profiles_bio_length_check
  check (bio is null or char_length(bio) <= 120);

commit;
