# Follow-Up Plan (Post-0.10.0): Mobile Fullscreen, `content://` Local Videos, Quick Rotate & Zoom Pan

**Date:** 2026-11-16  
**Target Version:** `0.11.0` (post-Edge Add-ons Store release `0.10.0`, commit `b75c543`)  
**Status:** `7d5a248`, `07119be`, `7bbdf44` merged to `main`; **NOT verified on physical Edge Android** — open audit defects remain in desktop CDP probe (controls-visible pinch occlusion, `document` capture-phase touch leakage, `MAX_REPINS = 240` cutoff) alongside unverified Android top strip, `screen.orientation.lock()`, and `content://` behavior (see [audit changelog](../changelogs/2026-11-16-mobile-fullscreen-content-uri-rotate.md)).

---

## 1. Evidence & Problem Summary

User testing on Microsoft Edge for Android after `0.10.0` store publication revealed four issues (screenshots archived in `_scratch/issue_screenshots/`):

1. **White horizontal bar in mobile fullscreen & half-width bar on rotation** (`9b8e1b1ca8f328ad71e23.jpg` `1440×563`, `8d9fc50a76e5f6bbaff42.jpg` `3120×343`):
   - In portrait fullscreen, a light-gray/white horizontal strip remains near the top of the screen.
   - When rotated to landscape (with Nocturne's fullscreen topbar `X` / palette / gear active and no windowed fullscreen button), the light-gray bar remains stuck on the **left half** (`~1440px`, matching portrait width) while the right half is black (`#000`), and the portrait video sits centered.
2. **Android local video URI format (`content://media/external/downloads/...`)** (`13b8c32e70c1f09fa9d01.jpg` `1440×316`):
   - Opening local downloads on Android resolves to `content://media/external/downloads/...` inside Edge's viewer bar rather than `file:///...`.
   - Currently `src/content/detect.js` (`SUPPORTED_PROTOCOLS`), `src/content/video/introwatch.js`, and `src/popup/popup.js` only recognize `http:`, `https:`, and `file:`.
   - Furthermore, Chromium's `UserScript::kValidUserScriptSchemes` / `URLPattern` (`<all_urls>`) does **not** include `content://` in standard upstream Chromium (`"content://*/*"` is invalid in MV3 manifests), meaning Edge Android may block content script injection on `content://` tabs entirely.
3. **Missing quick Rotate control in fullscreen tap overlay:**
   - Currently Nocturne has no user-triggered Rotate button at all; users on mobile with OS auto-rotate turned off cannot rotate the video on tap in fullscreen without rotating hardware or leaving the player.
4. **Pinch-to-zoom is locked to center (`x: 0, y: 0`) with no drag/pan & capped at `coverScale`:**
   - `src/content/video/visuals.js` maintains `view = { scale, x, y }`, and `src/content/video/zoom.js` defines `clampPan`, yet `x` and `y` are never mutated anywhere (`view.x = 0, view.y = 0`).
   - `src/content/gestures/recognizer.js` ignores two-finger pinch midpoint movement and rejects single-finger drags outside `ZONE.SEEK` / vertical edge drags (`MODE.ABANDONED`), making it impossible to pan around a zoomed frame.
   - Additionally, `visuals.js` caps zoom at `coverScale`, which disables pinch-to-zoom completely whenever video and stage aspect ratios match (`coverScale === 1`). Also `clampPan` currently uses `(stageWidth, stageHeight)` rather than rendered picture dimensions `(drawW, drawH)`, which lets letterboxed videos slide into black bars.

---

## 2. Workstream Breakdown

### Workstream A — Mobile Fullscreen White Bar & Rotation Glitch (`src/content/session.js`, `src/content/player.css`)

**Root Causes Identified in Code:**

- `STAGE_STYLE` in `src/content/session.js` pins `width: '100vw'` and `height: '100vh'`. On Chromium Android, `100vw`/`100vh` represent the layout viewport, which can mismatch the fullscreen visual viewport and lag behind `orientationchange` transitions.
- `[data-nocturne-player]::backdrop` and `:fullscreen` rules are unstyled; if `stage` lags during rotation, the page/default backdrop shows through.
- `requestFullscreen(element)` omits `{ navigationUI: 'hide' }` (left unset for Gecko sticky-immersive avoidance, which differs from Blink/Edge Android).
- Page `<meta name="theme-color">` and `<meta name="viewport">` (`viewport-fit=cover`) are untouched, allowing Android Edge-to-Edge status-bar / cutout insets on light-themed pages to render white/light-gray.
- Only one `requestAnimationFrame` relayout fires on orientation change, which can measure pre-rotation viewport dimensions on Android.

**Planned Changes:**

1. **Scoped stage stylesheet (mounted on `openStage()`, removed on `exit()`):**
   - `[data-nocturne-player]:fullscreen` / `:-webkit-full-screen`: `position: fixed !important; inset: 0 !important; width: 100% !important; height: 100% !important; background: #000 !important;`
   - `[data-nocturne-player]::backdrop`: `background: #000 !important;`
2. **`STAGE_STYLE` viewport units:** Use `inset: '0'`, `width: '100%'`, `height: '100dvh'` (falling back gracefully when `dvh` is unsupported, e.g. `100%` when `:fullscreen`).
3. **`requestFullscreen` immersive hint:** Call `element.requestFullscreen({ navigationUI: 'hide' })`, catching `TypeError` and falling back to `element.requestFullscreen()` on engines that reject the options dictionary.
4. **Reversible Edge-to-Edge dark inset guard (`session.js`):**
   - On `openStage()`, snapshot existing `<meta name="theme-color">` (or mark a created one) and set `content="#000000"`; snapshot `<meta name="viewport">` and ensure `viewport-fit=cover` if missing. Restore exact original state on `exit()`.
5. **Post-rotation settle pass (`session.js`):**
   - On `orientationchange` / `screen.orientation.change`, schedule both `requestAnimationFrame` and a short settle relayout (`150ms`, tracked in `scope`) so `pin()` and `visuals.relayout()` re-measure after Edge Android finishes rotating its compositor surface.

**Honest Platform Limitation Note:**

- If the persistent top bar in `13b8c32e70c1f09fa9d01.jpg` / `8d9fc50a76e5f6bbaff42.jpg` is **Edge Android's native Android `View` Custom Tab / Media Viewer toolbar** failing to collapse in Edge's browser shell, extension DOM/CSS cannot hide native OS views directly. Workstream A eliminates every web-layer/fullscreen-API cause and nudges Chromium's fullscreen handler into true immersive mode; **Workstream B2** provides a normal-tab local player free of Custom Tab chrome.

---

### Workstream B — Android `content://` Local Video Support & Local Player Fallback

**Part B1 — First-Class `content:` Protocol Handling (for browsers/builds that inject `<all_urls>` on `content://`):**

- `src/manifest.mv3.json`: Keep `"matches": ["<all_urls>"]` unchanged (never add `"content://*/*"`, which fails MV3 schema validation).
- `src/content/detect.js`:
  - Add `'content:'` to `SUPPORTED_PROTOCOLS`.
  - Update `resolveHostKey(protocol, host)` to return `'content:'` when `protocol === 'content:'` (just like `'file:'`), preventing empty `""` host keys in `disabledHosts`.
- `src/content/video/introwatch.js`:
  - Update `canListen(video, pageLocation)` to bypass Web Audio `createMediaElementSource` for `content:` URLs (matching `file:`), avoiding muted playback or CORS errors on Android content providers.
- `src/content/video/loop.js`: Keep compatible (uses `video.loop`, works on `content:` media documents).
- `src/popup/popup.js`:
  - Handle `url.protocol === 'content:'` in `readHost(tab)` returning `{ key: 'content:', label: 'Local media (content://)' }`.
  - In `describeVideo(tab, host)`, if injection fails on `content:`, show a clear message explaining that Edge Android restricts extension injection on `content://` pages and pointing to the built-in local player button.

**Part B2 — Guaranteed Extension Local Video Player Fallback (`src/local/`):**
Because upstream Chromium excludes `content://` from `UserScript::kValidUserScriptSchemes`, an extension page (`chrome-extension://<id>/local.html`) ensures local phone videos always work with Nocturne — and avoids Edge's `content://` Custom Tab bar:

- Add `src/local/local.html`, `src/local/local.css`, `src/local/local.js` (bundled by `esbuild.config.mjs` to `dist/local.{html,css,js}` without adding any new permissions in `src/manifest.mv3.json`).
- Provide a clean dark touch UI with an `<input type="file" accept="video/*">` picker (`URL.createObjectURL(file)`, revoking previous object URLs on switch/unload) and optional `.srt`/`.vtt` picker.
- Mount Nocturne's own `createSession` directly on the `<video>` element (reading/persisting `settings.js` preferences just like `content/index.js`).
- Add a single **"Open local video"** button in `src/popup/popup.html` / `src/popup/popup.js` that calls `browser.tabs.create({ url: browser.runtime.getURL('local.html') })`.

---

### Workstream C — Quick Rotate Button on Fullscreen Tap (`src/content/ui.js`, `src/content/player.css`, `src/content/session.js`, `src/content/video/visuals.js`, `src/content/video/zoom.js`)

**UX Goal:** One-tap Rotate icon directly inside the fullscreen `.topbar` (appears whenever the user taps the video in fullscreen, auto-hides with `.chrome` after 3s — no digging into Settings).

**Behavior:**

1. **UI (`src/content/ui.js`, `src/content/player.css`):**
   - Add a `Rotate` icon button (`buttons.rotate`, class `is-full-only`) in `.topbar` right before `buttons.colour`.
   - Visible on tap in fullscreen alongside `Exit`, `Colour`, and `Settings`; hidden when `data-compact` is active.
2. **Primary Action — OS Screen Orientation Toggle (`src/content/session.js`):**
   - Determine current orientation (`landscape` vs `portrait` from `screen.orientation?.type` or `window.innerWidth > window.innerHeight`).
   - Call `await window.screen.orientation.lock(nextOrientation)` (`'landscape'` ↔ `'portrait'`) when `document.fullscreenElement === stage`.
   - Show brief toast (`'Landscape'` / `'Portrait'`).
   - On `session.exit()`, safely call `window.screen.orientation?.unlock?.()` inside `try / catch` so the phone never stays locked after leaving the player.
3. **Fallback — CSS Video Rotation (`0° → 90° → 180° → 270°`) (`src/content/video/visuals.js`, `src/content/video/zoom.js`):**
   - If `screen.orientation.lock` is unavailable or rejects (e.g. desktop Edge, embedded iframe without `allow-orientation-lock`, or non-fullscreen windowed stage), cycle `visuals.rotate()` by `+90°` (`0 → 90 → 180 → 270 → 0`) and show toast (`'Rotated 90°'` etc.).
   - When `rotation` is `90°` or `270°`, `visuals.js` / `zoom.js` swap the effective video dimensions `(videoHeight, videoWidth)` for `computeCoverScale`, `FIT` base scale (computed so a rotated `16:9` frame fits inside `stageW × stageH` without clipping), and `clampPan`.
   - Combine rotation cleanly in `transform`: `translate(x, y) rotate(deg) scale(s)` (screen-space translation first so dragging right always pans right even when rotated 90°/270°; neutral `'none'` when `deg === 0` and unzoomed).
   - Reset `rotation = 0` on `release()` / `restoreVideoState()`.

---

### Workstream D — Zoom Pan / Drag & Uncapped Free Zoom (`src/content/video/zoom.js`, `src/content/video/visuals.js`, `src/content/gestures/recognizer.js`, `src/content/ui.js`)

**UX Goal:** Allow zooming up to `4x` even on matching-aspect screens (beyond just filling black bars), and **drag/pan in 2D** with 1 finger anywhere on the zoomed video (plus simultaneous midpoint pan while pinching with 2 fingers), clamped tightly to the rendered picture bounds so black borders never expose on-screen.

**Planned Changes:**

1. **Accurate Picture Bounds & Max Scale (`src/content/video/zoom.js`):**
   - Export `MAX_FREE_ZOOM = 4` and `computeMaxScale(coverScale) => Math.max(coverScale, MAX_FREE_ZOOM)`, keeping `clampScale(scale, maxScale)` unchanged so existing unit contracts stay intact.
   - Add `computeDrawSize(videoWidth, videoHeight, stageWidth, stageHeight, rotationDeg)` returning the rendered `<video>` content dimensions inside `object-fit: contain` (accounting for `90°`/`270°` fit scaling and swapped axes).
   - Extend `clampPan(x, y, scale, stageWidth, stageHeight, drawWidth = stageWidth, drawHeight = stageHeight)` so `maxX = Math.max(0, (drawWidth * scale - stageWidth) / 2)` and `maxY = Math.max(0, (drawHeight * scale - stageHeight) / 2)` (fully backwards-compatible when `drawWidth`/`drawHeight` are omitted).
2. **2D Pan State & Zero-Lag Tracking (`src/content/video/visuals.js`):**
   - Pass `computeMaxScale(cover)` as `maxScale` in `place(scale)` while keeping snap targets `[1, cover]` (snapping on `endPinch()` so zoom scales smoothly while pinching).
   - Add pan lifecycle methods on `createVisuals`:
     - `canPan()`: returns `true` only when the current zoomed/rotated picture actually overflows the stage along X or Y (`maxX > 0.5 || maxY > 0.5`).
     - `beginPan()`: sets `isDragging = true` (temporarily disables `TRANSFORM_TRANSITION` for 1:1 finger tracking, matching `isPinching`).
     - `panBy(dx, dy)`: updates `view.x` and `view.y` by `(dx, dy)`, clamps via `clampPan` using actual rendered picture dimensions, and applies immediately.
     - `endPan()`: clears `isDragging = false` and calls `apply()` to restore transitions.
   - Apply two-finger midpoint `{ dx, dy }` during `pinchMove` via `panBy(dx, dy)` so zooming over a corner zooms toward the user's fingers rather than dead center.
   - Pinching back down to `1x` (or calling `reset()`) automatically recenters `view.x = 0, view.y = 0` via `clampPan`.
3. **Gesture Recognizer Priority (`src/content/gestures/recognizer.js`, `src/content/ui.js`):**
   - Extend `createRecognizer(surface, handlers, { canSwipe, canVerticalDrag, canPan = () => false })`.
   - Track two-finger pinch midpoint in `startPinch()` and `handlePinchMove()`, emitting `{ scale, dx, dy }` in `pinchMove`.
   - In `handleMove()` (`MODE.PENDING` after `MOVE_TOLERANCE_PX`): when `canPan()` is `true`, **prioritize 1-finger panning (`axis: 'pan'`) across all picture zones** over `canSwipe()`, `canVerticalDrag()`, and `ZONE.SEEK` so thumbs resting anywhere on the video pan smoothly instead of triggering feed swipes, Dim/Volume edge drags, or unintended seeks. Once zoomed back to `1x`, `canPan()` turns `false` and all normal swipe/edge/seek gestures resume; tapping still toggles `.chrome` and the bottom `.seekbar` keeps scrubbing normally while zoomed.
   - Preserve edge transitions: `350ms` still hold (`2x`), lifting 1 finger from pinch (`pinchEnd`), and adding a 2nd finger mid-pan (`dragEnd` → `pinchStart`).
   - Route `detail.axis === 'pan'` in `src/content/ui.js` (`dragStart` / `dragMove` / `dragEnd`) to `visuals.beginPan()`, `visuals.panBy(dx, dy)`, and `visuals.endPan()`.

4. **Re-clamp & Safe Guard Notes (`N1`–`N5`):**
   - `relayout()` preserves `intent === FREE` via `place(view.scale)` + `remember(view.scale)` so rotating to a tighter max-scale orientation cleanly clamps both scale and pan.
   - `isStageFullscreen()` checks `stage` or `ui.host`; `requestFullscreen` gates `{ navigationUI: 'hide' }` to Chromium; `bridge.js` short-circuits on `chrome-extension:`.

---

## 3. Verification Plan

1. **Unit Tests (`npm test`):**
   - `test/unit/mediadoc.test.js`: verify `'content:'` accepted in `isMediaDocumentSupported` and `resolveHostKey('content:', '') === 'content:'`.
   - `test/unit/introwatch.test.js`: verify `canListen` bypasses `content:` URLs.
   - `test/unit/zoom.test.js`: verify `computeMaxScale`, `computeDrawSize` (including `90°`/`270°` rotation), and `clampPan` with rendered `(drawWidth, drawHeight)` bounds.
   - `test/unit/recognizer.test.js`: verify `canPan: () => true` enters `axis: 'pan'` across zones (overriding `canSwipe`, `canVerticalDrag`, and `ZONE.SEEK`), two-finger `pinchMove` emits midpoint `{ dx, dy }`, and `canPan: () => false` preserves unzoomed gestures.
   - `test/unit/session.test.js` (or dedicated unit test): verify `requestFullscreen({ navigationUI: 'hide' })` + fallback, `theme-color` / `viewport-fit=cover` capture & restore on `exit()`, and `screen.orientation.unlock()` on `exit()`.
2. **Build, Lint & MV3 Validation:**
   - `npm run build`
   - `npm run validate:mv3` (including checking `local.html` / `local.js` exist in `dist/`)
   - `npm run lint` (`eslint`, `prettier`, `check-privacy.mjs`)
3. **Playwright + System Edge (`test:e2e` + `_scratch/` mobile probe):**
   - Verify mobile viewport (`Pixel 7` portrait → landscape rotation) in Playwright Edge: confirm `[data-nocturne-player]` fills `100%` width/height after rotation, `Rotate` button appears on tap in `.topbar` and hides with chrome, CSS rotation fallback cycles `0° → 90° → 180° → 270°`, pinch-zoom > `1x` + 1-finger drag pans `translate(x, y)` within clamped bounds, and `local.html` plays fixture `sample.mp4` via object URL with Nocturne overlay.
4. **Device Checklist (Microsoft Edge Android):**
   - Test fullscreen + rotation on YouTube/HTML5 video to verify status/white bar behavior.
   - Test opening `content://media/external/downloads/...` directly and via **Popup → Open local video** (`local.html`).
   - Test pinch-to-zoom beyond `cover` + 1-finger drag pan + reset zoom back to `1x`.
