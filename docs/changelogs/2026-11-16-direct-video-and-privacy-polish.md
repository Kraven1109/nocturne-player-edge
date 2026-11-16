# Changelog: Direct Video / Local File Support & Privacy Polish

**Date:** 2026-11-16  
**Plan:** [`docs/plans/2026-11-16-direct-video-and-privacy-polish.md`](../plans/2026-11-16-direct-video-and-privacy-polish.md)

## Summary

1. **Protocol-First Direct Video & `file://` Support ([`src/content/detect.js`](../../src/content/detect.js), [`src/content/index.js`](../../src/content/index.js), [`src/popup/popup.js`](../../src/popup/popup.js)):**
   - Added `isMediaDocumentSupported(contentType, protocol)` enforcing `protocol ∈ {'http:', 'https:', 'file:'}` before matching `'text/html'` or `'video/*'`, blocking `about:blank`, `data:`, `blob:`, and extension schemes cleanly (`D4`).
   - Added `resolveHostKey` mapping `file:` empty hostnames to `'file:'` so popup toggle controls local file support cleanly (`Local files (file://)`) and guides users to enable _"Allow access to file URLs"_ in `edge://extensions` when content script access is off.
2. **Preemptive Local Audio Protection (`D1`) & `controls` Restoration (`D2`):**
   - Empirical Edge RMS probing measured `rms = 0` after `AudioContext.createMediaElementSource` on `file:///.../sample.mp4` (`rms = 0.0897` on `http://`). Updated `canListen(video)` in [`src/content/video/introwatch.js`](../../src/content/video/introwatch.js) to return `false` for `file:` upfront so `createMediaElementSource` is never created on local files.
   - Verified `session.js` captures, strips on stage, and restores the `controls` attribute of Chrome `MediaDocument` `<video controls autoplay name="media">` elements on exit (`test/unit/session.test.js` + Edge E2E).
3. **Verification:**
   - Unit tests (`npm test` -> `133/133` pass), `npm run lint` (0 errors, Prettier clean, Privacy 46 files + `manifest.mv3.json`), `npm run build:clean`, `npm run validate:mv3`, `npm run package`, `npm run test:e2e` (`ALL OK`), and Edge MediaDocument E2E (`_scratch/verify_mediadoc_e2e.mjs` on `file:///.../sample.mp4` and `http://.../sample.mp4`: `controls: false` on stage -> `Dim: 50%` -> `Volume: 72%` -> `controls: true` restored on exit, playback advancing cleanly, 0 page errors) all passed.
