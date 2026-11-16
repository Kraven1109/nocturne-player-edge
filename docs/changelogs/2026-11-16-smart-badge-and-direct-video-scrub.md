# Changelog: Smart Auto-Hide Badge & Direct Main-Video Scrubbing

**Date:** 2026-11-16  
**Plan:** [`docs/plans/2026-11-16-smart-badge-and-direct-video-scrub.md`](../plans/2026-11-16-smart-badge-and-direct-video-scrub.md)

## Summary

1. **Smart Auto-Hide Badge (`src/content/controls/badge.js`):**
   - Badge remains visible when `video.paused === true`, and auto-conceals (`opacity: 0; pointer-events: none`) after `2000ms` of idle while playing so it neither obscures video playback nor swallows clicks intended for the underlying site player.
   - Reveals immediately on `pause`, mouse movement inside the `target` bounding box (throttled at `100ms` with a trailing-edge timer so stopping inside the rect always reveals), `pointerdown` inside the `target` rect (touch/pen), or keyboard `focusin`.
   - Guards idle expiry while hovering the badge (`pointerenter`/`pointerleave`) or while focused (`focusin`/`focusout`), resets `isPointerOnBadge` on `conceal()`, mirrors `dataset.revealed` onto `shell.host` for E2E observability, and cleanly tears down and re-mounts `shell.host` + all listeners across `hide()` $\to$ `show()`.
2. **Direct Main-Video Scrubbing without Thumbnailer (`src/content/controls/seekbar.js`, `src/content/player.css`, `src/content/pageagent.js`):**
   - Removed `createThumbnailer`, `fitThumb`, `.seek-thumb*` DOM/CSS, the offscreen `<video preload="auto">`, 60-entry `ImageData` cache, and synthetic `.ytp-progress-bar` `mousemove` events.
   - Hover (`!isScrubbing`) shows only the timestamp and chapter pill without seeking.
   - Scrubbing (`start()` / `handleTrackDown()` through `end()` / mid-scrub `destroy()`) pauses playback while dragging, previews directly on the main `<video>` using a `seeked`-gated state machine (`SEEK_SETTLE_MS = 60`, `SEEK_STALL_MS = 400`, `SEEK_EPSILON_S = 0.5`, strict `previewTimer = null` invariant), commits final seek on release, and resumes playback if previously playing.
   - `pageagent.js` (`op === 'seek'`) passes `true` to YouTube `seekTo` because empirical Edge probing confirmed `seekTo(t, false)` does not update `<video>.currentTime` even within buffered ranges.
3. **Verification:**
   - Unit tests: `110/110` passing (`npm test`), including `test/unit/badge.test.js` (6 tests) and `test/unit/seekbar.test.js` (9 tests, including `destroy() finalizes mid-scrub and resumes playback [A2-4]`).
   - V-1 YouTube `|currentTime - requested|` probe (`_scratch/probe_yt_rapid_true.mjs` + direct scrub probe): `0.00s` delta across all probed buffered (`4, 9, 14, 7, 2`) and unbuffered (`5, 300, 450`) targets (`SEEK_EPSILON_S = 0.5`).
   - E2E (`_scratch/verify_badge_and_scrub.mjs`, `test/e2e/chapters-spa.mjs` local & `--live` desktop, plus `verify_phase2_3.mjs`): all passed in Microsoft Edge 156 (`--mobile` also verified touch-wake `clickBadge()` and `[11, 0]` SPA clear before stopping early on a non-chapter recommendation).
