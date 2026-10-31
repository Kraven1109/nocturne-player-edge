# Port Nocturne Player: Firefox/Gecko → Microsoft Edge (Chromium MV3)

Target host: Microsoft Edge trên CachyOS (đã xác nhận **Edge 156.0.4314.50**), cài bằng **Load unpacked**.
Nguồn: `kvachikk/nocturne-player` **v0.9.1** (commit `0de5804`), license **MPL-2.0**.
Thư mục làm việc: `nocturne-player-edge/` (đã vendor source, xem Phase 0).

> **Bản 3** — cập nhật sau audit + approved fixes. Kiến trúc bridge đã được **kiểm chứng thực nghiệm trên Edge 156**. Thứ tự ưu tiên SSoT: `.agents/AGENTS.md` (quy tắc bất biến) > `PORT_PLAN.md` (kiến trúc & tiến độ Phase 0–3). Không tạo `docs/plans/` cho Phase 0–3.

---

## 1. Quyết định đã chốt

| Mục | Chốt |
|-----|------|
| Mô hình world | **2 world**: `pageagent.js` (`world:"MAIN"`) + `content.js` (ISOLATED) |
| Cơ chế bridge | **`CustomEvent` dispatch trên chính `<video>`, `bubbles:true`, đồng bộ** (KHÔNG `postMessage`) |
| Định danh video | `event.target` trong MAIN (KHÔNG gắn `data-nocturne-target`) |
| Lưu state phía trang | `WeakMap<HTMLVideoElement, PlayerState>` trong MAIN (tự GC, không leak) |
| Dữ liệu qua bridge | **DTO phẳng, JSON-serializable** + command; KHÔNG truyền object/handle/DOM node |
| Consumer (menu, quality, tracks) | **Giữ nguyên đồng bộ**, không refactor `async/await` |
| Phạm vi | Làm đủ Phase 0 → 3 |
| Rebase | Giữ nhánh Firefox; thêm `manifest.mv3.json` + build target Chromium; diff trên file gốc tối thiểu |

---

## 2. Bằng chứng thực nghiệm (Edge 156.0.4314.50, Blink)

Test bằng extension MV3 tạm + `--headless=new --load-extension` trên `http://localhost:8777`.

| # | Câu hỏi | Kết quả thực đo | Kết luận |
|---|---------|-----------------|----------|
| 1 | `CustomEvent.detail` có qua được 2 world? | `kind=object json={"ok":true,"sawDetail":"object","q":"hello-from-isolated"...}` cả 2 chiều | **Có**, detail plain-object qua được cả ISOLATED↔MAIN |
| 2 | Dispatch có đồng bộ? | `SYNC[true]` (< 5 ms) cho cả round-trip request→response | **Có, đồng bộ thật** |
| 3 | Dispatch trên element + delegate ở `window`? | `RESULT[rid=r1 target=DIV#host len=2 first=1080p active=720p] SYNC[true]` | **Có**: `event.target` = đúng element, mảng object đi qua OK |
| 4 | DOM node có đi trong `detail`? | `NODE[no-node]` | **KHÔNG** — phải đọc `event.target`, không truyền node |
| 5 | Expando của MAIN có thấy ở ISOLATED? | `MAIN_EXPANDO[undefined]` | **Không** (đúng như dự đoán) → cần WeakMap phía MAIN |
| 6 | `video.audioTracks` trên Edge? | `{"audioTracks_value":"undefined","audioTracks_in_proto":false,"textTracks_value":"object"}` | **Native audioTracks KHÔNG có**; `textTracks` thì có |

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

`engines`, `findPlayerHost`, `quality.list/select/current/configure`, `captions.list/select/disable/isOn`, `audio.list/select`, `chapters`, `lockFullscreen`/`unlockFullscreen`.

Ví dụ DTO: `{ items: [{ id:'1080', label:'1080p', height:1080, active:false }] }`, `[{ title, start, end }]`.

### 3.3. Chống leak bộ nhớ & reparent

- `WeakMap<HTMLVideoElement, PlayerState>` trong MAIN: state gắn vòng đời `<video>`; element bị GC ⇒ state bị GC. SPA đổi bài cũng không leak.
- Cache kết quả `findApiAncestor`/`findEngines` **trước khi** `session.js` reparent video (comment gốc ở `pageapi.js:99-101`); nhờ cache, lần gọi sau (sau reparent) vẫn dùng được reference cũ.
- `release` chỉ cần cho reset thủ công; không cần cho lifecycle thường.

