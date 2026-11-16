# Nocturne Player for Edge

[![CI](https://github.com/Kraven1109/nocturne-player-edge/actions/workflows/ci.yml/badge.svg)](https://github.com/Kraven1109/nocturne-player-edge/actions/workflows/ci.yml)
[![License: MPL-2.0](https://img.shields.io/badge/license-MPL--2.0-blue.svg)](LICENSE)
[![No data collected](https://img.shields.io/badge/data%20collected-none-brightgreen.svg)](PRIVACY.md)

**Nocturne Player for Edge** is a touch-first, zero-telemetry HTML5 video player
extension for **Microsoft Edge** and Chromium MV3 browsers (`111+`).

It is an independent Chromium Manifest V3 port and continuation of
**[kvachikk/nocturne-player](https://github.com/kvachikk/nocturne-player)**
by Vlad Pohorilets (upstream `v0.9.1`, commit `0de5804`, licensed under MPL-2.0).

Works on any site that plays a standard `<video>`, direct video tabs (`http(s)://...mp4` and local `file://` files when **Allow access to file URLs** is enabled in `edge://extensions`), YouTube (desktop and mobile `m.youtube.com`), `hls.js`, `dash.js`, Shaka Player, and Playerjs.

## Features

- **Smart Auto-Hide Launcher Badge** — stays visible when paused, auto-hides
  (`opacity: 0; pointer-events: none`) after 2s while playing so it never
  obscures the picture or intercepts clicks, and reveals on pointer activity or
  keyboard focus.
- **Direct Main-Video Scrubbing** — thick, precision seek bar that previews
  frames directly on the main `<video>` (seeked-gated, zero hidden preload
  videos) with chapter markers across YouTube SPA navigation.
- **Optional Vertical Edge Gestures** _(enable in **Settings → Gestures →
  Vertical swipe (Dim / Volume)**)_:
  - **Left edge:** Video-frame overlay dimming (`10%..99%`, or swipe past the
    bottom threshold for `Dim: AUTO ☀`). Uses the in-player overlay rather than
    OS/hardware backlight.
  - **Right edge:** Smooth volume/mute swipe synced with site players on
    release and preserved when exiting Nocturne.
- **Skip Intro** — learns series openings locally by coarse 33-band audio
  spectra across episodes with zero internet access or databases.
- **Colour & Night Light** — hardware-safe warm night-light tint plus brightness,
  contrast, and saturation sliders.
- **Touch & Gesture Controls** — double-tap sides to seek `±10s`, hold sides for
  `2x` / stepped rewind, pinch-to-zoom crop, and vertical feed swipe for Shorts
  / Reels / TikTok.
- **Quality, Audio Track, Speed & Subtitles** — switch qualities/audio tracks on
  supported engines or load local `.srt` / `.vtt` subtitle files.

## Privacy

- Requests only `storage` (local on-device preferences) and `activeTab` (popup
  per-site toggle).
- Zero `fetch`, `XMLHttpRequest`, beacons, `eval`, or remote URLs — enforced by
  `npm run lint:privacy` in CI.
- Built output (`dist/`) is unminified so anyone can inspect what runs.

See [PRIVACY.md](PRIVACY.md) and [README-edge.md](README-edge.md) for full
technical details.

## Install (Development / Unpacked)

```bash
npm ci
npm run build
```

Load `dist/` via `edge://extensions` (enable **Developer mode** → **Load
unpacked**), or build an installable archive with `npm run package`
(`artifacts/nocturne-edge.zip`).

## Development & Verification

```bash
npm run lint          # ESLint + Prettier + MV3 privacy scan
npm test              # Node unit test suite
npm run build:clean   # Fresh MV3 bundles into dist/
npm run validate:mv3  # Validate MV3 manifest, icons, and MAIN/ISOLATED rules
npm run test:e2e      # Playwright E2E suite on Microsoft Edge
npm run package       # Package dist/ -> artifacts/nocturne-edge.zip
```

## License & Attribution

Licensed under [MPL-2.0](LICENSE). See [NOTICE](NOTICE) for upstream credit and
edge-port modifications.
