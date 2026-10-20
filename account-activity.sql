create table narwhall_private.account_activity(
 user_id uuid primary key references auth.users(id) on delete cascade,
 last_active_at timestamptz not null default now(),
 device_type text not null check(device_type in ('Phone','Tablet','Computer','Unknown')),
 operating_system text not null,
 browser text not null
);
alter table narwhall_private.account_activity enable row level security;
revoke all on narwhall_private.account_activity from public,anon,authenticated;
create policy account_activity_no_client_access on narwhall_private.account_activity to authenticated using(false) with check(false);
create function narwhall_private.record_account_activity() returns void
language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=auth.uid(); ua text:=left(coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'user-agent',''),1024);
 os text; browser_name text; device text;
begin
 if uid is null or not exists(select 1 from auth.users where id=uid) then raise exception 'Login required' using errcode='42501';end if;
 os:=case when ua~*'Android' then 'Android' when ua~*'iPhone|iPad|iPod' then 'iOS / iPadOS' when ua~*'Windows' then 'Windows' when ua~*'CrOS' then 'ChromeOS' when ua~*'Macintosh|Mac OS X' then 'macOS' when ua~*'Linux' then 'Linux' else 'Unknown' end;
 device:=case when ua~*'iPad|Tablet' or (ua~*'Android' and ua!~*'Mobile') then 'Tablet' when ua~*'iPhone|iPod|Mobile' then 'Phone' when os in ('Windows','ChromeOS','macOS','Linux') then 'Computer' else 'Unknown' end;
 browser_name:=case when ua~*'Edg/|EdgiOS/|EdgA/' then 'Edge' when ua~*'OPR/|OPiOS/' then 'Opera' when ua~*'SamsungBrowser/' then 'Samsung Internet' when ua~*'Firefox/|FxiOS/' then 'Firefox' when ua~*'Chrome/|CriOS/' then 'Chrome' when ua~*'Safari/' then 'Safari' else 'Unknown' end;
 insert into narwhall_private.account_activity as a(user_id,last_active_at,device_type,operating_system,browser)
 values(uid,now(),device,os,browser_name)
 on conflict(user_id) do update set last_active_at=excluded.last_active_at,device_type=excluded.device_type,operating_system=excluded.operating_system,browser=excluded.browser
 where a.last_active_at<now()-interval '60 seconds';
end $$;
revoke all on function narwhall_private.record_account_activity() from public,anon;
grant execute on function narwhall_private.record_account_activity() to authenticated;
create function public.record_account_activity() returns void language sql volatile security invoker set search_path='' as $$select narwhall_private.record_account_activity();$$;
revoke all on function public.record_account_activity() from public,anon;
grant execute on function public.record_account_activity() to authenticated;
create or replace view public.admin_accounts with(security_invoker=true) as
select u.id as user_id,u.email,p.username,u.created_at as joined_at,u.email_confirmed_at,u.last_sign_in_at,
 coalesce(c.main_photo_count,0::bigint) as main_photo_count,coalesce(c.private_photo_count,0::bigint) as private_photo_count,
 (u.email_confirmed_at is not null) as email_verified,a.last_active_at,
 coalesce(a.last_active_at>now()-interval '5 minutes',false) as active_recently,
 a.device_type,a.operating_system,a.browser
from auth.users u left join public.profiles p on p.id=u.id
left join (select user_id,count(*) filter(where wall_scope='main') as main_photo_count,count(*) filter(where wall_scope='private') as private_photo_count from public.moments where deleted_at is null group by user_id)c on c.user_id=u.id
left join narwhall_private.account_activity a on a.user_id=u.id;
revoke all on public.admin_accounts from public,anon,authenticated;
