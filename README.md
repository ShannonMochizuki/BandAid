# Chord Vault v1.5 — BandAid Migration

This build migrates Chord Vault from the old `Guitar.github.io` project path to the new `BandAid` repository while keeping the v1.4 role libraries and BPM feature.

Live GitHub Pages path:
https://shannonmochizuki.github.io/BandAid/

## Included features

- Separate libraries for Singers, Electric Guitar, Acoustic Guitar, and Bass Guitar.
- BPM field for song chords.
- Existing chord/tab/song functionality from v1.4.
- Independent PWA identity and service-worker scope for BandAid.

## PWA configuration

- ID: `/BandAid/`
- Start URL: `/BandAid/`
- Scope: `/BandAid/`
- Service-worker cache: `bandaid-chord-vault-v1.5`
- Service worker only handles requests under `/BandAid/`.

## Install / update

Upload every file in this ZIP to the root of the `BandAid` repository. GitHub Pages should remain configured as `main` branch → `/(root)`.

Because both the old and new project sites are under the same `shannonmochizuki.github.io` origin, browser localStorage remains available to the app. The PWA identity itself is new, however, so remove the old installed Guitar/Chord Vault PWA if you no longer need it and install the BandAid version from the new site.
