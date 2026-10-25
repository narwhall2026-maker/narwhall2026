-- Private, short-lived invitations between two accepted Narwhall friends.
create table public.live_pong_invites (
 id uuid primary key default gen_random_uuid(),
 host_id uuid not null references public.profiles(id) on delete cascade,
 guest_id uuid not null references public.profiles(id) on delete cascade,
 background_key text,
 status text not null default 'pending' check(status in ('pending','accepted','declined','cancelled')),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '10 minutes',
 check(host_id<>guest_id)
);
alter table public.live_pong_invites enable row level security;
revoke all on public.live_pong_invites from public,anon,authenticated;
grant select on public.live_pong_invites to authenticated;
create policy pong_participants_read on public.live_pong_invites for select to authenticated
 using((host_id=(select auth.uid()) or guest_id=(select auth.uid())) and narwhall_private.are_friends(case when host_id=(select auth.uid()) then guest_id else host_id end));
create index pong_host on public.live_pong_invites(host_id,created_at desc);
create index pong_guest on public.live_pong_invites(guest_id,created_at desc);
create function narwhall_private.invite_live_pong(p_friend uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid; shared_key text;
begin
 if auth.uid() is null or not narwhall_private.are_friends(p_friend) then raise exception 'Choose an accepted friend';end if;
 perform id from public.profiles where id in (auth.uid(),p_friend) order by id for update;
 if exists(select 1 from public.live_pong_invites where (host_id in(auth.uid(),p_friend) or guest_id in(auth.uid(),p_friend)) and status in('pending','accepted') and expires_at>now()) then raise exception 'One of you already has a live invitation. Finish or leave it first.';end if;
 if (select count(*) from public.live_pong_invites where host_id=auth.uid() and created_at>now()-interval '1 hour')>=20 then raise exception 'Too many invitations. Try again later.';end if;
 select m.photo_url into shared_key from public.shared_moments s join public.moments m on m.id=s.moment_id
 where s.status='accepted' and ((s.from_user_id=auth.uid() and s.to_user_id=p_friend) or (s.from_user_id=p_friend and s.to_user_id=auth.uid()))
 and m.deleted_at is null and m.wall_scope='main'
 and exists(select 1 from public.moments c where c.user_id=s.to_user_id and c.photo_url=m.photo_url and c.deleted_at is null and c.wall_scope='main')
 order by s.created_at desc,s.id desc limit 1;
 insert into public.live_pong_invites(host_id,guest_id,background_key) values(auth.uid(),p_friend,shared_key) returning id into result;return result;
end $$;
create function public.invite_live_pong(p_friend uuid) returns uuid language sql security invoker set search_path='' as $$select narwhall_private.invite_live_pong(p_friend);$$;
create function narwhall_private.reply_live_pong(p_invite uuid,p_accept boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or p_accept is null then raise exception 'Sign in and choose a response';end if;
 update public.live_pong_invites set status=case when p_accept then 'accepted' else 'declined' end
 where id=p_invite and guest_id=auth.uid() and status='pending' and expires_at>now() and narwhall_private.are_friends(host_id);
 if not found then raise exception 'This invitation is no longer available';end if;
end $$;
create function public.reply_live_pong(p_invite uuid,p_accept boolean) returns void language sql security invoker set search_path='' as $$select narwhall_private.reply_live_pong(p_invite,p_accept);$$;
create function narwhall_private.close_live_pong(p_invite uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in first';end if;
 update public.live_pong_invites set status='cancelled' where id=p_invite and auth.uid() in(host_id,guest_id) and status in('pending','accepted');
end $$;
create function public.close_live_pong(p_invite uuid) returns void language sql security invoker set search_path='' as $$select narwhall_private.close_live_pong(p_invite);$$;
revoke all on function narwhall_private.invite_live_pong(uuid),narwhall_private.reply_live_pong(uuid,boolean),narwhall_private.close_live_pong(uuid),public.invite_live_pong(uuid),public.reply_live_pong(uuid,boolean),public.close_live_pong(uuid) from public,anon;
grant execute on function narwhall_private.invite_live_pong(uuid),narwhall_private.reply_live_pong(uuid,boolean),narwhall_private.close_live_pong(uuid),public.invite_live_pong(uuid),public.reply_live_pong(uuid,boolean),public.close_live_pong(uuid) to authenticated;

create or replace function public.notification_inbox() returns table(id text,kind text,actor_id uuid,created_at timestamptz,reference_id uuid,expires_at timestamptz)
language sql stable security invoker set search_path='' as $$
 select * from (
 select 'friend:'||f.id,'friend',f.sender_id,f.created_at,f.id,null::timestamptz from public.friend_requests f where f.receiver_id=auth.uid() and f.status='pending'
 union all select 'share:'||s.id,'share',s.from_user_id,s.created_at,s.id,null::timestamptz from public.shared_moments s where s.to_user_id=auth.uid() and s.status='pending'
 union all select 'locked:'||i.id,'locked',i.owner_id,i.created_at,i.id,i.expires_at from public.private_wall_invites i where i.viewer_id=auth.uid() and i.revoked_at is null and i.expires_at>now()
 union all select 'peek:'||p.id,'peek',p.owner_id,p.expires_at-interval '24 hours',p.id,p.expires_at from public.wall_peeks p where p.viewer_id=auth.uid() and p.expires_at>now()
 union all select 'challenge:'||c.id,'challenge',c.challenger_id,c.created_at,c.id,c.expires_at from public.game_challenges c where c.recipient_id=auth.uid() and c.status='pending' and c.expires_at>now()
 union all select 'result:'||c.id,'result',c.recipient_id,c.resolved_at,c.id,null::timestamptz from public.game_challenges c where c.challenger_id=auth.uid() and c.resolved_at is not null
 union all select 'deletion:'||r.id,'deletion',r.user_id,r.requested_at,r.id,r.delete_after from public.account_deletion_requests r where narwhall_private.is_admin() and r.user_id is not null and r.status in ('requested','approved','processing')
 union all select 'deletion-update:'||r.id,'deletion_update',r.user_id,r.reviewed_at,r.id,r.delete_after from public.account_deletion_requests r where r.user_id=auth.uid() and r.status in ('approved','declined') and r.reviewed_at is not null
 union all select 'pong:'||p.id,'pong',p.host_id,p.created_at,p.id,p.expires_at from public.live_pong_invites p where p.guest_id=auth.uid() and p.status='pending' and p.expires_at>now()
 union all select 'pong-ready:'||p.id,'pong',p.guest_id,p.created_at,p.id,p.expires_at from public.live_pong_invites p where p.host_id=auth.uid() and p.status='accepted' and p.expires_at>now()
 ) items order by 4 desc limit 100;
$$;
