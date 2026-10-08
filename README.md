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
