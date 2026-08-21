# Chord Vault v1.9.1 — Leader Exit Safety

Feature update for the BandAid GitHub Pages PWA.

## Added
- If the Worship Leader/session creator taps Leave, the live session is ended for everyone.
- All connected band-member devices are automatically removed from the active session UI.
- Members who leave only remove themselves; they do not end the session.
- Ended sessions cannot be joined again.
- Devices reopening an old saved session detect that it has ended and clear it.

## Supabase migration
Before deploying/testing this version, run `supabase_v1_9_1_leader_exit.sql` once in the Supabase SQL Editor.

This release keeps the /BandAid/ PWA scope, v1.9 live cues, role picker, Singer Key Tester, BPM, and Backup & Restore.
