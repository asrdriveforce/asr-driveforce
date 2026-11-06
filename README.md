# ASR DriveForce

Car/driver logging. Operators scan a car QR then a driver QR; admins search who was in which car at any time.

## Setup
1. Supabase: create project, run `supabase/schema.sql` in SQL Editor.
2. Create the admin user: Authentication → Users → Add user (auto-confirm). Then in SQL Editor:
   `update profiles set role='admin', full_name='Your Name' where id = (select id from auth.users where email='you@example.com');`
3. Copy `.env.example` to `.env` and fill in Project URL and anon key (Settings → API).
4. `npm install`, `npm run dev` locally, or deploy to Vercel with the same two env vars.

## Codes
QR payloads: `DF:C:<code>` car, `DF:D:<code>` driver, `DF:PC:<code>` park one car, `DF:PA:ALL` park all.
Driver links `/d/<code>` also scan as drivers.
