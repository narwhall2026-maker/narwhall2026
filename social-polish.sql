create table public.account_preferences (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 onboarding_done boolean not null default false,
 notifications_seen_at timestamptz
);
alter table public.account_preferences enable row level security;
revoke all on public.account_preferences from public,anon,authenticated;
grant select,insert,update on public.account_preferences to authenticated;
create policy preferences_own on public.account_preferences to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create table public.game_runs (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,
 game text not null check(game in ('snake','bounce')),seed bigint not null,
 created_at timestamptz not null default now(),completed_at timestamptz,score integer check(score between 0 and 397)
);
alter table public.game_runs enable row level security;
revoke all on public.game_runs from public,anon,authenticated;
grant all on public.game_runs to service_role;
grant select on public.game_runs to authenticated;
create policy game_runs_own_read on public.game_runs for select to authenticated using(user_id=(select auth.uid()));
create index game_runs_owner on public.game_runs(user_id,created_at desc);
create table public.game_scores (
 user_id uuid references public.profiles(id) on delete cascade,game text not null check(game in ('snake','bounce')),
 score integer not null check(score between 0 and 397),run_id uuid not null references public.game_runs(id) on delete cascade,
 achieved_at timestamptz not null default now(),primary key(user_id,game)
);
alter table public.game_scores enable row level security;
revoke all on public.game_scores from public,anon,authenticated;
grant all on public.game_scores to service_role;grant select on public.game_scores to authenticated;
create policy scores_friends_read on public.game_scores for select to authenticated using(user_id=(select auth.uid()) or narwhall_private.are_friends(user_id));
create table public.game_challenges (
 id uuid primary key default gen_random_uuid(),challenger_id uuid not null references public.profiles(id) on delete cascade,
 recipient_id uuid not null references public.profiles(id) on delete cascade,game text not null check(game in ('snake','bounce')),
 target_score integer not null check(target_score>0),run_id uuid not null references public.game_runs(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','declined','won','tied','lost')),
 response_score integer,created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '7 days',resolved_at timestamptz,
 check(challenger_id<>recipient_id),unique(run_id,recipient_id)
);
alter table public.game_challenges enable row level security;
revoke all on public.game_challenges from public,anon,authenticated;
grant select on public.game_challenges to authenticated;
create policy challenges_participants_read on public.game_challenges for select to authenticated using(challenger_id=(select auth.uid()) or recipient_id=(select auth.uid()));
create index challenges_recipient on public.game_challenges(recipient_id,status,expires_at);
create function public.finish_verified_game(p_run uuid,p_user uuid,p_score integer) returns void
language plpgsql security invoker set search_path='' as $$
declare r public.game_runs;
begin
 update public.game_runs set completed_at=now(),score=p_score where id=p_run and user_id=p_user and completed_at is null returning * into r;
 if not found then raise exception 'This game has already been saved';end if;
 if (r.game='bounce' and (p_score>240 or p_score%10<>0)) or (r.game='snake' and p_score>397) then raise exception 'Invalid score';end if;
 insert into public.game_scores(user_id,game,score,run_id) values(p_user,r.game,p_score,p_run)
 on conflict(user_id,game) do update set score=excluded.score,run_id=excluded.run_id,achieved_at=now() where public.game_scores.score<excluded.score;
end $$;
revoke all on function public.finish_verified_game(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.finish_verified_game(uuid,uuid,integer) to service_role;
create function narwhall_private.challenge_friend(p_run uuid,p_friend uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.game_runs; result uuid;
begin
 if auth.uid() is null or not narwhall_private.are_friends(p_friend) then raise exception 'Choose an accepted friend';end if;
 select * into r from public.game_runs where id=p_run and user_id=auth.uid() and completed_at is not null and score>0;
 if not found then raise exception 'Save a score above zero first';end if;
 if (select count(*) from public.game_challenges where challenger_id=auth.uid() and created_at>now()-interval '1 day')>=30 then raise exception 'You have sent 30 challenges today. Try tomorrow.';end if;
 insert into public.game_challenges(challenger_id,recipient_id,game,target_score,run_id) values(auth.uid(),p_friend,r.game,r.score,p_run) on conflict(run_id,recipient_id) do nothing returning id into result;
 if result is null then raise exception 'You already sent this score to that friend';end if;return result;
end $$;
create function public.challenge_friend(p_run uuid,p_friend uuid) returns uuid language sql security invoker set search_path='' as $$select narwhall_private.challenge_friend(p_run,p_friend);$$;
create function narwhall_private.reply_game_challenge(p_challenge uuid,p_run uuid default null) returns text
language plpgsql security definer set search_path='' as $$
declare c public.game_challenges;r public.game_runs; outcome text;
begin
 select * into c from public.game_challenges where id=p_challenge and recipient_id=auth.uid() and status='pending' and expires_at>now() for update;
 if not found then raise exception 'Challenge is no longer available';end if;
 if p_run is null then outcome:='declined';else
  select * into r from public.game_runs where id=p_run and user_id=auth.uid() and game=c.game and completed_at is not null and created_at>=c.created_at;
  if not found then raise exception 'Play and save a new round for this challenge';end if;
  outcome:=case when r.score>c.target_score then 'won' when r.score=c.target_score then 'tied' else 'lost' end;
 end if;
 update public.game_challenges set status=outcome,response_score=r.score,resolved_at=now() where id=c.id;return outcome;
end $$;
create function public.reply_game_challenge(p_challenge uuid,p_run uuid default null) returns text language sql security invoker set search_path='' as $$select narwhall_private.reply_game_challenge(p_challenge,p_run);$$;
revoke all on function narwhall_private.challenge_friend(uuid,uuid),narwhall_private.reply_game_challenge(uuid,uuid) from public,anon;
revoke all on function public.challenge_friend(uuid,uuid),public.reply_game_challenge(uuid,uuid) from public,anon;
grant execute on function narwhall_private.challenge_friend(uuid,uuid),narwhall_private.reply_game_challenge(uuid,uuid),public.challenge_friend(uuid,uuid),public.reply_game_challenge(uuid,uuid) to authenticated;
create function public.notification_inbox() returns table(id text,kind text,actor_id uuid,created_at timestamptz,reference_id uuid,expires_at timestamptz)
language sql stable security invoker set search_path='' as $$
 select * from (
 select 'friend:'||f.id,'friend',f.sender_id,f.created_at,f.id,null::timestamptz from public.friend_requests f where f.receiver_id=auth.uid() and f.status='pending'
 union all select 'share:'||s.id,'share',s.from_user_id,s.created_at,s.id,null::timestamptz from public.shared_moments s where s.to_user_id=auth.uid() and s.status='pending'
 union all select 'locked:'||i.id,'locked',i.owner_id,i.created_at,i.id,i.expires_at from public.private_wall_invites i where i.viewer_id=auth.uid() and i.revoked_at is null and i.expires_at>now()
 union all select 'peek:'||p.id,'peek',p.owner_id,p.expires_at-interval '24 hours',p.id,p.expires_at from public.wall_peeks p where p.viewer_id=auth.uid() and p.expires_at>now()
 union all select 'challenge:'||c.id,'challenge',c.challenger_id,c.created_at,c.id,c.expires_at from public.game_challenges c where c.recipient_id=auth.uid() and c.status='pending' and c.expires_at>now()
 union all select 'result:'||c.id,'result',c.recipient_id,c.resolved_at,c.id,null::timestamptz from public.game_challenges c where c.challenger_id=auth.uid() and c.resolved_at is not null
 ) items order by 4 desc limit 100;
$$;
revoke all on function public.notification_inbox() from public,anon;grant execute on function public.notification_inbox() to authenticated;
create function narwhall_private.check_account_deletion(confirmation text,account_email text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); email text;
begin
 select u.email into email from auth.users u where u.id=uid;
 if uid is null or email is null or confirmation is distinct from 'DELETE' or lower(btrim(account_email)) is distinct from lower(email) then raise exception 'Confirm DELETE and your account email' using errcode='42501';end if;
 if not exists(select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) a where a->>'method'='password' and (a->>'timestamp')::numeric>extract(epoch from now()-interval '10 minutes')) then raise exception 'Sign in again with your password before deleting your account' using errcode='42501';end if;
 return uid;
end $$;
create function public.account_deletion_ready(confirmation text,account_email text) returns boolean language sql security invoker set search_path='' as $$ select narwhall_private.check_account_deletion(confirmation,account_email) is not null; $$;
create function narwhall_private.delete_own_account(confirmation text,account_email text) returns boolean
language plpgsql security definer set search_path='' as $$
declare uid uuid;
begin
 uid:=narwhall_private.check_account_deletion(confirmation,account_email);
 -- Remove uploaded-photo copies too, so friends are not left with broken images.
 delete from public.moments where split_part(photo_url,'/',1)=uid::text;
 delete from auth.users where id=uid;
 return true;
end $$;
create function public.delete_own_account(confirmation text,account_email text) returns boolean language sql security invoker set search_path='' as $$select narwhall_private.delete_own_account(confirmation,account_email);$$;
revoke all on function narwhall_private.check_account_deletion(text,text),narwhall_private.delete_own_account(text,text),public.account_deletion_ready(text,text),public.delete_own_account(text,text) from public,anon;
grant execute on function narwhall_private.check_account_deletion(text,text),narwhall_private.delete_own_account(text,text),public.account_deletion_ready(text,text),public.delete_own_account(text,text) to authenticated;
