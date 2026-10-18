# Narwhall

Private photo moments, 15-character captions, friends, shared moments, and 24-hour wall peeks.

## Live services

- Frontend: https://narwhall2026.vercel.app
- Supabase project: `vjugsidfdovuwtxgcvrz` (accounts and database)
- Cloudflare Worker: https://narwhall-media.narwhall2026.workers.dev
- Private R2 bucket: `narwhall-moments`

Photos upload directly to Cloudflare through an authenticated Worker. The browser compresses them to JPEG at a maximum 1600px and 2 MB. Downloads check database ownership or an active wall peek before reading the private R2 bucket. Shared-photo acceptance is atomic and repeat-safe. New photos do not use Supabase Storage. Existing `wall_photos` data is preserved separately.

## Build

Requires Node 24. Run `npm run check` then `npm run build`. Deploy `dist/` as a static site. No build dependencies are required. The browser loads Supabase JS from jsDelivr.

## Database

`schema.sql` records the initial migration, already applied to the live project. Do not rerun it against that project. RLS protects every app table. Friendships use user IDs, not mutable usernames. Only recipients can accept requests. Private helper functions use a fixed search path and restricted execution grants.

## Cloudflare

`cloudflare-worker.js` is deployed as `narwhall-media`. It binds `PHOTOS` to `narwhall-moments`, `SUPABASE_URL` to the project URL, and `SUPABASE_KEY` to the publishable key. It needs no Supabase service-role key or R2 secret. CORS permits the production app domains only. New origins must be explicitly added. The bucket must remain private.

The current upload safeguard is 100 stored photos per account and 2 MB per photo. Hidden photos remain stored so accepted shared copies continue working. R2 egress is free; storage, operations, Worker requests, and Supabase metadata still have service limits. Configure usage alerts in the provider dashboards.

## Email configuration required for public launch

In Supabase Auth → URL Configuration, use `https://narwhall2026.vercel.app` as Site URL and allow it as a redirect URL. Configure an SMTP provider for public confirmation and password-reset email delivery. The default Supabase mail service is restricted and is unsuitable for public signup. Email confirmation remains enabled. Do not put SMTP credentials or service-role keys in frontend files.

Private wall: moments use a separate `wall_scope` (main/private). Apply `private-wall.sql` after the initial schema for existing installs. Only the owner can see private moments unless they invite an accepted friend for 24 hours; access can be revoked early. Ordinary shared moments unlock only the main wall. Private moments cannot enter the sharing/copy flow. R2 authorization checks the same permissions for every photo request. Invitations appear in Friends. The viewer rechecks permission every 15 seconds and upon returning to the tab. Screenshots and previously saved images cannot be erased by revoking access.

Memories: the owner's wall shows the latest 10 moments per wall. Memories displays all non-hidden photos by local calendar week (Monday–Sunday), with a date picker and 24-photo pagination. Main and private history remain separate. Apply `memories.sql` after `private-wall.sql`; database permissions limit visitors to the newest 10 per invited wall, including photo downloads. Explicitly accepted shared copies remain on the recipient's own wall.


Community wall: authenticated members can explicitly post photos independently of their personal/locked walls. The continuous feed uses keyset pagination (created_at + id), 20 posts per page, with automatic loading near the bottom and a Load more fallback. Leaving the screen releases photo blob URLs. Authors can remove their posts. Report and Community-only block/unblock controls are available; blocks hide Community posts and downloads in both directions. Existing personal-wall friendships/peeks are unaffected. No private or personal photos are automatically published. Community photo downloads reuse the authenticated R2 Worker and `photo_access` permission checks.

Apply `community-wall.sql` after earlier app schemas. Review reports in Supabase `admin_community_reports`; set `community_posts.removed_at` to remove a post and update `community_reports.status` when reviewed. Moderation is manual; no automatic image scanning is introduced. Reports and moderation actions are not available to ordinary app users. The existing 100-upload account limit also counts Community uploads.
