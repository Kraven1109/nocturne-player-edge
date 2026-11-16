# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased][unreleased]

## [0.11.0] - 2026-11-16

### Added

- Built-in offline local video launcher page (`local.html`, accessible via
  **Open local video** in the toolbar popup) so local files on Android Edge play
  reliably inside Nocturne even where Chromium restricts content-script
  injection on `content://` URIs, with automatic object-URL revocation on
  `pagehide` and silent rejection of audio-only files.
- First-class `content:` protocol handling in `detect.js`, `introwatch.js`
  (Web Audio bypass matching `file:`), and `popup.js`.
- Quick **Rotate** button in the fullscreen `.topbar` (`ui.js`): tries
  `screen.orientation.lock` when fullscreen (automatically resetting CSS
  rotation and updating orientation state on lock, and calling `unlock()` on
  `exit()`), falling back to quarter-turn CSS video rotation
  (`0° → 90° → 180° → 270° → 0°`). *(Note: OS orientation lock path is
  implemented behind `screen.orientation.lock` and awaiting real Android Edge
  hardware test; desktop Edge falls back to CSS rotation.)*
- **Focal-anchored pinch zoom (up to `4x`) & 2D 1-finger pan** (`zoom.js`,
  `visuals.js`, `recognizer.js`): arbitrary zoom levels past fit and cover now
  persist cleanly after lifting fingers (`snapPinchScale`), panning stays
  clamped to rotated screen-space picture bounds (`computeDrawSize` +
  `clampPan`) so black margins never appear, rotation changes re-clamp zoom
  scale and pan bounds, and 1-finger dragging while zoomed pans smoothly across
  any frame region.

### Changed

- Applied web-layer fullscreen fixes (`session.js`): replaced fixed
  `100vw`/`100vh` stage inline styles with `100%` + scoped `:fullscreen` and
  `::backdrop` black backdrop rules, gated `{ navigationUI: 'hide' }` to
  Chromium builds with `TypeError` fallback, tightened 180° sensor flip
  detection (`readOrientationState`), and replaced single-frame relayout with a
  dimension-change-gated `rAF` + `visualViewport.resize` stabilize loop. *(Note:
  on Android devices where a top bar is drawn by Edge's native Custom Tab
  View outside web DOM, device testing is still pending; use **Popup → Open
  local video** as the guaranteed path.)*
- Short-circuited `bridge.js` on `chrome-extension:` pages so `local.html` runs
  cleanly without dispatching page-world bridge requests.

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

[unreleased]: https://github.com/Kraven1109/nocturne-player-edge/compare/main...HEAD
[0.10.0]: https://github.com/Kraven1109/nocturne-player-edge
[kvachikk/nocturne-player]: https://github.com/kvachikk/nocturne-player
