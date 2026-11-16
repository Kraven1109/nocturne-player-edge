# Nocturne Player — Microsoft Edge / Chromium MV3 Port

[![License: MPL-2.0](https://img.shields.io/badge/license-MPL--2.0-blue.svg)](LICENSE)
[![No data collected](https://img.shields.io/badge/data%20collected-none-brightgreen.svg)](PRIVACY.md)

This repository is a port of **[kvachikk/nocturne-player](https://github.com/kvachikk/nocturne-player)** (`v0.9.1`, commit `0de5804`) from Firefox/Gecko Manifest V2 to **Microsoft Edge and Chromium Manifest V3** (`minimum_chrome_version: "111"`).

---

## MPL-2.0 §3 Notice of Modifications

In accordance with Section 3.3 of the [Mozilla Public License 2.0](LICENSE), the following files have been created or modified from upstream `0de5804` to support Chromium/Blink Manifest V3:

- **Added:**
  - `src/manifest.mv3.json` — Manifest V3 declaration (`world: "MAIN"` at `document_start` for `pageagent.js`, `world: "ISOLATED"` at `document_idle` for `content.js`, `action` popup, PNG icons).
  - `src/icons/icon-{16,32,48,128}.png` — Rasterized PNG icons required by Chromium MV3.
  - `src/content/pageagent.js` — `MAIN`-world agent holding a `WeakMap<HTMLVideoElement, PlayerState>` and a capture-phase `nocturne:req` dispatcher.
  - `src/content/page/bridge.js` — Synchronous `CustomEvent` bridge client (`nocturne:req` / `nocturne:res`) for the `ISOLATED` content script world.
  - `src/content/page/chapters.main.js` — `MAIN`-world YouTube chapter extractor (`readChaptersSnapshot`): answers with the playing video's id, whether an advertisement is showing, and its chapters. Chapters follow the site's Next / autoplay under an open player on desktop and mobile YouTube (`ytd-watch-flexy` / `ytm-watch`) (joined by video id, not by `<video>` source), are cleared for a video without chapters, and are held back while an ad plays.
  - `src/content/page/sitecaptions.main.js` — `MAIN`-world YouTube caption tracklist controller (`createYouTubeTracks`).
  - `src/content/page/fullscreen.main.js` — Early `document_start` `Proxy` guard on `Element.prototype.requestFullscreen` and `Document.prototype.exitFullscreen`.
- **Modified:**
  - `esbuild.config.mjs` — Targets `chrome111`, builds `dist/pageagent.js` without extension polyfills, injects `globalThis.browser = globalThis.browser || globalThis.chrome;` banner into `dist/content.js` and `dist/popup.js`, and copies `src/manifest.mv3.json` to `dist/manifest.json`.
  - `src/content/index.js` — Excludes `chrome-extension:` pages and uses `sendResponse({ videoCount })` + `return true` for runtime messaging compatibility.
  - `src/content/session.js`, `src/content/ui.js`, `src/content/fullscreenlock.js`, `src/content/controls/seekbar.js`, `src/content/player.css`, `src/content/video/quality.js`, `src/content/video/playlist.js`, `src/content/video/seek.js`, `src/content/video/sitecaptions.js`, `src/content/video/tracks.js`, `src/content/video/chapters.js`, `src/content/video/audiotracks.js` — Replaced Gecko-only `wrappedJSObject` / `cloneInto` / `exportFunction` crossings in the isolated bundle with synchronous `CustomEvent` bridge calls while keeping all consumer APIs synchronous; added desktop/touch Click-to-Seek and 3-tier Seekbar Thumbnail Previews.

Original upstream copyright belongs to **Vlad Pohorilets** under [MPL-2.0](LICENSE).

---

## Architecture Overview (2-World Synchronous Bridge)

Chromium does not provide Gecko's `wrappedJSObject`, `cloneInto`, or `exportFunction` to isolated content scripts. To preserve Nocturne Player's synchronous consumer architecture without `postMessage` queue noise or async UI race conditions:

1. **`pageagent.js` (`world: "MAIN"`, `run_at: "document_start"`):**
   - Installs the fullscreen lock wrapper before page scripts execute.
   - Listens for `nocturne:req` on `document` with `capture: true` so site players cannot swallow requests via `stopPropagation()`.
   - Uses `event.target` (the `<video>` element itself) as the key in a `WeakMap<HTMLVideoElement, PlayerState>` to cache `playerHost` before the `<video>` is reparented onto the Nocturne stage.
   - Dispatches `nocturne:res` on `event.target` with `bubbles: false` and a flat JSON-serializable DTO.
2. **`content.js` (`world: "ISOLATED"`, `run_at: "document_idle"`):**
   - Renders the Closed Shadow DOM badge and player overlay.
   - Calls `bridge.js`, which attaches a one-shot `nocturne:res` listener on the `<video>`, dispatches `nocturne:req`, and cleans up the listener inside a `try / finally` block. Because Blink dispatches `CustomEvent` listeners synchronously across worlds, the response is returned before `dispatchEvent()` completes.

---

## Build, Test & Package

```bash
# Install dependencies (without running parent-repo git hooks)
npm ci --ignore-scripts

# Build unpacked extension into dist/
npm run build

# Run unit tests (Node test runner)
npm test

# Run E2E tests with Playwright & system Edge
npm run test:e2e            # Local fixtures with YouTube data shapes
npm run test:e2e -- --live   # Real youtube.com (desktop)
npm run test:e2e -- --mobile # Real m.youtube.com (Pixel 7 emulation)

# Run ESLint, Prettier, and privacy audit
npm run lint

# Create Web Store / Edge Add-ons archive at artifacts/nocturne-edge.zip
npm run package
```

---

## Load Unpacked in Microsoft Edge

1. Run `npm run build` to generate the `dist/` directory.
2. Open Microsoft Edge and navigate to `edge://extensions`.
3. Enable **Developer mode** (toggle in the left sidebar or top-right corner).
4. Click **Load unpacked** and select the `dist/` directory inside this repository.

Or launch a clean temporary Edge instance directly from the terminal:

```bash
npm run fixture && npm run serve &
npm start http://localhost:8422/index.html
```

---

## Known Limitations on Chromium / Edge

- **`HTMLMediaElement.audioTracks`:** Chromium/Blink does not enable native `video.audioTracks` by default (`undefined`). Multi-audio switching works on sites powered by supported streaming engines (**hls.js**, **dash.js**, **Shaka Player**, **Playerjs**).
- **Protected Pages:** Chromium extensions cannot inject scripts into browser internal pages (`edge://`, `chrome://`, `chrome-extension://`) or the Edge Add-ons store.
- **Cross-Origin Media & Skip Intro:** As upstream, Web Audio API spectrum analysis (`Skip intro`) only operates on same-origin or CORS-enabled media streams.
- **Seekbar scrubbing:** Hovering shows the timestamp and chapter pill without seeking. Dragging pauses the main video, previews frames directly on the main `<video>` (gated by `seeked` with a 400ms stall guard), and resumes playback on release; no hidden secondary `<video>` or thumbnail card is created.
- **Smart badge auto-hide:** The fullscreen launcher badge stays visible when the video is paused, auto-hides (`opacity: 0; pointer-events: none`) after 2s while playing, and reveals on mouse movement inside the video rect, touch tap inside the video, or keyboard focus.
