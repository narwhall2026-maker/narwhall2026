begin;
alter table public.moments add column wall_scope text not null default 'main' check(wall_scope in ('main','private'));
grant insert(wall_scope) on public.moments to authenticated;
create table public.private_wall_invites (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id) on delete cascade,
 viewer_id uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '24 hours',
 revoked_at timestamptz,
 check(owner_id<>viewer_id), check(expires_at=created_at+interval '24 hours')
);
create index private_invite_access on public.private_wall_invites(viewer_id,owner_id,expires_at) where revoked_at is null;
alter table public.private_wall_invites enable row level security;
revoke all on public.private_wall_invites from anon,authenticated;
grant select on public.private_wall_invites to authenticated;
grant insert(owner_id,viewer_id) on public.private_wall_invites to authenticated;
grant update(revoked_at) on public.private_wall_invites to authenticated;
create policy private_invites_read on public.private_wall_invites for select to authenticated using(owner_id=(select auth.uid()) or viewer_id=(select auth.uid()));
create policy private_invites_insert on public.private_wall_invites for insert to authenticated with check(owner_id=(select auth.uid()) and revoked_at is null and narwhall_private.are_friends(viewer_id));
create policy private_invites_revoke on public.private_wall_invites for update to authenticated using(owner_id=(select auth.uid()) and revoked_at is null) with check(owner_id=(select auth.uid()) and revoked_at is not null);
create function narwhall_private.can_view_private_wall(owner uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.private_wall_invites i where i.owner_id=owner and i.viewer_id=auth.uid() and i.revoked_at is null and i.expires_at>now())
$$;
revoke all on function narwhall_private.can_view_private_wall(uuid) from public,anon,authenticated;
grant execute on function narwhall_private.can_view_private_wall(uuid) to authenticated;
alter policy moments_read on public.moments using(user_id=(select auth.uid()) or (deleted_at is null and ((wall_scope='main' and narwhall_private.can_peek(user_id)) or (wall_scope='private' and narwhall_private.can_view_private_wall(user_id)))));
alter policy shares_insert on public.shared_moments with check(from_user_id=(select auth.uid()) and status='pending' and expires_at is null and narwhall_private.are_friends(to_user_id) and exists(select 1 from public.moments m where m.id=moment_id and m.user_id=(select auth.uid()) and m.deleted_at is null and m.wall_scope='main'));
create or replace function public.photo_access(photo_key text) returns boolean language sql stable security invoker set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.moments m where m.photo_url=photo_key and m.deleted_at is null and (m.user_id=auth.uid() or (m.wall_scope='main' and narwhall_private.can_peek(m.user_id)) or (m.wall_scope='private' and narwhall_private.can_view_private_wall(m.user_id))))
$$;
create or replace function narwhall_private.reply_shared(request_id uuid, accept boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.shared_moments; m public.moments; copied uuid; expiry timestamptz;
begin
 if auth.uid() is null then raise exception 'Log in first'; end if;
 select * into r from public.shared_moments where id=request_id and to_user_id=auth.uid() for update;
 if not found then raise exception 'Shared moment not found'; end if;
 if r.status <> 'pending' then return null; end if;
 if not accept then update public.shared_moments set status='declined' where id=r.id; return null; end if;
 select * into m from public.moments where id=r.moment_id and user_id=r.from_user_id and deleted_at is null and wall_scope='main';
 if not found then raise exception 'This moment is no longer available'; end if;
 insert into public.moments(user_id,caption,photo_url,position_x,position_y,rotation) values(auth.uid(),m.caption,m.photo_url,m.position_x,m.position_y,m.rotation) returning id into copied;
 expiry := now()+interval '24 hours';
 update public.shared_moments set status='accepted',expires_at=expiry where id=r.id;
 insert into public.wall_peeks(owner_id,viewer_id,shared_moment_id,expires_at) values(r.from_user_id,auth.uid(),r.id,expiry);
 return copied;
end; $$;
commit;
