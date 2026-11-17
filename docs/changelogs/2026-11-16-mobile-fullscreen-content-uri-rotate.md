# Changelog Entry: Mobile Fullscreen, `content://` + `local.html`, Quick Rotate & Focal Zoom/Pan (`0.11.0`)

**Date:** 2026-11-16  
**Version:** `0.11.0`  
**Plan:** [2026-11-16-mobile-fullscreen-content-uri-rotate.md](../plans/2026-11-16-mobile-fullscreen-content-uri-rotate.md)

## Summary

- **Web-layer fullscreen & sensor rotation (`src/content/session.js`, `src/local/local.html`):**
  - Switched `STAGE_STYLE` sizing from `100vw`/`100vh` to `100%` and mounted a
    scoped `<style data-nocturne-stage-style>` enforcing `:fullscreen` and
    `::backdrop` black sizing alongside `html/body:has([data-nocturne-player])`
    `background:#000` and `color-scheme:dark`.
  - Added reversible `applyBlackThemeColor()` (`<meta name="theme-color" content="#000000">`) on `openStage()` with restore on `exit()`, plus black `theme-color` metadata in `local.html` (commit `07119be`).
  - Gated `{ navigationUI: 'hide' }` to Chromium builds (`isChromium`) with a
    `TypeError` fallback.
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

## Honest Verification Scope & Audit Findings (`7bbdf44`)

### Verified on Desktop Linux Microsoft Edge (`[EMPIRICAL]`)

- `npm run lint` (ESLint, Prettier, `check-privacy.mjs` 50 files clean), `npm test` (`152/152` unit tests using fake/mocked DOM surfaces), `build:clean`, `validate:mv3`, `npm run package`, `npm run test:e2e` (`chapters-spa.mjs`), and GitHub Actions CI run `43919021114`.
- Headless Pixel 7 CDP pinch probe on unobstructed `.surface` (`controls` hidden): pinch scaled `1x → 3.17x`, held `3.17391` after release, and emitted `0` bubble-phase leaks to `document`.

### Confirmed Open Defects & Code Gaps

1. **Pinch fails over visible `.chrome` sibling controls:** `chrome` (`pointer-events: auto` on `.topbar`, `.centre-row > *`, `.seek-area`) sits above `.surface` in `ui.shadow`. Starting a 2-finger pinch over `.centre-row` while paused/controls open is ignored (`p2Move` remained stuck at prior `scale(2)` in CDP probe).
2. **Capture-phase host listeners still see touch/pointer events:** `openStage()` stops propagation only in `stage` bubble phase (`bubbleLeaksCount: 0`, **`captureLeaksCount: 22`** on host `document` capture listeners in CDP probe).
3. **`styleGuard` permanent disconnect at `MAX_REPINS = 240`:** Sites rewriting inline styles on `requestAnimationFrame` exhaust 240 repins in ~2–4s and permanently disconnect `styleGuard`.
4. **Secondary pinch/fullscreen gaps:** `visuals.relayout()` can run even while `isPinching === true`; `MODE.ABANDONED` blocks lifting one finger then placing it back down to continue pinching without lifting both fingers; `requestFullscreen(stage)` boolean rejection is ignored without fallback warning/telemetry; `touch-action: none` on `:host` is not CSS-inherited by arbitrary shadow descendants.

### Never Verified on Physical Microsoft Edge for Android (`[UNVERIFIED]`)

- None of commits `7d5a248`, `07119be`, or `7bbdf44` have been run on real Edge Android hardware:
  - Native top grey strip (`rgb(41,41,41)`, `ToolbarControlContainer` in device screenshot): `<meta name="theme-color" content="#000000">` (`07119be`) is an unverified browser hint and cannot hide native Android UI views.
  - `screen.orientation.lock()` primary rotate path (always rejects on desktop Edge) and Android compositor half-black behavior.
  - Real `local.html` `<input type="file">` with Android `content://` blobs (direct `content://` pages remain blocked from MV3 `<all_urls>` content-script injection).
  - Real Android Edge compositor pinch-zoom feel on live sites (`m.youtube.com`, embedded iframes).