---

## 4. Điểm Firefox-specific phải xử lý

| # | Vị trí | Cơ chế Gecko | Chromium |
|---|--------|--------------|----------|
| 1 | `video/pageapi.js:18,27` | `wrappedJSObject`, `cloneInto` | MAIN world: `window`, identity |
| 2 | `video/engines.js:35` | `video.wrappedJSObject` | Không thấy `video.hls` → chuyển sang MAIN |
| 3 | `video/qualityadapters.js:109` | `element.wrappedJSObject` | Chuyển sang MAIN |
| 4 | `video/sitecaptions.js:51` | `element.wrappedJSObject` | Chuyển sang MAIN |
| 5 | `video/audiotracks.js:123` | `video.audioTracks` native | **Native undefined** (đã test) → bỏ nhánh native, buộc engine |
| 6 | `fullscreenlock.js:20,35` | `exportFunction`, `page.Promise` | MAIN: gán trực tiếp prototype; patch ở `document_start`, gate bằng cờ |
| 7 | `video/chapters.js:112` | quét global (`ytInitialData`) | MAIN đọc global trực tiếp |
| 8 | `content/index.js:36` | `moz-extension:` | thêm `chrome-extension:` |
| 9 | `lib/settings.js`, `lib/introstore.js`, `content/index.js`, `popup/popup.js` | `browser.*` | banner `globalThis.browser ||= globalThis.chrome` (chỉ 2 bundle isolated) |
| 10 | `content/index.js:97` | `onMessage` trả Promise | đổi sang `sendResponse` + `return true` |
| 11 | `manifest.json` | MV2, `browser_action`, icon SVG | MV3, `action`, icon **PNG** |

**File import `pageapi.js`:** `fullscreenlock.js`, `session.js`, `video/audiotracks.js`, `video/chapters.js`, `video/playlist.js`, `video/seek.js`, `video/engines.js`, `video/sitecaptions.js`, `video/qualityadapters.js`.

---

## 5. Phase

### Phase 0 — Vendor & build (0.5 ngày)

- [ ] Vendor upstream (ghim `0de5804`), giữ `LICENSE` (MPL-2.0) + `PRIVACY.md`, bỏ `.git` upstream. **KHÔNG** ghi đè `.gitignore` của port.
- [ ] `npm ci --ignore-scripts` (tránh husky chạm vào repo cha).
- [ ] Thêm `playwright-core` vào `devDependencies` (không tải Chromium; dùng Edge hệ thống).
- [ ] `esbuild.config.mjs`: thêm bundle `src/content/pageagent.js` → `dist/pageagent.js`; `TARGET` → `chrome111`.
- [ ] Banner polyfill **chỉ** cho `content.js` + `popup.js` (không đưa vào `pageagent.js` để không ô nhiễm global trang):
  ```js
  banner: { js: 'globalThis.browser = globalThis.browser || globalThis.chrome;' }
  ```
- [ ] Sinh `icons/icon-{16,32,48,128}.png` từ `src/icons/icon.svg` bằng `rsvg-convert` (đã có trên máy).
- [ ] `package.json`: bỏ các script `web-ext` (`start`, `start:android`, `lint:ext`); `package` dùng `python3 -m zipfile -c artifacts/nocturne-edge.zip dist` (`zip` binary **không có** trên máy).
- [ ] `git init` trong `nocturne-player-edge/` + commit baseline `chore: vendor upstream nocturne-player v0.9.1 (0de5804)` (repo cha là project khác, không có commit).
- **Acceptance:** `npm run build` ra `dist/` gồm `manifest.json`, `content.js`, `pageagent.js`, `popup.js`, `popup.html`, `popup.css`, `icons/`.

### Phase 1 — MV3 + API shim → lõi player chạy trên Edge (1 ngày)

