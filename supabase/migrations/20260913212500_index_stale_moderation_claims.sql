begin;

create index if not exists user_reports_stale_claim_idx
on public.user_reports(claimed_at)
where state='reviewing' and claimed_at is not null;

create index if not exists signal_moment_reports_stale_claim_idx
on public.signal_moment_reports(claimed_at)
where state='reviewed' and claimed_at is not null;

comment on index public.user_reports_stale_claim_idx
is 'Supports bounded recovery of abandoned moderator claims without scanning the full user report queue.';

comment on index public.signal_moment_reports_stale_claim_idx
is 'Supports bounded recovery of abandoned moderator claims without scanning the full Moment report queue.';

commit;
