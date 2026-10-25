alter table public.moments drop constraint moments_caption_check;
alter table public.moments add constraint moments_caption_check check(char_length(caption)<=15);
alter table public.moments alter column caption set default '';
alter table public.community_posts drop constraint community_posts_caption_check;
alter table public.community_posts add constraint community_posts_caption_check check(char_length(caption)<=15);
alter table public.community_posts alter column caption set default '';

