-- Disable the previous immediate-deletion API before introducing the review queue.
create or replace function public.account_deletion_ready(confirmation text,account_email text) returns boolean language sql security invoker set search_path='' as $$select false;$$;
create or replace function narwhall_private.delete_own_account(confirmation text,account_email text) returns boolean language plpgsql security definer set search_path='' as $$begin raise exception 'Immediate deletion is disabled. Request deletion from Profile.' using errcode='42501';end;$$;
create table public.account_deletion_requests (
 id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id) on delete set null,
 requested_at timestamptz not null default now(),delete_after timestamptz not null default now()+interval '30 days',
 status text not null default 'requested' check(status in ('requested','approved','declined','cancelled','processing','completed')),
 reviewed_by uuid references auth.users(id) on delete set null,reviewed_at timestamptz,review_notes text not null default '' check(char_length(review_notes)<=500),
 photos_reviewed boolean not null default false,processing_admin uuid references auth.users(id) on delete set null,
 processing_started_at timestamptz,deletion_token uuid,completed_at timestamptz,
 check(delete_after>=requested_at+interval '30 days')
);
create unique index one_active_deletion_request on public.account_deletion_requests(user_id) where status in ('requested','approved','processing');
create index deletion_review_queue on public.account_deletion_requests(status,delete_after);
alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from public,anon,authenticated;
grant select(id,user_id,requested_at,delete_after,status,reviewed_at,review_notes,photos_reviewed,processing_started_at,completed_at) on public.account_deletion_requests to authenticated;
create policy deletion_request_read on public.account_deletion_requests for select to authenticated using(user_id=(select auth.uid()) or (select narwhall_private.is_admin()));
create function narwhall_private.request_account_deletion(confirmation text,account_email text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid;result uuid;stamp timestamptz:=clock_timestamp();
begin
 uid:=narwhall_private.check_account_deletion(confirmation,account_email);
 -- The profile lock serialises repeated requests without resetting the waiting period.
 perform 1 from public.profiles where id=uid for update;
 select id into result from public.account_deletion_requests where user_id=uid and status in ('requested','approved','processing');
 if result is not null then return result;end if;
 insert into public.account_deletion_requests(user_id,requested_at,delete_after) values(uid,stamp,stamp+interval '30 days') returning id into result;return result;
end $$;
create function public.request_account_deletion(confirmation text,account_email text) returns uuid language sql security invoker set search_path='' as $$select narwhall_private.request_account_deletion(confirmation,account_email);$$;
create function narwhall_private.cancel_account_deletion(p_request uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 update public.account_deletion_requests set status='cancelled' where id=p_request and user_id=auth.uid() and status in ('requested','approved');
 if not found then raise exception 'This request cannot be cancelled. Final deletion may already have started.';end if;return true;
end $$;
create function public.cancel_account_deletion(p_request uuid) returns boolean language sql security invoker set search_path='' as $$select narwhall_private.cancel_account_deletion(p_request);$$;
create function narwhall_private.review_account_deletion(p_request uuid,p_approve boolean,p_photos_reviewed boolean,p_notes text default '') returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if not narwhall_private.is_admin() then raise exception 'Admin access required' using errcode='42501';end if;
 if p_approve is null or (p_approve and p_photos_reviewed is distinct from true) then raise exception 'Review the account and photos, then confirm the review.';end if;
 if char_length(coalesce(p_notes,''))>500 then raise exception 'Keep review notes to 500 characters.';end if;
 update public.account_deletion_requests set status=case when p_approve then 'approved' else 'declined' end,reviewed_by=auth.uid(),reviewed_at=now(),photos_reviewed=coalesce(p_photos_reviewed,false),review_notes=coalesce(p_notes,'')
 where id=p_request and user_id is not null and status in ('requested','approved');
 if not found then raise exception 'This request is no longer awaiting review.';end if;return true;
end $$;
create function public.review_account_deletion(p_request uuid,p_approve boolean,p_photos_reviewed boolean,p_notes text default '') returns boolean language sql security invoker set search_path='' as $$select narwhall_private.review_account_deletion(p_request,p_approve,p_photos_reviewed,p_notes);$$;
create function narwhall_private.admin_deletion_queue(p_page integer default 0) returns table(id uuid,user_id uuid,email text,username text,requested_at timestamptz,delete_after timestamptz,status text,review_notes text,photos_reviewed boolean,main_photo_count bigint,private_photo_count bigint)
language plpgsql stable security definer set search_path='' as $$
begin
 if not narwhall_private.is_admin() then raise exception 'Admin access required' using errcode='42501';end if;
 return query select r.id,r.user_id,u.email::text,p.username,r.requested_at,r.delete_after,r.status,r.review_notes,r.photos_reviewed,
 (select count(*) from public.moments m where m.user_id=r.user_id and m.wall_scope='main' and m.deleted_at is null),
 (select count(*) from public.moments m where m.user_id=r.user_id and m.wall_scope='private' and m.deleted_at is null)
 from public.account_deletion_requests r join auth.users u on u.id=r.user_id left join public.profiles p on p.id=r.user_id
 where r.status in ('requested','approved','processing') order by r.delete_after,r.id limit 25 offset least(greatest(coalesce(p_page,0),0),100000)*25;
end $$;
create function public.admin_deletion_queue(p_page integer default 0) returns table(id uuid,user_id uuid,email text,username text,requested_at timestamptz,delete_after timestamptz,status text,review_notes text,photos_reviewed boolean,main_photo_count bigint,private_photo_count bigint)
language sql stable security invoker set search_path='' as $$select * from narwhall_private.admin_deletion_queue(p_page);$$;
create function narwhall_private.begin_reviewed_deletion(p_request uuid,confirmation text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.account_deletion_requests;t uuid;
begin
 if not narwhall_private.is_admin() or confirmation is distinct from 'DELETE' then raise exception 'Admin access and DELETE confirmation required' using errcode='42501';end if;
 if not exists(select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) a where a->>'method'='password' and (a->>'timestamp')::numeric>extract(epoch from now()-interval '10 minutes')) then raise exception 'Confirm your admin password again before permanent deletion' using errcode='42501';end if;
 select * into r from public.account_deletion_requests where id=p_request for update;
 if not found or r.user_id is null or r.delete_after>now() or r.photos_reviewed is distinct from true or r.reviewed_at is null or r.reviewed_by is null then raise exception 'Deletion requires the full 30-day wait and an approved photo review.' using errcode='42501';end if;
 if r.status='processing' then
  if r.processing_admin is distinct from auth.uid() and r.processing_started_at>now()-interval '10 minutes' then raise exception 'Another admin is completing this deletion. Try again later.';end if;
 elsif r.status<>'approved' then raise exception 'This request has not been approved for deletion.' using errcode='42501';end if;
 t:=gen_random_uuid();
 update public.account_deletion_requests set status='processing',processing_admin=auth.uid(),processing_started_at=now(),deletion_token=t where id=r.id;
 return jsonb_build_object('user_id',r.user_id,'token',t);
end $$;
create function public.begin_reviewed_deletion(p_request uuid,confirmation text) returns jsonb language sql security invoker set search_path='' as $$select narwhall_private.begin_reviewed_deletion(p_request,confirmation);$$;
create function narwhall_private.finish_reviewed_deletion(p_request uuid,p_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.account_deletion_requests;
begin
 if not narwhall_private.is_admin() then raise exception 'Admin access required' using errcode='42501';end if;
 select * into r from public.account_deletion_requests where id=p_request for update;
 if not found or r.status<>'processing' or r.processing_admin is distinct from auth.uid() or r.deletion_token is distinct from p_token or p_token is null or r.delete_after>now() or r.photos_reviewed is distinct from true or r.reviewed_at is null then raise exception 'Deletion is not authorised' using errcode='42501';end if;
 delete from public.moments where split_part(photo_url,'/',1)=r.user_id::text;
 delete from auth.users where id=r.user_id;
 update public.account_deletion_requests set status='completed',completed_at=now(),deletion_token=null where id=p_request;
 return true;
end $$;
create function public.finish_reviewed_deletion(p_request uuid,p_token uuid) returns boolean language sql security invoker set search_path='' as $$select narwhall_private.finish_reviewed_deletion(p_request,p_token);$$;
create function narwhall_private.account_available() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from auth.users u where u.id=auth.uid()) and not exists(select 1 from public.account_deletion_requests r where r.user_id=auth.uid() and r.status='processing');
$$;
create function public.account_available() returns boolean language sql stable security invoker set search_path='' as $$select narwhall_private.account_available();$$;
revoke all on function narwhall_private.request_account_deletion(text,text),narwhall_private.cancel_account_deletion(uuid),narwhall_private.review_account_deletion(uuid,boolean,boolean,text),narwhall_private.admin_deletion_queue(integer),narwhall_private.begin_reviewed_deletion(uuid,text),narwhall_private.finish_reviewed_deletion(uuid,uuid),narwhall_private.account_available(),public.request_account_deletion(text,text),public.cancel_account_deletion(uuid),public.review_account_deletion(uuid,boolean,boolean,text),public.admin_deletion_queue(integer),public.begin_reviewed_deletion(uuid,text),public.finish_reviewed_deletion(uuid,uuid),public.account_available() from public,anon;
grant execute on function narwhall_private.request_account_deletion(text,text),narwhall_private.cancel_account_deletion(uuid),narwhall_private.review_account_deletion(uuid,boolean,boolean,text),narwhall_private.admin_deletion_queue(integer),narwhall_private.begin_reviewed_deletion(uuid,text),narwhall_private.finish_reviewed_deletion(uuid,uuid),narwhall_private.account_available(),public.request_account_deletion(text,text),public.cancel_account_deletion(uuid),public.review_account_deletion(uuid,boolean,boolean,text),public.admin_deletion_queue(integer),public.begin_reviewed_deletion(uuid,text),public.finish_reviewed_deletion(uuid,uuid),public.account_available() to authenticated;

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
 ) items order by 4 desc limit 100;
$$;
