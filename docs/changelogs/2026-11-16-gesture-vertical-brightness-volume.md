# Changelog: Vertical Edge Gestures (Left Dim / AUTO & Right Volume)

**Date:** 2026-11-16  
**Plan:** [`docs/plans/2026-11-16-gesture-vertical-brightness-volume.md`](../plans/2026-11-16-gesture-vertical-brightness-volume.md)

## Summary

1. **Opt-in Settings & Menu Toggle ([`src/lib/settings.js`](../../src/lib/settings.js), [`src/content/controls/menu.js`](../../src/content/controls/menu.js)):**
   - Added `isVerticalGesturesOn: false` to `DEFAULTS` (schema v2 preserved; invalid non-boolean values sanitize back to defaults).
   - Added the **Vertical swipe (Dim / Volume)** switch under **Gestures** in the in-player Settings menu (`menu.js`), persisted via `onPersist`.
2. **Gesture Recognition & Idempotency ([`src/content/gestures/recognizer.js`](../../src/content/gestures/recognizer.js)):**
   - Added vertical side-drag detection on `ZONE.HOLD_LEFT` and `ZONE.HOLD_RIGHT` when `!canSwipe() && canVerticalDrag()`, checked only when locking into `MODE.DRAG` at `dragStart` so active drags survive mid-drag toggle changes (`H2`) while vertical feed swipe (`canSwipe()`) keeps priority and horizontal side drags remain `ABANDONED`.
   - Emits cumulative `totalDy` / `totalDx` alongside incremental `dx` / `dy`.
   - Listens to both `pointercancel` and `lostpointercapture` and resets `mode` before emitting `dragEnd` (`H1`), preventing double-commit across `pointerup + lostpointercapture`, `pointercancel + lostpointercapture`, and `pinchStart` mid-drag.
3. **Anchor Math, Two-Way `AUTO` Hysteresis & Overlay Dimming ([`src/content/gestures/verticaldrag.js`](../../src/content/gestures/verticaldrag.js), [`src/content/player.css`](../../src/content/player.css), [`src/content/ui.js`](../../src/content/ui.js)):**
   - Left edge dims via the existing Shadow DOM overlay `layers.dim` (`Dim: 10%..99%` or `Dim: AUTO ☀` at `opacity: 0`), using `.dim.is-dragging { transition: none; }` during active drags.
   - Anchor-based math (`raw = dragBase - totalDy / (h * 0.75)`) clamps only at output, enters bottom `AUTO` with `24px` (`0.5px` FP tolerance) or `raw < 0.05` fallback on short viewports, exits `AUTO` on reverse at `raw >= 0.10 + 24 / (h * 0.75)` (`~0.14` at `h = 800`), and stays `AUTO` when dragging above `1.0`. Session `dim` resets to `AUTO` on overlay creation/destroy.
   - Right edge updates `video.volume` / `video.muted` directly at drag speed and runs a unified `end()` pipeline (`pointerup`, `pointercancel`, `lostpointercapture`, `pinchStart`) that commits the final volume to `session.js` (`G1`) and dispatches `{ op: 'setVolume', volume, muted }` to `pageagent.js` (`G4`).
   - Chrome visibility on `dragStart` (`src/content/ui.js`) is now scoped to `ZONE.SEEK` only, so vertical Dim/Volume drags no longer pop the control chrome mid-gesture (horizontal seek behavior unchanged) (`D2`).
4. **Exit Volume Preservation & YouTube Sync ([`src/content/session.js`](../../src/content/session.js), [`src/content/page/bridge.js`](../../src/content/page/bridge.js), [`src/content/pageagent.js`](../../src/content/pageagent.js)):**
   - Exported `commitCapturedVolume(state, volume, isMuted)` in `session.js` so `restoreVideoState` preserves user-adjusted volume/mute on `exit()`.
   - Added `setSiteVolume` (`bridge.js`) and `op === 'setVolume'` (`pageagent.js`), calling `player.setVolume(0..100)` + `mute()`/`unMute()` when `state.host` exposes `setVolume` (verified on YouTube `#movie_player`), no-oping cleanly on plain `<video>`.
5. **Verification:**
   - `npm run build` -> Built 3 bundles into `dist/`.
   - `npm test` -> `126/126` unit tests pass (including `test/unit/recognizer.test.js` G3/H1/H2 cases, `test/unit/verticaldrag.test.js` G2/H2/H3 cases, `test/unit/session.test.js` G1 exit preservation, `test/unit/bridge.test.js`, `test/unit/settings.test.js`).
   - `npm run lint` -> Pass (ESLint 0 errors, Prettier clean, Privacy 46 files clean).
   - Edge E2E (`_scratch/verify_vertical_gestures.mjs` & `_scratch/verify_d3_yt_mute.mjs` in Microsoft Edge): Default `OFF` parity, left `Dim: 50%` (`opacity: 0.5`) -> `Dim: AUTO ☀` (`opacity: 0`) -> reverse exit hysteresis `Dim: 14%` (`opacity: 0.86`), right `Volume: 72%` preserved after Exit button, live YouTube `35%` sync (`ytVol: 35`, `ytBarAria: "35"`), `pointercancel` `60%` commit/sync (`videoVol: 60, ytVol: 60`), and `D3` live YouTube mute/unmute round-trip (`Muted` -> `{videoVol:0,videoMuted:true,ytVol:0,ytMuted:true}` then `Volume: 40%` -> `{videoVol:40,videoMuted:false,ytVol:40,ytMuted:false}`) all passed.
   - Existing Edge E2E suite (`npm run test:e2e`): All passed (`exit 0`).
