begin;
create index moments_wall_recent on public.moments(user_id,wall_scope,created_at desc,id desc) where deleted_at is null;
create function narwhall_private.is_recent_wall_moment(moment uuid, owner uuid, scope text) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and scope in ('main','private') and exists(
 select 1 from (select m.id from public.moments m where m.user_id=owner and m.wall_scope=scope and m.deleted_at is null order by m.created_at desc,m.id desc limit 10) recent where recent.id=moment)
$$;
revoke all on function narwhall_private.is_recent_wall_moment(uuid,uuid,text) from public,anon,authenticated;
grant execute on function narwhall_private.is_recent_wall_moment(uuid,uuid,text) to authenticated;
alter policy moments_read on public.moments using(user_id=(select auth.uid()) or (deleted_at is null and narwhall_private.is_recent_wall_moment(id,user_id,wall_scope) and ((wall_scope='main' and narwhall_private.can_peek(user_id)) or (wall_scope='private' and narwhall_private.can_view_private_wall(user_id)))));
commit;
