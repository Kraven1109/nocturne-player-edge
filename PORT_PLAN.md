# Port Nocturne Player: Firefox/Gecko → Microsoft Edge (Chromium MV3)

Target host: Microsoft Edge trên Linux/Windows (xác nhận từ **Edge 156+**), cài bằng **Load unpacked**.
Nguồn: `kvachikk/nocturne-player` **v0.9.1** (commit `0de5804`), license **MPL-2.0**.
Thư mục làm việc: `nocturne-player-edge/` (đã vendor source, xem Phase 0).

> **Bản 3** — cập nhật sau audit + approved fixes. Kiến trúc bridge đã được **kiểm chứng thực nghiệm trên Edge 156**. Thứ tự ưu tiên SSoT: `.agents/AGENTS.md` (quy tắc bất biến) > `PORT_PLAN.md` (kiến trúc & tiến độ Phase 0–3). Không tạo `docs/plans/` cho Phase 0–3.

---

## 1. Quyết định đã chốt

| Mục                              | Chốt                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| Mô hình world                    | **2 world**: `pageagent.js` (`world:"MAIN"`) + `content.js` (ISOLATED)                            |
| Cơ chế bridge                    | **`CustomEvent` dispatch trên chính `<video>`, `bubbles:true`, đồng bộ** (KHÔNG `postMessage`)    |
| Định danh video                  | `event.target` trong MAIN (KHÔNG gắn `data-nocturne-target`)                                      |
| Lưu state phía trang             | `WeakMap<HTMLVideoElement, PlayerState>` trong MAIN (tự GC, không leak)                           |
| Dữ liệu qua bridge               | **DTO phẳng, JSON-serializable** + command; KHÔNG truyền object/handle/DOM node                   |
| Consumer (menu, quality, tracks) | **Giữ nguyên đồng bộ**, không refactor `async/await`                                              |
| Phạm vi                          | Làm đủ Phase 0 → 3                                                                                |
| Rebase                           | Giữ nhánh Firefox; thêm `manifest.mv3.json` + build target Chromium; diff trên file gốc tối thiểu |

---

## 2. Bằng chứng thực nghiệm (Edge 156.0.4314.50, Blink)

Test bằng extension MV3 tạm + `--headless=new --load-extension` trên `http://localhost:8777`.

| #   | Câu hỏi                                      | Kết quả thực đo                                                                              | Kết luận                                                     |
| --- | -------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1   | `CustomEvent.detail` có qua được 2 world?    | `kind=object json={"ok":true,"sawDetail":"object","q":"hello-from-isolated"...}` cả 2 chiều  | **Có**, detail plain-object qua được cả ISOLATED↔MAIN        |
| 2   | Dispatch có đồng bộ?                         | `SYNC[true]` (< 5 ms) cho cả round-trip request→response                                     | **Có, đồng bộ thật**                                         |
| 3   | Dispatch trên element + delegate ở `window`? | `RESULT[rid=r1 target=DIV#host len=2 first=1080p active=720p] SYNC[true]`                    | **Có**: `event.target` = đúng element, mảng object đi qua OK |
| 4   | DOM node có đi trong `detail`?               | `NODE[no-node]`                                                                              | **KHÔNG** — phải đọc `event.target`, không truyền node       |
| 5   | Expando của MAIN có thấy ở ISOLATED?         | `MAIN_EXPANDO[undefined]`                                                                    | **Không** (đúng như dự đoán) → cần WeakMap phía MAIN         |
| 6   | `video.audioTracks` trên Edge?               | `{"audioTracks_value":"undefined","audioTracks_in_proto":false,"textTracks_value":"object"}` | **Native audioTracks KHÔNG có**; `textTracks` thì có         |

Hệ quả trực tiếp:

