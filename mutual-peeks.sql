begin;
alter table public.wall_peeks drop constraint wall_peeks_shared_moment_id_key;
alter table public.wall_peeks add constraint wall_peeks_share_direction_key unique(shared_moment_id,owner_id,viewer_id);
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
 insert into public.wall_peeks(owner_id,viewer_id,shared_moment_id,expires_at) values(r.from_user_id,auth.uid(),r.id,expiry),(auth.uid(),r.from_user_id,r.id,expiry);
 return copied;
end; $$;

insert into public.wall_peeks(owner_id,viewer_id,shared_moment_id,expires_at) select p.viewer_id,p.owner_id,p.shared_moment_id,p.expires_at from public.wall_peeks p join public.shared_moments s on s.id=p.shared_moment_id where s.status='accepted' and p.expires_at>now() on conflict(shared_moment_id,owner_id,viewer_id) do nothing;
commit;