- [ ] `src/manifest.mv3.json`:
  ```json
  {
    "manifest_version": 3,
    "name": "Nocturne Player",
    "version": "0.9.1-edge",
    "minimum_chrome_version": "111",
    "permissions": ["storage", "activeTab"],
    "icons": { "16":"icons/icon-16.png","32":"icons/icon-32.png","48":"icons/icon-48.png","128":"icons/icon-128.png" },
    "action": { "default_title":"Nocturne Player","default_popup":"popup.html",
                "default_icon": { "16":"icons/icon-16.png","32":"icons/icon-32.png" } },
    "content_scripts": [
      { "matches":["<all_urls>"],"all_frames":true,"run_at":"document_start","world":"MAIN","js":["pageagent.js"] },
      { "matches":["<all_urls>"],"all_frames":true,"run_at":"document_idle","js":["content.js"] }
    ]
  }
  ```
- [ ] `content/index.js:36`: nhận `chrome-extension:`.
- [ ] `content/index.js:97`: `sendResponse({videoCount})` + `return true`.
- [ ] `pageagent.js` stub (chỉ trả lời `engines` rỗng) để load sạch.
- [ ] `package.json`: thay script `web-ext` (`lint:ext`, `package`, `start`) bằng `python3 -m zipfile -c artifacts/... dist`; thêm `playwright-core`.
- **Acceptance:** Load unpacked OK; badge hiện; mở player: seek bar dày, tap/hold/double-tap, night light/colour, speed, subtitle `.srt/.vtt`, zoom/pinch chạy. Quality/Subtitle-của-site tạm trống.

### Phase 2 — SYNC CustomEvent bridge (0.5–1 ngày) → full tính năng

- [ ] `src/content/pageagent.js` (MAIN, `document_start`):
  - [ ] `src/content/page/pageapi.main.js`: `pageWindow()→window`, `toPage()→identity`; giữ nguyên `read/call/write/toArray/isFunction/findApiAncestor/findGlobalMatches`.
  - [ ] Import **nguyên văn** `engines.js`, `qualityadapters.js`, `sitecaptions.js`, `audiotracks.js` (bỏ nhánh native `audioTracks`), `chapters.js`, `fullscreenlock.js`.
  - [ ] `WeakMap<video, PlayerState>` + dispatcher `nocturne:req` trên `document`.
  - [ ] `fullscreenlock`: patch `Element.prototype.requestFullscreen` / `Document.prototype.exitFullscreen` **ngay ở `document_start`**, cờ `locked=false`; `lockFullscreen`/`unlockFullscreen` bật/tắt cờ ⇒ trang không kịp giữ reference gốc trước `document_idle`.
- [ ] `src/content/page/bridge.js` (ISOLATED): client đồng bộ `call(video, op, args)` — dispatch + one-shot response capture.
- [ ] Thay `pageapi.js` imports bằng bridge ở: `session.js` (`findApiAncestor` → cache trước reparent), `video/playlist.js`, `video/seek.js`, `video/quality.js`, `video/tracks.js` (nếu cần).
- [ ] `video/quality.js`: `refresh()` vẫn sync, gọi `bridge.qualityList(video)`; `menu.js` **không đổi**.
- [ ] Edge-case (đã duyệt):
  - [ ] MAIN nghe `nocturne:req` trên `document` với **`capture: true`** (chống `stopPropagation` ở pha bubble của player).
  - [ ] Response `nocturne:res` dispatch trên `event.target` với **`bubbles: false`**; `bridge.js` gắn one-shot listener trực tiếp trên `<video>`.
  - [ ] Op cấp trang (`lockFullscreen`, `unlockFullscreen`) hoặc khi `!video.isConnected`: dispatch trên `document.documentElement` (chỉ cho op **không cần** video).
  - [ ] `WeakMap` chỉ cache `playerHost` ổn định; **không** cache chapters/quality/track list. Invalidate cache per-video khi `currentSrc` đổi hoặc `emptied`/`loadstart`.
- **Acceptance:** YouTube: Quality liệt kê + đổi được, Subtitle đúng tracklist bật/tắt được, Chapters hiện trên seek bar. Trang `hls.js`/`dash.js`/Shaka/Playerjs: ladder hiện + đổi được. Không có `await` mới trong consumer.

### Phase 3 — Đóng gói, test, tài liệu (1 ngày)

