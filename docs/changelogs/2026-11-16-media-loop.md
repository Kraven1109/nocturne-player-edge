# Changelog: Session-Scoped Media Loop & `0x0` Audio-Only Guard

**Date:** 2026-11-16  
**Plan:** [`docs/plans/2026-11-16-media-loop.md`](../plans/2026-11-16-media-loop.md)

## Summary

1. **`0x0` Audio-Only `.mp4` Silent Degradation ([`src/content/detect.js`](../../src/content/detect.js)):**
   - Edge renders audio-only `.mp4` `MediaDocument`s with `<video videoWidth=0 videoHeight=0>` inside a default `300x150` layout box, which previously satisfied `200x150` `isPlayable` checks. Updated `isPlayable` to return `false` when `readyState >= HAVE_METADATA && (videoWidth === 0 || videoHeight === 0)`.
2. **Injectable 1–N Loop Facade ([`src/content/video/loop.js`](../../src/content/video/loop.js)):**
   - Added pure `isLoopAllowedForVideo` (rejects `<= 0` dimensions cleanly before `isFeedShaped` so no `NaN` occurs, and excludes portrait feed videos).
   - Added `createLooper(video, { isAllowed, apply, read })` decoupling UI/menu from platform loop mechanisms. Default strategy uses `setSiteLoop` + `video.loop`, while custom adapters can replace both `apply` and `read` without touching `ui.js`, `menu.js`, or `session.js`.
3. **YouTube Context-Menu Sync & Session Restoration ([`src/content/page/bridge.js`](../../src/content/page/bridge.js), [`src/content/pageagent.js`](../../src/content/pageagent.js), [`src/content/session.js`](../../src/content/session.js)):**
   - Added `setSiteLoop` / `op: 'setLoop'` invoking `player.setLoopVideo(enabled)` when present (no-op on regular HTML5/local `<video>`), keeping YouTube's context-menu `Loop` checkbox synchronized.
   - Extended `captureVideoState` / `restoreVideoState` in `session.js` with `isLooped` and `setSiteLoop` restore on `exit()`/`step()`, keeping loop strictly session-scoped while `isVerticalGesturesOn` remains globally persisted.
4. **Menu Row ([`src/content/controls/menu.js`](../../src/content/controls/menu.js), [`src/content/ui.js`](../../src/content/ui.js)):**
   - Added **Playback -> Loop video** switch, synced and auto-hidden (`.is-empty`) in `refresh()` when `!looper.isAllowed()`.
5. **Verification:**
   - `npm test` -> `139/139` pass (new unit tests in `test/unit/loop.test.js`, `test/unit/mediadoc.test.js`, `test/unit/session.test.js`, `test/unit/bridge.test.js`).
   - Edge E2E (`_scratch/verify_loop_e2e.mjs`): verified `0x0` `audio_only.mp4` (`hasBadge: false`), `file:///.../sample.mp4` loop wrap + `controls`/`loop` restore, live YouTube `jNQXAC9IVRw` wrap + context-menu uncheck on exit, and `412x915` vertical `720x1280` feed hiding `Playback` row.
   - `npm run lint`, `npm run build:clean`, `npm run validate:mv3`, `npm run package`, and `npm run test:e2e` all passed.
