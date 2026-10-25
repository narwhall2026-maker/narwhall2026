begin;
create table public.community_posts (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 caption text not null default '' check(char_length(caption)<=15),
 photo_url text not null check(photo_url ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}[.](jpg|png|webp)$'),
 created_at timestamptz not null default now(),
 deleted_at timestamptz,
 removed_at timestamptz
);
create index community_recent on public.community_posts(created_at desc,id desc) where deleted_at is null and removed_at is null;
create index community_author on public.community_posts(user_id);
create index community_photo on public.community_posts(photo_url);
create table public.community_blocks (
 blocker_id uuid not null references public.profiles(id) on delete cascade,
 blocked_id uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(blocker_id,blocked_id),check(blocker_id<>blocked_id)
);
create index community_blocks_reverse on public.community_blocks(blocked_id,blocker_id);
create table public.community_reports (
 id uuid primary key default gen_random_uuid(),
 post_id uuid not null references public.community_posts(id) on delete cascade,
 reporter_id uuid not null references public.profiles(id) on delete cascade,
 reason text not null check(reason in ('spam','harassment','inappropriate','other')),
 created_at timestamptz not null default now(),
 status text not null default 'pending' check(status in ('pending','reviewed','dismissed')),
 unique(post_id,reporter_id)
);
create index community_reporter on public.community_reports(reporter_id);
create index community_reports_pending on public.community_reports(created_at) where status='pending';
alter table public.community_posts enable row level security;
alter table public.community_blocks enable row level security;
alter table public.community_reports enable row level security;
revoke all on public.community_posts,public.community_blocks,public.community_reports from public,anon,authenticated;
grant select on public.community_posts,public.community_blocks,public.community_reports to authenticated;
grant insert(user_id,caption,photo_url),update(deleted_at) on public.community_posts to authenticated;
grant insert(blocker_id,blocked_id),delete on public.community_blocks to authenticated;
grant insert(post_id,reporter_id,reason) on public.community_reports to authenticated;
create function narwhall_private.community_blocked(other_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.community_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=other_id) or (b.blocked_id=auth.uid() and b.blocker_id=other_id))
$$;
revoke all on function narwhall_private.community_blocked(uuid) from public,anon,authenticated;
grant execute on function narwhall_private.community_blocked(uuid) to authenticated;
create policy community_read on public.community_posts for select to authenticated using(removed_at is null and (user_id=(select auth.uid()) or (deleted_at is null and not narwhall_private.community_blocked(user_id))));
create policy community_insert on public.community_posts for insert to authenticated with check(user_id=(select auth.uid()) and split_part(photo_url,'/',1)=(select auth.uid())::text and deleted_at is null and removed_at is null);
create policy community_hide on public.community_posts for update to authenticated using(user_id=(select auth.uid()) and removed_at is null) with check(user_id=(select auth.uid()) and deleted_at is not null);
create policy community_blocks_read on public.community_blocks for select to authenticated using(blocker_id=(select auth.uid()));
create policy community_blocks_insert on public.community_blocks for insert to authenticated with check(blocker_id=(select auth.uid()));
create policy community_blocks_delete on public.community_blocks for delete to authenticated using(blocker_id=(select auth.uid()));
create policy community_reports_read on public.community_reports for select to authenticated using(reporter_id=(select auth.uid()));
create policy community_reports_insert on public.community_reports for insert to authenticated with check(reporter_id=(select auth.uid()) and status='pending' and exists(select 1 from public.community_posts p where p.id=post_id and p.user_id<>(select auth.uid())));
create or replace function public.photo_access(photo_key text) returns boolean language sql stable security invoker set search_path='' as $$
 select auth.uid() is not null and (
 exists(select 1 from public.moments m where m.photo_url=photo_key and m.deleted_at is null and (m.user_id=auth.uid() or (m.wall_scope='main' and narwhall_private.can_peek(m.user_id)) or (m.wall_scope='private' and narwhall_private.can_view_private_wall(m.user_id))))
 or exists(select 1 from public.community_posts p where p.photo_url=photo_key and p.deleted_at is null and p.removed_at is null and (p.user_id=auth.uid() or not narwhall_private.community_blocked(p.user_id))))
$$;
create view public.admin_community_reports with (security_invoker=true) as select r.id as report_id,r.reason,r.status,r.created_at as reported_at,r.reporter_id,reporter.username as reporter_username,p.id as post_id,p.user_id as author_id,author.username as author_username,p.caption,p.photo_url,p.created_at as posted_at,p.deleted_at,p.removed_at from public.community_reports r join public.community_posts p on p.id=r.post_id left join public.profiles author on author.id=p.user_id left join public.profiles reporter on reporter.id=r.reporter_id;
revoke all on public.admin_community_reports from public,anon,authenticated,service_role;
comment on view public.admin_community_reports is 'Dashboard-only Community moderation queue. Set community_posts.removed_at to take down a post and community_reports.status to record review.';
commit;
