# Chord Vault v1.8.1 — PWA Update Fix

This maintenance release keeps all v1.8 features and changes how BandAid updates from GitHub Pages.

## Update fix

- App shell files (`index.html`, `app.js`, `styles.css`, and the web manifest) now use a **network-first** strategy, with cached copies used only as an offline fallback.
- Icons remain cache-first because they change infrequently.
- Service worker uses `skipWaiting()` and `clients.claim()` so a newly deployed worker can take control promptly.
- Old BandAid/Chord Vault caches are removed without touching unrelated caches on `shannonmochizuki.github.io`.
- Service worker registration uses `updateViaCache: "none"` and explicitly checks for an update.
- App assets include a v1.8.1 cache-busting query so stale v1.8 files are less likely to survive a deployment.
- Subtle on-screen version indicator is now **v1.8.1**.

## Preserved from v1.8

- Worship Leader role.
- Drum role.
- Worship Leader cue buttons: Verse 1, Chorus, Bridge, Last Line, Build Up.
- Same-browser live cue preview.
- Singer Key Tester.
- BPM, role picker, Backup & Restore, and existing song library format.
- `/BandAid/` GitHub Pages/PWA scope.

## Deployment

Upload every file in this package to the root of the `BandAid` repository, replacing the existing v1.8 files. GitHub Pages remains `main` → `/(root)`.

This release does not clear `localStorage`, so existing song data is preserved during a normal update.
