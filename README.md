# BandAid / Chord Vault v2.1 — Account & Admin Beta

This is the first account-based BandAid beta. It consolidates the unreleased v2.0/v2.0.1 work and should be installed directly over the current v1.9.2 frontend.

## New in v2.1
- Username-only accounts with a **6-digit numeric PIN**; users are never asked for a real email address.
- New account registration is protected by a server-validated **beta invite code**.
- One designated **Admin** account controls the official Master Song Library.
- Shared **Master Library** is read-only for normal users.
- Every user can create and save a **private editable personal copy** of a Master song without changing the official version.
- Chords + lyrics, key, BPM, capo, tabs, chord shapes and personal notes are supported in personal copies.
- Users can change their own PIN inside BandAid.
- Admin dashboard shows registered users and active live sessions.
- Live sessions use a Worship Leader heartbeat. Sessions with no leader heartbeat for more than 3 minutes are marked **Stale**.
- Admin can manually end any active/stale session for everyone.
- Admin can securely issue a user's temporary 6-digit PIN through a Supabase Edge Function. After login, that user is forced to choose a new PIN.
- Existing Worship Leader cues, live session codes, leader-exit safety, Singer Key Tester, backups and `/BandAid/` PWA behaviour remain.

## Important PIN security note
A 6-digit PIN is intentionally simpler than a conventional password and therefore has less entropy. Use this only for the small private beta, keep the beta invite code private, and configure conservative Supabase Auth rate limits. The app never places a service-role/secret key in the browser.

## Setup — use only this migration
Because v2.0 and v2.0.1 were never rolled out, **do not run their SQL files**. Run only:

`supabase_v2_1_consolidated.sql`

Before running it, replace `CHANGE_THIS_BETA_CODE` with a private beta code.

Also go to Supabase **Authentication → Providers → Email** and turn **Confirm email OFF**. BandAid maps usernames to internal synthetic `@bandaid.invalid` identifiers; users never provide an email address.

For a 6-digit PIN to work, Supabase Auth's minimum password length must not be set above 6, and any character-complexity requirement must permit digits-only credentials. For the private beta, set the minimum to 6. Compensate by keeping Auth rate limiting enabled/tight.

## Create the Admin
1. Deploy the v2.1 frontend to `/BandAid/`.
2. Create your own BandAid account first using the beta invite code.
3. In SQL Editor run:

```sql
update public.profiles
set is_admin = true
where username = 'YOUR_USERNAME';
```

4. Verify exactly one admin:

```sql
select username, is_admin
from public.profiles
where is_admin = true;
```

Log out/in once after promotion so the Admin controls appear.

## Deploy the Admin PIN Reset Edge Function
The folder `supabase/functions/admin-reset-pin/` contains the Edge Function source. Create a Supabase Edge Function named exactly:

`admin-reset-pin`

and deploy the included `index.ts` source. The function verifies the signed-in caller, checks `profiles.is_admin`, and only then uses Supabase's server-side admin API to reset another user's PIN. The service-role credential remains server-side in the Edge Function environment and is never embedded in BandAid.

If your Supabase project does not expose the legacy `SUPABASE_SERVICE_ROLE_KEY` environment variable to Edge Functions, add it as an Edge Function secret using your project's server-side service-role/secret value. Never put that value in GitHub or `app.js`.

## Beta tester flow
1. Open BandAid.
2. Choose **Create account**.
3. Enter a username, 6-digit PIN, and the beta invite code.
4. Regular users are never made Admin automatically.
5. They can read official songs, make private song copies, select roles, and join live sessions.

## Forgotten PIN flow
1. Admin opens **Admin → User PIN Reset**.
2. Select the username and enter a temporary 6-digit PIN.
3. Tell the temporary PIN to that user privately.
4. User logs in and BandAid immediately requires them to choose a new 6-digit PIN.

## Live-session housekeeping
The Worship Leader app sends a heartbeat every 60 seconds. Admin → Live Sessions shows:
- active session count,
- stale session count,
- leader username,
- member count,
- start time,
- last leader heartbeat.

Admin can end a session manually. All connected clients receive the existing Realtime `band_sessions` update and are removed from that live session.