- [ ] `npm run fixture && npm run serve` (port **8422**), mở `test/fixtures/index.html`, `film.html`, `embed.html` bằng Edge đã nạp extension.
- [ ] Playwright (`playwright-core`, `channel:'msedge'`, fallback `executablePath:'/opt/microsoft/msedge/msedge'`) test qua UI thật; `page.evaluate` chỉ dùng cho MAIN agent và phải listen trên `<video>` (vì response `bubbles:false`).
- [ ] Smoke script: `microsoft-edge-stable --user-data-dir=$(mktemp -d /tmp/nocturne-XXXXXX) --load-extension=./dist` (không dùng `rm -rf`).
- [ ] `npm test` xanh (unit test `node --test`, không phụ thuộc browser).
- [ ] `tools/check-privacy.mjs`: `CustomEvent`/`postMessage` **không** nằm trong forbidden list ⇒ không cần sửa rule; xác nhận link `github.com` ở `popup.html:35` vẫn trong allowlist.
- [ ] `README-edge.md`: build, load unpacked, giới hạn đã biết, ghi rõ là bản port có sửa đổi (MPL-2.0 §3).

---

## 6. Phản hồi audit (từng điểm)

| # | Nhận định audit | Xử lý | Ghi chú |
|---|-----------------|-------|---------|
| 1 | Handle Registry leak trên SPA | **Chấp nhận** | Thay bằng `WeakMap<video, state>` |
| 2 | Async gây race khi đóng/mở menu | **Chấp nhận** | Vô hiệu hoá bằng sync CustomEvent |
| 3 | `postMessage` nhiễu message queue | **Chấp nhận** | Dùng CustomEvent |
| 4 | `video.audioTracks` undefined trên Chromium | **Chấp nhận, đã kiểm chứng** | Test #6: `undefined`, `proto:false` → bỏ native fallback |
| 5 | `document_start` vs `document_idle` cho fullscreen | **Chấp nhận** | Patch sớm + gate bằng cờ |
| 6 | `check-privacy.mjs` quét pattern | **Kiểm tra, không cần sửa** | `CustomEvent`/`postMessage` không bị cấm |
| 7 | `all_frames` lẫn message | **Chấp nhận** | Event giới hạn trong frame; dispatch trên `<video>` |

**Hiệu chỉnh so với audit (dựa trên test #4):**
Audit nói "chỉ truyền JSON, không cần handle" — đúng về DTO, nhưng **vẫn cần định danh object phía trang**. Vì DOM node và handle không qua được `detail` (test #4), cách sạch là dùng chính `event.target` làm khoá `WeakMap`; public API trở thành *video-scoped command* (`quality.list(video)`), không phải "object handle". Đây không phải "không cần identity", mà là "identity = element, không phải id số".

---

## 7. Rủi ro

| Rủi ro | Mức | Đối sách |
|--------|-----|----------|
| `audioTracks` native không có | **Cao (đã xác nhận)** | Bắt buộc engine API; test kỹ trên YouTube/hls/dash/Shaka/playerjs |
| Trang nghe lén event của extension | Thấp | DTO không nhạy cảm; `rid`+token; optional random event name |
| `detail` không clone sâu / getter lạ | Trung | Chỉ truyền DTO phẳng; agent tự serialize |
| Reparent video làm mất `playerHost` | Trung | Cache state trong WeakMap **trước** khi reparent |
| Khác biệt textTracks/subtitle Blink vs Gecko | Trung | `textTracks` có (test #6); test thực tế, không giả định parity |
| Diff lớn khó rebase | Trung | Giữ file gốc, chỉ thêm `src/content/page/*` + `manifest.mv3.json` |
| `fullscreenlock` ảnh hưởng trang khi player đóng | Thấp | Cờ mặc định `false`, chỉ bật khi player mở |

---

## 8. Checklist nghiệm thu

- [ ] Load unpacked, không lỗi đỏ.
- [ ] Overlay/seek/gesture/night-light/speed/subtitle `.srt` OK.
- [ ] YouTube: Quality, Subtitle, Chapters, Audio track OK.
- [ ] Trang `hls.js`/`dash.js`/Shaka/Playerjs: Quality OK.
- [ ] iframe embed: player trong iframe điều khiển đúng, không lẫn frame.
- [ ] SPA đổi video (YouTube next): không leak, ladder cập nhật.
- [ ] Player đóng: `requestFullscreen` của trang hoạt động lại bình thường.
- [ ] `npm test` + privacy check xanh.