- **Bỏ hoàn toàn** `postMessage` + Handle Registry + async refactor. Consumer giữ sync.
- **Không gắn `data-*`** lên DOM trang (tránh MutationObserver/React hydration).
- `detail` **không structured-clone**: chỉ truyền DTO phẳng; DOM node bị rơi.
- Nhánh audio-track native là vô dụng trên Edge → **buộc** dùng API engine (hls/dash/Shaka/YouTube/playerjs).

---

## 3. Kiến trúc chốt

```
┌───────────────────────────── Edge tab / frame ─────────────────────────────┐
│                                                                             │
│  MAIN WORLD (page context)                  ISOLATED WORLD (extension)      │
│  pageagent.js @ document_start              content.js @ document_idle      │
│  ┌──────────────────────────────┐           ┌────────────────────────────┐  │
│  │ - WeakMap<video, PlayerState> │           │ - overlay UI, gestures     │  │
│  │ - engines/adapters (nguyên    │           │ - seekbar, color panel     │  │
│  │   văn qualityadapters/         │           │ - chrome.storage settings  │  │
│  │   engines/sitecaptions/        │           │ - detect <video>           │  │
│  │   audiotracks/chapters)        │           │ - popup messaging          │  │
│  │ - findApiAncestor (cache)      │           │ - gửi command, nhận DTO    │  │
│  │ - fullscreen lock (patch sớm)  │           └──────────────┬─────────────┘  │
│  └───────────────▲───────────────┘                          │                │
│                  │        CustomEvent (sync, bubbles)       │                │
│        document.addEventListener ◄──────── dispatch trên <video> ────────────┤
│                  └────────────── dispatch response trên <video> ────────────►│
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.1. Giao thức

- **Request** (ISOLATED → MAIN): `video.dispatchEvent(new CustomEvent('nocturne:req', { bubbles: true, detail: { rid, op, ...args } }))`
- **Response** (MAIN → ISOLATED): MAIN dispatch `nocturne:res` trên `event.target`, ISOLATED bắt bằng listener one-shot theo `rid`, ghi vào biến local ⇒ **giá trị trả về đồng bộ**.
- Listener MAIN đăng ký ở `document_start` trên `document` → **không cần chờ phần tử tồn tại**, không cần MutationObserver.
- Vì sao `bubbles:true`: cần thiết để event từ `<video>` nổi lên listener delegate (đã test #3).
- **Cô lập iframe tự nhiên**: event không vượt biên frame; mỗi frame có MAIN+ISOLATED riêng ⇒ `all_frames:true` an toàn (không lẫn message giữa frame).
- **Chống nhiễu trang**: dùng `rid` + token phiên; trang có thể nghe lén event nhưng dữ liệu không nhạy cảm (nhãn quality/track). Có thể random hoá tên event qua handshake nếu cần.
- **Defensive**: agent bọc mọi getter/call trong try/catch như `pageapi.js` hiện tại.

### 3.2. Tập op tối thiểu (DTO phẳng)

`engines`, `findPlayerHost`, `quality.list/select/current/configure`, `captions.list/select/disable/isOn`, `audio.list/select`, `chapters.snapshot`, `lockFullscreen`/`unlockFullscreen`.

Ví dụ DTO: `{ items: [{ id:'1080', label:'1080p', height:1080, active:false }] }`, `[{ title, start, end }]`.

### 3.3. Chống leak bộ nhớ & reparent

- `WeakMap<HTMLVideoElement, PlayerState>` trong MAIN: state gắn vòng đời `<video>`; element bị GC ⇒ state bị GC. SPA đổi bài cũng không leak.
- Cache kết quả `findApiAncestor`/`findEngines` **trước khi** `session.js` reparent video (comment gốc ở `pageapi.js:99-101`); nhờ cache, lần gọi sau (sau reparent) vẫn dùng được reference cũ.
- `release` chỉ cần cho reset thủ công; không cần cho lifecycle thường.

---

## 4. Điểm Firefox-specific phải xử lý

| #   | Vị trí                                                                       | Cơ chế Gecko                     | Chromium                                                              |
| --- | ---------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------- |
| 1   | `video/pageapi.js:18,27`                                                     | `wrappedJSObject`, `cloneInto`   | MAIN world: `window`, identity                                        |
| 2   | `video/engines.js:35`                                                        | `video.wrappedJSObject`          | Không thấy `video.hls` → chuyển sang MAIN                             |
| 3   | `video/qualityadapters.js:109`                                               | `element.wrappedJSObject`        | Chuyển sang MAIN                                                      |
| 4   | `video/sitecaptions.js:51`                                                   | `element.wrappedJSObject`        | Chuyển sang MAIN                                                      |
| 5   | `video/audiotracks.js:123`                                                   | `video.audioTracks` native       | **Native undefined** (đã test) → bỏ nhánh native, buộc engine         |
| 6   | `fullscreenlock.js:20,35`                                                    | `exportFunction`, `page.Promise` | MAIN: gán trực tiếp prototype; patch ở `document_start`, gate bằng cờ |
| 7   | `video/chapters.js:112`                                                      | quét global (`ytInitialData`)    | MAIN đọc global trực tiếp                                             |
| 8   | `content/index.js:36`                                                        | `moz-extension:`                 | thêm `chrome-extension:`                                              |
| 9   | `lib/settings.js`, `lib/introstore.js`, `content/index.js`, `popup/popup.js` | `browser.*`                      | banner `globalThis.browser                                            |     | = globalThis.chrome` (chỉ 2 bundle isolated) |
| 10  | `content/index.js:97`                                                        | `onMessage` trả Promise          | đổi sang `sendResponse` + `return true`                               |
| 11  | `manifest.json`                                                              | MV2, `browser_action`, icon SVG  | MV3, `action`, icon **PNG**                                           |

**File import `pageapi.js`:** `fullscreenlock.js`, `session.js`, `video/audiotracks.js`, `video/chapters.js`, `video/playlist.js`, `video/seek.js`, `video/engines.js`, `video/sitecaptions.js`, `video/qualityadapters.js`.

---

## 5. Phase

### Phase 0 — Vendor & build (0.5 ngày)

- [x] Vendor upstream (ghim `0de5804`), giữ `LICENSE` (MPL-2.0) + `PRIVACY.md`, bỏ `.git` upstream. **KHÔNG** ghi đè `.gitignore` của port.
- [x] `npm ci --ignore-scripts` (tránh husky chạm vào repo cha).
- [x] Thêm `playwright-core` vào `devDependencies` (không tải Chromium; dùng Edge hệ thống).
- [x] `esbuild.config.mjs`: thêm bundle `src/content/pageagent.js` → `dist/pageagent.js`; `TARGET` → `chrome111`.
- [x] Banner polyfill **chỉ** cho `content.js` + `popup.js` (không đưa vào `pageagent.js` để không ô nhiễm global trang):
  ```js
  banner: {
    js: 'globalThis.browser = globalThis.browser || globalThis.chrome;';
  }
  ```
- [x] Sinh `icons/icon-{16,32,48,128}.png` từ `src/icons/icon.svg` bằng `rsvg-convert` (đã có trên máy).
- [x] `package.json`: bỏ các script `web-ext` (`start`, `start:android`, `lint:ext`); `package` dùng `python3 -m zipfile -c artifacts/nocturne-edge.zip dist` (`zip` binary **không có** trên máy).
- [x] `git init` trong `nocturne-player-edge/` + commit baseline `chore: vendor upstream nocturne-player v0.9.1 (0de5804)` (repo cha là project khác, không có commit).
- **Acceptance:** `npm run build` ra `dist/` gồm `manifest.json`, `content.js`, `pageagent.js`, `popup.js`, `popup.html`, `popup.css`, `icons/`.

### Phase 1 — MV3 + API shim → lõi player chạy trên Edge (1 ngày)

- [x] `src/manifest.mv3.json`:
  ```json
  {
    "manifest_version": 3,
    "name": "Nocturne Player",
    "version": "0.9.1-edge",
    "minimum_chrome_version": "111",
    "permissions": ["storage", "activeTab"],
    "icons": {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    },
    "action": {
      "default_title": "Nocturne Player",
      "default_popup": "popup.html",
      "default_icon": { "16": "icons/icon-16.png", "32": "icons/icon-32.png" }
    },
    "content_scripts": [
      {
        "matches": ["<all_urls>"],
        "all_frames": true,
        "run_at": "document_start",
        "world": "MAIN",
        "js": ["pageagent.js"]
      },
      {
        "matches": ["<all_urls>"],
        "all_frames": true,
        "run_at": "document_idle",
        "js": ["content.js"]
      }
    ]
  }
  ```
- [x] `content/index.js:36`: nhận `chrome-extension:`.
- [x] `content/index.js:97`: `sendResponse({videoCount})` + `return true`.
- [x] `pageagent.js` stub (chỉ trả lời `engines` rỗng) để load sạch.
- [x] `package.json`: thay script `web-ext` (`lint:ext`, `package`, `start`) bằng `python3 -m zipfile -c artifacts/... dist`; thêm `playwright-core`.
- **Acceptance:** Load unpacked OK; badge hiện; mở player: seek bar dày, tap/hold/double-tap, night light/colour, speed, subtitle `.srt/.vtt`, zoom/pinch chạy. Quality/Subtitle-của-site tạm trống.
- **TRẠNG THÁI Phase 0–1 [EMPIRICAL]:** `npm test` 80/80 pass; `lint:privacy` 41 files clean; Playwright (Edge 156) probe: badge `opacity:1`, click badge → `[data-nocturne-player]` fixed + video reparented (`controls` removed, `isFullscreen:true`); MAIN agent `ping → pong` qua CustomEvent sync. 404 duy nhất là `favicon.ico` của fixture.

### Phase 2 — SYNC CustomEvent bridge (0.5–1 ngày) → full tính năng

- [x] `src/content/pageagent.js` (MAIN, `document_start`):
  - [x] Giữ nguyên `src/content/video/pageapi.js` gốc (đã kiểm chứng `[EMPIRICAL]` trên Edge 156 qua `probe_b8_pageapi_edge.mjs`: `pageWindow() === window`, `toPage()` trả identity, `findApiAncestor` & `findGlobalMatches` chạy chuẩn trong MAIN world).
  - [x] Import `engines.js`, `qualityadapters.js`, `audiotracks.js` (bỏ nhánh native `buildNativeTracks`), cùng các module tách cho MAIN: `src/content/page/sitecaptions.main.js` (`createYouTubeTracks`), `src/content/page/chapters.main.js` (`readSiteChapters` + 5 helpers `readTitle`, `readStart`, `readChapter`, `collect`, `tidy`), `src/content/page/fullscreen.main.js`.
  - [x] `WeakMap<HTMLVideoElement, PlayerState>` + dispatcher `nocturne:req` trên `document` (`capture: true`).
  - [x] `fullscreen.main.js`: patch `Element.prototype.requestFullscreen` / `Document.prototype.exitFullscreen` **ngay ở `document_start`**, cờ `locked = false`; `fullscreen.lock`/`fullscreen.unlock` bật/tắt cờ ⇒ trang không kịp giữ reference gốc trước `document_idle`.
- [x] `src/content/page/bridge.js` (ISOLATED): client đồng bộ `requestSync(target, op, fields)`:
  - [x] **Cleanup & Detached Guard (§3.1):** Nếu op gắn với `<video>` mà `!video || !video.isConnected`, trả `null` ngay lập tức (không dispatch vô ích). Bọc `dispatchEvent` trong `try { ... } finally { node.removeEventListener('nocturne:res', onResponse); }` để tuyệt đối không rò rỉ listener khi agent vắng mặt hoặc trong lúc `seek` kéo từng frame.
- [x] **Bảng Wire Op Contract duy nhất (§3.2):**

  | `bridge.js` API                       | Target            | `op` string           | Request fields                          | Response DTO (`value`)                                                                          | Degrade khi `null`                             |
  | ------------------------------------- | ----------------- | --------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------- |
  | `ping(video)`                         | `video` / `docEl` | `'ping'`              | `{}`                                    | `'pong'`                                                                                        | `null`                                         |
  | `cacheHost(video)`                    | `video`           | `'cache-host'`        | `{}`                                    | `boolean`                                                                                       | `false`                                        |
  | `qualityProbe(video)`                 | `video`           | `'quality.list'`      | `{}`                                    | `{ name, hasAuto, options, current, diagnosis } \| null`                                        | `null` (`"set by the site"`)                   |
  | `qualitySelect(video, id)`            | `video`           | `'quality.set'`       | `{ id: string }`                        | `boolean`                                                                                       | `false`                                        |
  | `audioProbe(video)`                   | `video`           | `'audio.list'`        | `{}`                                    | `{ options, current } \| null`                                                                  | `null` (`[]`)                                  |
  | `audioSelect(video, id)`              | `video`           | `'audio.set'`         | `{ id: string }`                        | `boolean`                                                                                       | `false`                                        |
  | `captionsProbe(video)`                | `video`           | `'captions.list'`     | `{}`                                    | `{ list: string[], isOn: boolean, activeIndex: number } \| null`                                | `null` (DOM mirror)                            |
  | `captionsSelect(video, index)`        | `video`           | `'captions.set'`      | `{ index: number }`                     | `boolean`                                                                                       | `false`                                        |
  | `captionsDisable(video)`              | `video`           | `'captions.disable'`  | `{}`                                    | `boolean`                                                                                       | `false`                                        |
  | `chaptersSnapshot(video)`             | `video`           | `'chapters.snapshot'` | `{}`                                    | `{ videoId: string \| null, isAd: boolean, chapters: Array<{ title: string, start: number }> }` | `{ videoId: null, isAd: false, chapters: [] }` |
  | `playerjsId(video)`                   | `video`           | `'playerjs.id'`       | `{}`                                    | `string \| null`                                                                                | `null`                                         |
  | `seekOnSite(video, seconds, isFinal)` | `video`           | `'seek'`              | `{ seconds: number, isFinal: boolean }` | `boolean` (`true` nếu host xử lý `seekTo`)                                                      | `false` (`video.currentTime = time`)           |
  | `lockFullscreen()`                    | `documentElement` | `'fullscreen.lock'`   | `{}`                                    | `boolean`                                                                                       | `false`                                        |
  | `unlockFullscreen()`                  | `documentElement` | `'fullscreen.unlock'` | `{}`                                    | `boolean`                                                                                       | `false`                                        |

- [x] **Import-Cut cho ISOLATED Bundle (B1–B4):**
  - `src/content/video/quality.js`: bỏ import `ADAPTERS` từ `qualityadapters.js` (đặt default `adapters = []`); `ui.js` truyền `[createBridgeQualityAdapter]`; `menu.js` **không đổi**.
  - `src/content/ui.js`: thay 6 điểm dùng `playerHost` bằng bridge (`createBridgeQualityAdapter`, `createBridgeAudioTracks`, `createPlaylist(video)`, `createTrackManager(video, ...)`, `createSeeker(video)`, `chaptersSnapshot(video)`).
  - `src/content/video/sitecaptions.js` & `tracks.js`: giữ DOM mirror + `MutationObserver` + `onText` ở ISOLATED; tách YouTube page API sang `src/content/page/sitecaptions.main.js` và gọi qua `captionsProbe`/`captionsSelect`/`captionsDisable`.
  - `src/content/video/playlist.js`: giữ nguyên DOM scan (`readPlaylistLevel`) & `press()` ở ISOLATED; chỉ lấy `playerjsId(video)` qua bridge.
  - `src/content/video/seek.js`: bỏ `isFunction(host, 'seekTo')`; gọi `seekOnSite(video, time, isFinal)`, nếu `false` thì gán `video.currentTime = time`.
  - `src/content/session.js`: gọi `cacheHost(video)` **trước** `video.replaceWith(anchor)`.
  - `src/content/fullscreenlock.js`: `lockPageFullscreen()` gọi `lockFullscreen()` và trả closure gọi `unlockFullscreen()`.
  - `src/content/video/chapters.js`: chỉ giữ `chapterAt` thuần cho `seekbar.js` và unit test; chuyển `readSiteChapters` + 5 helpers sang `src/content/page/chapters.main.js`.
- [x] **Edge-cases & Sanitization (B5–B7, §4.4):**
  - [x] MAIN nghe `nocturne:req` trên `document` với **`capture: true`**; trả `nocturne:res` trên `event.target` với **`bubbles: false`**.
  - [x] Sanitize trong `pageagent.js`: allowlist `op`, kiểm tra `rid` là chuỗi hợp lệ ($\le 64$ ký tự), kiểm tra kiểu dữ liệu của `id`/`index`/`seconds`/`isFinal`.
  - [x] `WeakMap` chỉ giữ `host` ổn định (không ghi đè `host` bằng `null` khi video đang nằm trong `[data-nocturne-player]`); **không** cache cứng chapters/quality/captions/playerjsId; lắng nghe `emptied`/`loadstart` hoặc khi `currentSrc` đổi để làm mới state adapter.
  - [x] Bảo toàn chữ ký cho toàn bộ 80 unit tests + thêm 4 unit tests cho `bridge.js` (`84/84 pass`).
- **Acceptance:** YouTube: Quality liệt kê + đổi được, Subtitle đúng tracklist bật/tắt được, Chapters hiện trên seek bar. Trang `hls.js`/`dash.js`/Shaka/Playerjs: ladder hiện + đổi được. Không có `await` mới trong consumer.

### Phase 3 — Đóng gói, test, tài liệu (1 ngày)

- [x] `npm run fixture && npm run serve` (port **8422**), mở `test/fixtures/index.html`, `film.html`, `embed.html` bằng Edge đã nạp extension.
- [x] Playwright (`playwright-core`, `channel:'msedge'`, fallback `executablePath:'/opt/microsoft/msedge/msedge'`) test qua UI thật; `page.evaluate` chỉ dùng cho MAIN agent và phải listen trên `<video>` (vì response `bubbles:false`).
- [x] Smoke script: `microsoft-edge-stable --user-data-dir=$(mktemp -d /tmp/nocturne-XXXXXX) --load-extension=./dist` (không dùng `rm -rf`).
- [x] `npm test` xanh (`84/84 pass`, unit test `node --test`, không phụ thuộc browser).
- [x] `tools/check-privacy.mjs`: `CustomEvent`/`postMessage` **không** nằm trong forbidden list ⇒ không cần sửa rule; xác nhận link `github.com` ở `popup.html:35` vẫn trong allowlist (`45 files clean`).
- [x] `README-edge.md`: build, load unpacked, giới hạn đã biết, ghi rõ là bản port có sửa đổi (MPL-2.0 §3).
- **TRẠNG THÁI Phase 2–3 [EMPIRICAL]:** `npm run build` (3 bundles, 0 occurrences của `wrappedJSObject`/`cloneInto`/`exportFunction`/`pageapi` trong `dist/content.js`); `npm test` 84/84 pass; `npm run lint` (ESLint + Prettier + Privacy 45 files clean); `npm run package` tạo `artifacts/nocturne-edge.zip`; Playwright Edge 156 (`_scratch/verify_phase2_3.mjs`) xác nhận đầy đủ: `index.html`, `embed.html` iframe, `film.html`, YouTube (Quality, Captions + live DOM mirror, Chapters ticks/title, `seekTo`, SPA invalidation, Fullscreen lock), `hls.js` (Quality + Audio), `Playerjs` (Quality + Audio + Playlist), và Sanitization (`unknown-op`).

---

## 6. Phản hồi audit (từng điểm)

| #   | Nhận định audit                                    | Xử lý                        | Ghi chú                                                  |
| --- | -------------------------------------------------- | ---------------------------- | -------------------------------------------------------- |
| 1   | Handle Registry leak trên SPA                      | **Chấp nhận**                | Thay bằng `WeakMap<video, state>`                        |
| 2   | Async gây race khi đóng/mở menu                    | **Chấp nhận**                | Vô hiệu hoá bằng sync CustomEvent                        |
| 3   | `postMessage` nhiễu message queue                  | **Chấp nhận**                | Dùng CustomEvent                                         |
| 4   | `video.audioTracks` undefined trên Chromium        | **Chấp nhận, đã kiểm chứng** | Test #6: `undefined`, `proto:false` → bỏ native fallback |
| 5   | `document_start` vs `document_idle` cho fullscreen | **Chấp nhận**                | Patch sớm + gate bằng cờ                                 |
| 6   | `check-privacy.mjs` quét pattern                   | **Kiểm tra, không cần sửa**  | `CustomEvent`/`postMessage` không bị cấm                 |
| 7   | `all_frames` lẫn message                           | **Chấp nhận**                | Event giới hạn trong frame; dispatch trên `<video>`      |

**Hiệu chỉnh so với audit (dựa trên test #4):**
Audit nói "chỉ truyền JSON, không cần handle" — đúng về DTO, nhưng **vẫn cần định danh object phía trang**. Vì DOM node và handle không qua được `detail` (test #4), cách sạch là dùng chính `event.target` làm khoá `WeakMap`; public API trở thành _video-scoped command_ (`quality.list(video)`), không phải "object handle". Đây không phải "không cần identity", mà là "identity = element, không phải id số".

---

## 7. Rủi ro

| Rủi ro                                           | Mức                   | Đối sách                                                          |
| ------------------------------------------------ | --------------------- | ----------------------------------------------------------------- |
| `audioTracks` native không có                    | **Cao (đã xác nhận)** | Bắt buộc engine API; test kỹ trên YouTube/hls/dash/Shaka/playerjs |
| Trang nghe lén event của extension               | Thấp                  | DTO không nhạy cảm; `rid`+token; optional random event name       |
| `detail` không clone sâu / getter lạ             | Trung                 | Chỉ truyền DTO phẳng; agent tự serialize                          |
| Reparent video làm mất `playerHost`              | Trung                 | Cache state trong WeakMap **trước** khi reparent                  |
| Khác biệt textTracks/subtitle Blink vs Gecko     | Trung                 | `textTracks` có (test #6); test thực tế, không giả định parity    |
| Diff lớn khó rebase                              | Trung                 | Giữ file gốc, chỉ thêm `src/content/page/*` + `manifest.mv3.json` |
| `fullscreenlock` ảnh hưởng trang khi player đóng | Thấp                  | Cờ mặc định `false`, chỉ bật khi player mở                        |

---

## 8. Checklist nghiệm thu

- [x] Load unpacked, không lỗi đỏ.
- [x] Overlay/seek/gesture/night-light/speed/subtitle `.srt` OK.
- [x] YouTube: Quality, Subtitle, Chapters, Audio track OK.
- [x] Trang `hls.js`/`dash.js`/Shaka/Playerjs: Quality OK.
- [x] iframe embed: player trong iframe điều khiển đúng, không lẫn frame.
- [x] SPA đổi video (YouTube next): không leak, ladder cập nhật.
- [x] Player đóng: `requestFullscreen` của trang hoạt động lại bình thường.
- [x] `npm test` + privacy check xanh.
