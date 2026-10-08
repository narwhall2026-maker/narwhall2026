begin;
create schema if not exists narwhall_private;
revoke all on schema narwhall_private from public;
grant usage on schema narwhall_private to authenticated;

create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 username text unique not null check (username ~ '^[a-z0-9_]{3,24}$'),
 display_name text,
 created_at timestamptz not null default now()
);
create table public.friend_requests (
 id uuid primary key default gen_random_uuid(),
 sender_id uuid not null references public.profiles(id) on delete cascade,
 receiver_id uuid not null references public.profiles(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','accepted','declined')),
 created_at timestamptz not null default now(),
 check(sender_id <> receiver_id)
);
create unique index friendship_pair on public.friend_requests(least(sender_id,receiver_id),greatest(sender_id,receiver_id));
create index friend_receiver on public.friend_requests(receiver_id,status);
create index friend_sender on public.friend_requests(sender_id,status);
create table public.moments (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 caption text not null check(char_length(caption) between 1 and 15),
 photo_url text not null check(photo_url ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}[.](jpg|png|webp)$'),
 position_x real not null default 10 check(position_x between 0 and 100),
 position_y real not null default 10 check(position_y between 0 and 100),
 rotation real not null default 0 check(rotation between -20 and 20),
 deleted_at timestamptz,
 created_at timestamptz not null default now()
);
create index moments_owner on public.moments(user_id,created_at desc) where deleted_at is null;
create index moments_photo on public.moments(photo_url);
create table public.shared_moments (
 id uuid primary key default gen_random_uuid(),
 moment_id uuid not null references public.moments(id) on delete cascade,
 from_user_id uuid not null references public.profiles(id) on delete cascade,
 to_user_id uuid not null references public.profiles(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','accepted','declined')),
 expires_at timestamptz,
 created_at timestamptz not null default now(),
 unique(moment_id,to_user_id), check(from_user_id <> to_user_id)
);
create index shares_recipient on public.shared_moments(to_user_id,status);
create index shares_sender on public.shared_moments(from_user_id,status);
create table public.wall_peeks (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id) on delete cascade,
 viewer_id uuid not null references public.profiles(id) on delete cascade,
 shared_moment_id uuid unique not null references public.shared_moments(id) on delete cascade,
 expires_at timestamptz not null
);
create index peeks_viewer on public.wall_peeks(viewer_id,owner_id,expires_at);

create function narwhall_private.are_friends(other_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select auth.uid() is not null and exists(select 1 from public.friend_requests f where f.status='accepted' and ((f.sender_id=auth.uid() and f.receiver_id=other_id) or (f.receiver_id=auth.uid() and f.sender_id=other_id)))
$$;
create function narwhall_private.can_peek(owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select auth.uid() is not null and exists(select 1 from public.wall_peeks p where p.owner_id=owner and p.viewer_id=auth.uid() and p.expires_at>now())
$$;
create function narwhall_private.create_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 insert into public.profiles(id,username) values(new.id,lower(new.raw_user_meta_data->>'username'));
 return new;
end; $$;
create trigger narwhall_signup after insert on auth.users for each row execute function narwhall_private.create_profile();

alter table public.profiles enable row level security;
alter table public.friend_requests enable row level security;
alter table public.moments enable row level security;
alter table public.shared_moments enable row level security;
alter table public.wall_peeks enable row level security;
create policy profiles_read on public.profiles for select to authenticated using(true);
create policy profiles_update on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));
create policy friends_read on public.friend_requests for select to authenticated using(sender_id=(select auth.uid()) or receiver_id=(select auth.uid()));
create policy friends_insert on public.friend_requests for insert to authenticated with check(sender_id=(select auth.uid()) and status='pending');
create policy friends_reply on public.friend_requests for update to authenticated using(receiver_id=(select auth.uid()) and status='pending') with check(receiver_id=(select auth.uid()) and status in ('accepted','declined'));
create policy moments_read on public.moments for select to authenticated using(user_id=(select auth.uid()) or (deleted_at is null and narwhall_private.can_peek(user_id)));
create policy moments_insert on public.moments for insert to authenticated with check(user_id=(select auth.uid()) and split_part(photo_url,'/',1)=(select auth.uid())::text);
create policy moments_update on public.moments for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy shares_read on public.shared_moments for select to authenticated using(from_user_id=(select auth.uid()) or to_user_id=(select auth.uid()));
create policy shares_insert on public.shared_moments for insert to authenticated with check(from_user_id=(select auth.uid()) and status='pending' and expires_at is null and narwhall_private.are_friends(to_user_id) and exists(select 1 from public.moments m where m.id=moment_id and m.user_id=(select auth.uid()) and m.deleted_at is null));
create policy peeks_read on public.wall_peeks for select to authenticated using(owner_id=(select auth.uid()) or viewer_id=(select auth.uid()));

revoke all on public.profiles,public.friend_requests,public.moments,public.shared_moments,public.wall_peeks from anon,authenticated;
grant select on public.profiles,public.friend_requests,public.moments,public.shared_moments,public.wall_peeks to authenticated;
grant update(username,display_name) on public.profiles to authenticated;
grant insert(sender_id,receiver_id) on public.friend_requests to authenticated;
grant update(status) on public.friend_requests to authenticated;
grant insert(user_id,caption,photo_url,position_x,position_y,rotation) on public.moments to authenticated;
grant update(caption,position_x,position_y,rotation,deleted_at) on public.moments to authenticated;
grant insert(moment_id,from_user_id,to_user_id) on public.shared_moments to authenticated;

create function narwhall_private.reply_shared(request_id uuid, accept boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.shared_moments; m public.moments; copied uuid; expiry timestamptz;
begin
 if auth.uid() is null then raise exception 'Log in first'; end if;
 select * into r from public.shared_moments where id=request_id and to_user_id=auth.uid() for update;
 if not found then raise exception 'Shared moment not found'; end if;
 if r.status <> 'pending' then return null; end if;
 if not accept then update public.shared_moments set status='declined' where id=r.id; return null; end if;
 select * into m from public.moments where id=r.moment_id and user_id=r.from_user_id and deleted_at is null;
 if not found then raise exception 'This moment is no longer available'; end if;
 insert into public.moments(user_id,caption,photo_url,position_x,position_y,rotation) values(auth.uid(),m.caption,m.photo_url,m.position_x,m.position_y,m.rotation) returning id into copied;
 expiry := now()+interval '24 hours';
 update public.shared_moments set status='accepted',expires_at=expiry where id=r.id;
 insert into public.wall_peeks(owner_id,viewer_id,shared_moment_id,expires_at) values(r.from_user_id,auth.uid(),r.id,expiry);
 return copied;
end; $$;
create function public.reply_shared_moment(request_id uuid, accept boolean) returns uuid
language sql security invoker set search_path = '' as $$select narwhall_private.reply_shared(request_id,accept)$$;

create function public.photo_access(photo_key text) returns boolean
language sql stable security invoker set search_path = '' as $$
 select auth.uid() is not null and exists(select 1 from public.moments m where m.photo_url=photo_key and m.deleted_at is null and (m.user_id=auth.uid() or narwhall_private.can_peek(m.user_id)))
$$;
revoke all on all functions in schema narwhall_private from public,anon,authenticated;
grant execute on function narwhall_private.are_friends(uuid),narwhall_private.can_peek(uuid),narwhall_private.reply_shared(uuid,boolean) to authenticated;
revoke all on function public.reply_shared_moment(uuid,boolean),public.photo_access(text) from public,anon;
grant execute on function public.reply_shared_moment(uuid,boolean),public.photo_access(text) to authenticated;
commit;
