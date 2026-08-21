# Chord Vault v1.8 — Worship Cues + Singer Key Tester

This release keeps the BandAid GitHub Pages PWA configuration and all v1.7 song/backup features.

## New in v1.8

- Added **Worship Leader** role.
- Added **Drum** role.
- Worship Leader has cue buttons for **Verse 1, Chorus, Bridge, Last Line, Build Up**.
- Cue UI includes a local same-origin preview using BroadcastChannel/localStorage. This lets multiple tabs/windows on the same browser profile demonstrate the live cue experience.
- **Important:** true cross-device live cues require a shared realtime backend (for example Supabase Realtime or Firebase). No cloud credentials are bundled in this static GitHub Pages build.
- Singers now get a **Key Tester** in the song reader. It reads the song key/chord chart and synthesizes a short chord accompaniment in a selected key.
- The Key Tester is not the original recording and does not reproduce the vocal melody; it is a generated harmonic reference for testing comfortable keys.
- Subtle version indicator updated to **v1.8**.
- Backup/restore remains compatible and now accepts the Worship Leader and Drum roles.

## Deployment

Upload all files to the root of the `BandAid` repository. GitHub Pages should remain configured for `main` → `/(root)`.

The PWA remains scoped to `/BandAid/` and uses the isolated cache `bandaid-chord-vault-v1.8`.
