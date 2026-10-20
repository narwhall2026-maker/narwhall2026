-- Admin membership is managed only through the database, never by app users.
create table narwhall_private.admin_members (
 user_id uuid primary key references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
alter table narwhall_private.admin_members enable row level security;
revoke all on narwhall_private.admin_members from public,anon,authenticated;
create function narwhall_private.is_admin() returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from narwhall_private.admin_members a join auth.users u on u.id=a.user_id where a.user_id=auth.uid() and u.email_confirmed_at is not null);
$$;
revoke all on function narwhall_private.is_admin() from public,anon;
grant execute on function narwhall_private.is_admin() to authenticated;
create function public.is_narwhall_admin() returns boolean
language sql stable security invoker set search_path='' as $$ select narwhall_private.is_admin(); $$;
revoke all on function public.is_narwhall_admin() from public,anon;
grant execute on function public.is_narwhall_admin() to authenticated;
create policy moments_admin_read on public.moments for select to authenticated
using (deleted_at is null and (select narwhall_private.is_admin()));
create function narwhall_private.admin_account_list(search_text text default '',page_number integer default 0)
returns table(user_id uuid,email text,username text,main_photo_count bigint,private_photo_count bigint)
language plpgsql stable security definer set search_path='' as $$
begin
 if not narwhall_private.is_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 return query select u.id,u.email::text,p.username,
 (select count(*) from public.moments m where m.user_id=u.id and m.wall_scope='main' and m.deleted_at is null),
 (select count(*) from public.moments m where m.user_id=u.id and m.wall_scope='private' and m.deleted_at is null)
 from auth.users u left join public.profiles p on p.id=u.id
 where starts_with(lower(coalesce(u.email,'')),lower(left(coalesce(search_text,''),100)))
 or starts_with(lower(coalesce(p.username,'')),lower(left(coalesce(search_text,''),100)))
 order by u.created_at desc,u.id limit 25 offset least(greatest(coalesce(page_number,0),0),100000)*25;
end; $$;
revoke all on function narwhall_private.admin_account_list(text,integer) from public,anon;
grant execute on function narwhall_private.admin_account_list(text,integer) to authenticated;
create function public.admin_account_list(search_text text default '',page_number integer default 0)
returns table(user_id uuid,email text,username text,main_photo_count bigint,private_photo_count bigint)
language sql stable security invoker set search_path='' as $$ select * from narwhall_private.admin_account_list(search_text,page_number); $$;
revoke all on function public.admin_account_list(text,integer) from public,anon;
grant execute on function public.admin_account_list(text,integer) to authenticated;
create or replace function public.photo_access(photo_key text) returns boolean language sql stable security invoker set search_path='' as $$
 select auth.uid() is not null and (
 exists(select 1 from public.moments m where m.photo_url=photo_key and m.deleted_at is null and (narwhall_private.is_admin() or m.user_id=auth.uid() or (m.wall_scope='main' and narwhall_private.can_peek(m.user_id)) or (m.wall_scope='private' and narwhall_private.can_view_private_wall(m.user_id))))
 or exists(select 1 from public.community_posts p where p.photo_url=photo_key and p.deleted_at is null and p.removed_at is null and (p.user_id=auth.uid() or not narwhall_private.community_blocked(p.user_id))));
$$;
