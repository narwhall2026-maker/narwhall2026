-- Five distinct, currently saved main-wall photos unlock Community.
create function narwhall_private.community_photo_count() returns integer
language sql stable security definer set search_path='' as $$
 select count(*)::integer from (select distinct m.photo_url from public.moments m
 where auth.uid() is not null and m.user_id=auth.uid() and m.wall_scope='main' and m.deleted_at is null limit 5) photos;
$$;
revoke all on function narwhall_private.community_photo_count() from public,anon;
grant execute on function narwhall_private.community_photo_count() to authenticated;
create function narwhall_private.community_unlocked() returns boolean
language sql stable security invoker set search_path='' as $$ select narwhall_private.community_photo_count()>=5; $$;
revoke all on function narwhall_private.community_unlocked() from public,anon;
grant execute on function narwhall_private.community_unlocked() to authenticated;
create function public.community_access_status() returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('photo_count',n,'unlocked',n>=5) from (select narwhall_private.community_photo_count() as n) s;
$$;
revoke all on function public.community_access_status() from public,anon;
grant execute on function public.community_access_status() to authenticated;
create policy community_unlock_read on public.community_posts as restrictive for select to authenticated
using ((select narwhall_private.community_unlocked()));
create policy community_unlock_insert on public.community_posts as restrictive for insert to authenticated
with check ((select narwhall_private.community_unlocked()));
