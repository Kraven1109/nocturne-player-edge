# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased][unreleased]

## [0.11.0] - 2026-11-18

### Added

- Built-in offline local video launcher page (`local.html`, accessible via
  **Open local video** in the toolbar popup) so local files on Android Edge play
  inside Nocturne where Chromium restricts content-script injection on
  `content://` URIs, with automatic object-URL revocation on `pagehide` and
  silent rejection of audio-only files.
- First-class `content:` protocol handling in `detect.js`, `introwatch.js`
  (Web Audio bypass matching `file:`), and `popup.js`.
- Quick **Rotate** button in the fullscreen `.topbar` (`ui.js`): tries
  `screen.orientation.lock` when fullscreen (automatically resetting CSS
  rotation and updating orientation state on lock, and calling `unlock()` on
  `exit()`), falling back to quarter-turn CSS video rotation
  (`0° → 90° → 180° → 270° → 0°`). Verified on Edge Canary Android across sensor
  turns and explicit `lock('portrait')` / `lock('landscape')`.
- **Focal-anchored pinch zoom (up to `4x`) & 2D pan across mobile touch,
  desktop touchpad, and keyboard** (`zoom.js`, `visuals.js`, `recognizer.js`,
  `ui.js`, `player.css`):
  - Multi-touch pinch anchors from `pinchOrigin`, preserves arbitrary zoom
    levels above `PINCH_RESET_THRESHOLD = 1.03` on release, arms cleanly over
    visible `.chrome` controls (`PINCH_ARM_PX = 12` capture forwarder), allows
    re-pinching out of `ABANDONED`, heals orphaned primary touch pointers, and
    keeps `clampPan` inside rotated screen-space picture bounds.
  - **Laptop touchpad & desktop controls:** `Ctrl + wheel` touchpad pinch
    zooms at pointer focal point; 2-finger `wheel` pans smoothly while zoomed;
    mouse dragging displays `grab` / `grabbing` cursors on `.surface`.
  - **Keyboard zoom/pan & one-tap reset:** `+`/`=` zooms in, `-`/`_` zooms out,
    arrow keys (`ArrowLeft`/`Right`/`Up`/`Down`) pan zoomed frames,
    `0`/`Backspace` or the topbar `.zoom-reset` pill (`N.N× ✕`) resets zoom and
    pan cleanly to `1.0×` while keeping active rotation.
- Playwright E2E regression suite `test/e2e/pinch-rotate.mjs` covering `.chrome`
  pinch, re-pinch, mid-pinch resize defer, blur reset, >650-write CSS cascade /
  `burstGuard` survival, desktop `Ctrl+wheel` pinch, arrow pan, and `.zoom-reset`.

### Changed & Fixed

- Enforced stage video layout and `--nocturne-{transform,filter,transition}` via
  `[data-nocturne-player] > video` `!important` cascade rules in `STAGE_CSS`
  bound to `stage.style` CSS variables (`session.js`, `visuals.js`), stripping
  host inline `!important` overrides with sliding-window cooldown recovery
  (`5s → 15s → 45s`, cap `60s`) instead of exhausting `MAX_REPINS`.
- Deferred `relayout()` via `pendingRelayout` while `isPinching || isDragging`
  and marked non-fullscreen fallbacks with explicit
  `data-nocturne-pseudo-fullscreen` + one-shot click retry (`session.js`).
- Gated `{ navigationUI: 'hide' }` to Chromium builds with `TypeError` fallback
  and tightened 180° flip detection (`readOrientationState`), while short-circuiting
  `bridge.js` on `chrome-extension:` pages (`local.html`).
- Fixed duplicate `openLocalButton` listener attachment and missing `await`
  before status text update in `popup.js` **Reset settings** handler (`S1`).
- Removed temporary fullscreen debug overlay (`debuglog.js` and `reportCall`
  diagnostics) after on-device Edge Canary Android confirmation (`S2`).

## [0.10.0] - 2026-11-16

Initial public release of **Nocturne Player for Edge** (Manifest V3), forked from
[kvachikk/nocturne-player][] `v0.9.1` (`0de5804`) under MPL-2.0.

### Added

- Chromium Manifest V3 architecture (`world: "MAIN"` `pageagent.js` +
  `world: "ISOLATED"` `content.js`) communicating via a synchronous two-way
  `CustomEvent` bridge (`nocturne:req` / `nocturne:res`) backed by a
  `WeakMap<HTMLVideoElement, PlayerState>` with zero DOM attribute leaks.
- Session-scoped **Playback -> Loop video** toggle via an injectable 1–N
  `createLooper` facade (`src/content/video/loop.js`) with YouTube native
  context-menu sync (`op: 'setLoop'`), automatic vertical-feed exclusion, exit
  restoration (`session.js`), and silent `0x0` audio-only `.mp4` exclusion in
  `detect.js`.
- Support for direct `video/*` `MediaDocument` tabs (`http(s)://...mp4`,
  `webm`, and local `file://` video files when **Allow access to file URLs**
  is enabled in `edge://extensions`), with protocol-first filtering (`http:`,
  `https:`, `file:`), popup `'file:'` toggle support, and preemptive Web Audio
  `canListen` bypass on `file:` so local videos never lose audio.
- Optional vertical edge swipe gestures (disabled by default, toggled via
  **Gestures -> Vertical swipe (Dim / Volume)** in the player Settings menu):
  left-edge frame dimming (`layers.dim`, `10%..99%` with 2-way `Dim: AUTO`
  bottom hysteresis) and right-edge `video.volume` / mute control with YouTube
  player synchronization and exit-preservation.
- New **Eclipse Halo** vector icon suite (`src/icons/icon.svg`, PNG
  `16`/`32`/`48`/`128`, plus `docs/store/tile-300.png` via `npm run icons`).
- MV3 package validator (`npm run validate:mv3`) and community/Edge Add-ons Store
  documentation (`NOTICE`, `README.md`, `README-edge.md`, `CONTRIBUTING.md`,
  `PRIVACY.md`, `SECURITY.md`, [`docs/store/EDGE_ADDONS_LISTING.md`](docs/store/EDGE_ADDONS_LISTING.md)).

### Changed

- Branded extension as **Nocturne Player for Edge** (`0.10.0`) across
  `src/manifest.mv3.json`, `package.json`, and `src/popup/popup.html`, with all
  source and issue links pointing to `Kraven1109/nocturne-player-edge`.
- Fullscreen launcher badge auto-hides (`opacity: 0; pointer-events: none`)
  after 2s while playing and reveals on pointer activity, focus, or pause.
- Seekbar previews scrub directly on the main video with `seeked`-gated
  throttling instead of rendering a floating preview `<video>` thumbnail box.

[unreleased]: https://github.com/Kraven1109/nocturne-player-edge/compare/0.11.0...HEAD
[0.11.0]: https://github.com/Kraven1109/nocturne-player-edge/compare/0.10.0...0.11.0
[0.10.0]: https://github.com/Kraven1109/nocturne-player-edge/commits/b75c543
[kvachikk/nocturne-player]: https://github.com/kvachikk/nocturne-player
