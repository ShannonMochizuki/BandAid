# Chord Vault v1.6 — Backup & Restore

This release adds portable backup and restore to the BandAid version of Chord Vault while keeping the v1.5 `/BandAid/` PWA configuration intact.

## New in v1.6

- **Export Backup** creates a dated `.json` file containing the complete BandAid song library.
- Backups include song title, artist, role/instrument, key, capo, BPM, chord chart, tabs, chord shapes, notes, timestamps, and the active role.
- **Restore Backup** validates a selected JSON backup before changing local data.
- Restore offers two choices:
  - **Merge**: keep current songs and add/update songs from the backup. If the same song ID exists in both places, the newer `updatedAt` copy wins.
  - **Replace**: replace the current BandAid library with the backup.
- The export is deliberately limited to Chord Vault's own song data; it does not dump unrelated `localStorage` used by other apps on `shannonmochizuki.github.io`.
- Backups include format/schema metadata so future BandAid versions can migrate older backup files safely.

## Existing features retained

- Separate libraries for Singers, Electric Guitar, Acoustic Guitar, and Bass Guitar.
- BPM field.
- Song chords, guitar tabs, chord shapes, and performance notes.
- Independent BandAid PWA identity and scope.

## PWA configuration

- ID: `/BandAid/`
- Start URL: `/BandAid/`
- Scope: `/BandAid/`
- Service-worker cache: `bandaid-chord-vault-v1.6`

## Install / update

Upload every file in this ZIP to the root of the `BandAid` repository and replace the previous v1.5 files. GitHub Pages remains `main` branch → `/(root)`.

Updating the app files does not intentionally delete the current song library. The new Backup & Restore feature is there so you can also keep a portable copy outside browser storage.
