begin;
create table public.wall_names (
 user_id uuid not null references public.profiles(id) on delete cascade,
 wall_scope text not null check(wall_scope in ('main','private')),
 name text not null check(char_length(btrim(name)) between 1 and 30),
 primary key(user_id,wall_scope)
);
alter table public.wall_names enable row level security;
revoke all on public.wall_names from public,anon,authenticated;
grant select on public.wall_names to authenticated;
grant insert(user_id,wall_scope,name),update(name) on public.wall_names to authenticated;
create policy wall_names_read on public.wall_names for select to authenticated using(user_id=(select auth.uid()) or (wall_scope='main' and narwhall_private.can_peek(user_id)) or (wall_scope='private' and narwhall_private.can_view_private_wall(user_id)));
create policy wall_names_insert on public.wall_names for insert to authenticated with check(user_id=(select auth.uid()));
create policy wall_names_update on public.wall_names for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
commit;
