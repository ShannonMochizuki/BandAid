# Chord Vault v1.9 — Live Sessions

BandAid / Chord Vault now connects Worship Leader cues between different phones through Supabase Realtime.

## New
- Worship Leader can create a six-character live session.
- Singers, Electric Guitar, Acoustic Guitar, Bass Guitar and Drum can join using the session code.
- Worship cues are sent through Supabase and appear on other connected phones.
- Anonymous Supabase authentication keeps each device identifiable without requiring band members to create accounts.
- Worship Leader membership is protected server-side: joining users cannot self-assign the Worship Leader role.
- Existing local preview cue transport remains as a same-device fallback.

## Important setup step
Before testing v1.9, run `supabase_v1_9_security.sql` once in the Supabase SQL Editor. This tightens the earlier membership policy and adds the secure session-creation function used by the app.

## Hosting
Configured for GitHub Pages at `/BandAid/`.

## Data
Song library remains local to the browser/device. Backup & Restore remains available. Supabase is currently used only for live sessions/cues.
