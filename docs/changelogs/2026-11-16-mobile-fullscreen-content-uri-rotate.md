# Changelog Entry: Mobile Fullscreen, `content://` + `local.html`, Quick Rotate & Focal Zoom/Pan (`0.11.0`)

**Date:** 2026-11-16  
**Version:** `0.11.0`  
**Plan:** [2026-11-16-mobile-fullscreen-content-uri-rotate.md](../plans/2026-11-16-mobile-fullscreen-content-uri-rotate.md)

## Summary

- **Web-layer fullscreen & sensor rotation (`src/content/session.js`, `src/local/local.html`):**
  - Switched `STAGE_STYLE` sizing from `100vw`/`100vh` to `100%` and mounted a
    scoped `<style data-nocturne-stage-style>` enforcing `:fullscreen` and
    `::backdrop` black sizing alongside `[data-nocturne-player] > video`
    `!important` layout/cascade rules driven by CSS variables on `stage.style`.
  - Added static black `<meta name="theme-color" content="#000000" />` on
    extension-owned `local.html` (host `<meta>` / `:has()` overrides from
    `07119be` were reverted per M9 after Android `T1`–`T4` proved the top strip
    is an upstream Edge tab defect).
  - Gated `{ navigationUI: 'hide' }` to Chromium builds (`isChromium`) with a
    `TypeError` fallback, and exposed explicit `data-nocturne-pseudo-fullscreen`
    status + one-shot click retry when `requestFullscreen()` rejects.
  - Added `isStageFullscreen()` (`stage` or `ui.host`), `readOrientationState`
    (`type:angle` for `180°` flip detection), pre-armed `lastTurnAt` before
    `screen.orientation.lock`, sensor-driven CSS rotation reset in `noteTurn`,
    and a dimension-change-gated `startStabilizeRelayout` + `scheduleRelayout` on
    `window`/`visualViewport` `'resize'`.
- **`content:` & built-in offline local player (`src/local/`, `src/popup/`, `src/content/detect.js`, `src/content/video/introwatch.js`, `src/content/page/bridge.js`):**
  - Added `content:` support to `detect.js`, `introwatch.js` (alongside
    `chrome-extension:`), and `popup.js`.
  - Short-circuited `bridge.js` `requestSync` when running on `chrome-extension:`.
  - Added `local.html` / `local.css` / `local.js` via `Open local video` in
    popup with audio-only rejection (`videoWidth === 0`), `pagehide` object-URL
    revocation, and zero inline scripts.
- **Quick Rotate & Focal Zoom/Pan (`src/content/video/zoom.js`, `src/content/video/visuals.js`, `src/content/gestures/recognizer.js`, `src/content/ui.js`):**
  - Added `MAX_FREE_ZOOM = 4`, `snapPinchScale`, `computeDrawSize`, and
    `computeFocalPan`.
  - Implemented 2D `1-finger` pan (`canPan`, `beginPan`, `panBy`, `endPan`),
    `pinchMove` midpoint focal tracking, CSS quarter-turn rotation fallback
    (`rotateQuarter` / `resetRotation`), and re-clamping across rotation changes.
  - Anchored `pinchTo` from `pinchOrigin` (`beginPinch({ focalX, focalY })`),
    removed `endPinch()` cover snap-back so any scale `> 1.03` stays exact on
    release, hardened `recognizer.js` against release finger bounce
    (`MODE.ABANDONED`) and `pointercancel`, stopped touch/pointer event bubbling
    out of `stage` in `session.js`, added `touch-action: none` on `:host` in
    `player.css`, and guarded `MutationObserver(pin)` via
    `isVisualStyleIntact(video, overlay)` so pinch transforms never trigger
    self-repin flicker or exhaust `MAX_REPINS`.

## Honest Verification Scope & Audit Status (`P1`–`P6` Merged)

### Verified on Desktop Linux Microsoft Edge (`[EMPIRICAL]`)

- `npm run lint` (ESLint, Prettier, `check-privacy.mjs` 51 files clean), `npm test` (`154/154` unit tests), `build:clean`, `validate:mv3`, `npm run package`, and full `npm run test:e2e`:
  - `test/e2e/chapters-spa.mjs`: `ALL OK`
  - `test/e2e/pinch-rotate.mjs` (Pixel 7 `412×915` CDP touch): all 7 assertions passed (`R1` light-DOM cascade, `P1+R2` pinch over `.play-button`, `P2` re-pinch after 1-finger lift, `P3` deferred `relayout`, `R4` Play tap after pinch, `P4` >650-write CSS/guard burst survival, `R5` `blur` reset + resize flush).

### Reclassified Platform Limitations

- **Edge Canary Android 160 top bar / half-left landscape bar (`C1`–`C3` / `T1`–`T4`):** Confirmed on-device via `T1` (`video.requestFullscreen()`), `T2`, `T3` (`viewport-fit=cover`), `T4`, and extension-disabled runs: none remove the bar until the tab is refreshed. Documented as an upstream Edge Android bug, no longer blocking release.
- **Host capture-phase touch/pointer listeners (`C1`):** DOM capture order (`window → document → stage`) is a browser platform constraint; measured on live mobile sites rather than intercepted.

### Verified on Physical Edge Canary Android (`[EMPIRICAL]`, `819ms`–`101080ms`)

- Persistent pinch-to-zoom confirmed working cleanly.
- Physical hardware orientation transitions and both Rotate button `screen.orientation.lock('portrait')` (`54231ms`) and `lock('landscape')` (`90391ms`) resolved and retained `fsEl=DIV[stage]` cleanly (`0` `styleGuard` cooldowns, `0` pseudo-fullscreen fallbacks).
- Removed temporary `debuglog.js` and `reportCall` / `dbg` hooks after device confirmation (`S2`), and added desktop touchpad (`Ctrl+wheel` pinch, 2-finger pan), keyboard zoom/arrow-pan/reset (`+`/`-`/`0`/`Backspace`/Arrows), and `.zoom-reset` pill UI (`ui.js`, `visuals.js`, `player.css`, `pinch-rotate.mjs` assertion 8).
- Fixed `popup.js` duplicate `openLocalButton` click listener + async `render()` race in Reset handler (`S1`).

### Remaining Check Before Store Publish

- Confirm `local.html` `<input type="file">` with an Android `content://` media blob (direct `content://` tabs remain blocked under MV3 `<all_urls>`).
