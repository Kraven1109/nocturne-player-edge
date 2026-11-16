# Changelog Entry: Mobile Fullscreen, `content://` + `local.html`, Quick Rotate & Focal Zoom/Pan (`0.11.0`)

**Date:** 2026-11-16  
**Version:** `0.11.0`  
**Plan:** [2026-11-16-mobile-fullscreen-content-uri-rotate.md](../plans/2026-11-16-mobile-fullscreen-content-uri-rotate.md)

## Summary

- **Web-layer fullscreen & sensor rotation (`src/content/session.js`):**
  - Switched `STAGE_STYLE` sizing from `100vw`/`100vh` to `100%` and mounted a
    scoped `<style data-nocturne-stage-style>` enforcing `:fullscreen` and
    `::backdrop` black sizing without altering host page `<meta>` tags.
  - Gated `{ navigationUI: 'hide' }` to Chromium builds (`isChromium`) with a
    `TypeError` fallback.
  - Added `isStageFullscreen()` (`stage` or `ui.host`), `readOrientationState`
    (`type:angle` for `180°` flip detection), pre-armed `lastTurnAt` before
    `screen.orientation.lock`, sensor-driven CSS rotation reset in `noteTurn`,
    and a dimension-change-gated `startStabilizeRelayout` + `visualViewport.resize`
    relayout loop.
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

## Honest Verification Scope

- Verified on Linux desktop **Microsoft Edge** (unit suite, E2E suite, Pixel 7
  `412×915`/`915×412` CDP touch probe, and `chrome-extension://<id>/local.html`
  probe).
- Real **Microsoft Edge for Android** hardware verification (native top View
  bar behavior, `screen.orientation.lock()`, and `content://` injection) remains
  to be tested via sideloaded `artifacts/nocturne-edge.crx` prior to submitting
  `0.11.0` to the Edge Add-ons Store.
