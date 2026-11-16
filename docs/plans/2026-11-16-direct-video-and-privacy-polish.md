# Plan: Direct Video / Local File Support, Repo Privacy Cleanup & `.gitignore`

**Date:** 2026-11-16  
**Status:** Complete — Stage 3 & Stage 4 Verified  
**Target Release:** `0.10.0`

---

## 1. Mục tiêu

Hoàn thiện 3 hạng mục cuối trước khi phát hành `0.10.0`, tách làm 2 commit sạch:

1. **`chore(privacy)`:** Làm sạch toàn bộ dấu vết máy cục bộ trong `HEAD` + hoàn chỉnh `.gitignore` + hoàn tất batch release `0.10.0`.
2. **`feat(detect)`:** Hỗ trợ direct video & file local (`file://...mp4` / `video/*` `MediaDocument`), bảo vệ audio (`D1`) và `controls` (`D2`), tinh gọn docs.

---

## 2. Nghiên cứu thực nghiệm (`[EMPIRICAL]` trên Edge `msedge`)

Probe trên `file:///.../sample.mp4` và `http://127.0.0.1/.../sample.mp4` qua `_scratch/probe_media_doc.mjs`:

- Chrome/Edge tạo `MediaDocument` có `document.contentType = "video/mp4"`, `<video controls autoplay name="media">`, `video.style.cssText === ""`, `rect = 1280x544`.
- **`[EMPIRICAL — Blocker D1 Confirmed]` Đo RMS WebAudio passthrough (500ms `AnalyserNode`):**
  - `http://127.0.0.1/sample.mp4` (`origin: http://127.0.0.1:8442`): **`rms = 0.0897`** (passthrough bình thường).
  - `file:///.../sample.mp4` (`origin: file://`): **`rms = 0`** (tainted silence! Dù `location.origin === sourceOrigin === 'file://'`, `createMediaElementSource` xuất im lặng vĩnh viễn cho element đó).
  - **PRE-COMMIT POLICY (P1):** Bắt buộc bypass theo **protocol trước khi tạo node**: `introwatch.js` `canListen(video)` trả về `false` ngay khi `location.protocol === 'file:' || source.startsWith('file:')` — không bao giờ gọi `createMediaElementSource` trên `file://`. Ghi rõ limitation `"Skip Intro is disabled on local file:// videos (browser Web Audio restriction)"` vào `README.md` / `README-edge.md` / `PRIVACY.md`.
- Trên `file://`, `location.host === ''`, nên `detect.js`/`index.js` và [`src/popup/popup.js`](../../src/popup/popup.js) map `file:` sang key `'file:'` (mặc định enabled như `http:`/`https:`).
- **`[EMPIRICAL — D5]` Manifest & Harness:** [`src/manifest.mv3.json`](../../src/manifest.mv3.json) dùng `"matches": ["<all_urls>"]` đã phủ `file:///`. Trong E2E Edge (`--disable-extensions-except` + `--load-extension`), Edge tự nạp content script trên `file:///`; với extension cài từ Edge Store, Edge tắt `file:///` theo mặc định cho đến khi user bật thủ công **"Allow access to file URLs"** trong `edge://extensions`.

Snippet probe D1:

```js
const ctx = new AudioContext();
const src = ctx.createMediaElementSource(v);
const an = ctx.createAnalyser();
src.connect(an);
an.connect(ctx.destination);
await v.play();
await new Promise((r) => setTimeout(r, 500));
const buf = new Float32Array(an.fftSize);
an.getFloatTimeDomainData(buf);
const rms = Math.sqrt(buf.reduce((s, x) => s + x * x, 0) / buf.length);
```

---

## 3. Thay đổi dự kiến

### 3.1. Direct Video & Local File (`src/`, Commit 2)

- [`src/content/detect.js`](../../src/content/detect.js) & [`src/content/index.js`](../../src/content/index.js):
  - `isMediaDocumentSupported(contentType, protocol)` (**protocol allowlist TRƯỚC contentType — P2/D4**): kiểm tra `protocol ∈ {'http:', 'https:', 'file:'}` trước (loại `about:blank`, `data:text/html`, `blob:`, `chrome-extension:`, `edge:`), sau đó `ct === 'text/html' || ct.startsWith('video/')` (với `String(contentType || '')`; known limitation: `application/ogg` không match `video/*`).
  - `resolveHostKeys({ protocol, host, ... })`: với `protocol === 'file:'` trả về `['file:']` (mặc định enabled như HTTP).
- [`src/content/video/introwatch.js`](../../src/content/video/introwatch.js):
  - `canListen(video)`: trả về `false` ngay nếu `location.protocol === 'file:' || source.startsWith('file:')` (**P1/D1**).
- [`src/content/session.js`](../../src/content/session.js):
  - Xác nhận/bảo vệ **D2**: `captureVideoState` đã lưu `hasControlsAttribute`, `show()` đã gọi `video.removeAttribute('controls')`, `restoreVideoState` đã khôi phục khi `exit()`. Bổ sung unit test xác nhận.
- [`src/popup/popup.js`](../../src/popup/popup.js):
  - `readHost(tab)` nhận thêm `file:` (`{ key: 'file:', label: 'Local files (file://)' }`) bên cạnh `http:`/`https:`.
  - Nếu `sendMessage` lỗi trên tab `file:`, hiển thị hướng dẫn bật `"Allow access to file URLs"` trong `edge://extensions`.

### 3.2. Bảo mật thông tin máy cục bộ & `.gitignore` (Commit 1)

- Quét **toàn bộ tracked files tại `HEAD`** bằng `git grep` để xác nhận sạch đường dẫn máy cá nhân và tên distro cục bộ trong tài liệu.
- **Chính sách lịch sử Git (P3/D3):** Các chuỗi trong commit trước chỉ là đường dẫn thư mục máy (không phải secret/token/API key) nên **không rewrite git history**; làm sạch hoàn toàn tại `HEAD` và working tree là đủ cho release `0.10.0`.
- Kiểm tra `git ls-files | grep -E '\.(zip|crx|pem|xpi)$'` rỗng (`git rm --cached` nếu phát hiện).
- Hoàn chỉnh `.gitignore`: thêm `*.zip`, `*.crx`, `*.pem`, `*.xpi`, `.env`, `.env.*`, `!.env.example`, `.DS_Store`, `.npm/`, `.eslintcache`, `coverage/`, `playwright-report/`, `test-results/`, `.vscode/`, `.idea/`, `Thumbs.db`, `desktop.ini`, `*.swp`, `*.swo`, `*~` (verify `_scratch/`, `dist/`, `artifacts/` đã ignore sẵn).

### 3.3. Release Metadata & Tinh gọn Docs

- [`src/manifest.mv3.json`](../../src/manifest.mv3.json) & [`package.json`](../../package.json): version `0.10.0`, `<all_urls>` phủ `file:///`.
- [`CHANGELOG.md`](../../CHANGELOG.md), [`README.md`](../../README.md), [`README-edge.md`](../../README-edge.md), [`PRIVACY.md`](../../PRIVACY.md), [`docs/store/EDGE_ADDONS_LISTING.md`](../store/EDGE_ADDONS_LISTING.md): ghi ngắn gọn hỗ trợ direct video / `file://` (+ hướng dẫn _Allow access to file URLs_ và ghi chú không phân tích âm thanh Web Audio trên `file://`).

---

## 4. Kiểm thử (Stage 4)

- Unit tests:
  - `isMediaDocumentSupported`: `http:`/`https:`/`file:` + `text/html`/`video/mp4`/`video/webm` pass; `about:blank`, `data:text/html`, `blob:`, `chrome-extension:`, `application/pdf` reject (**D4**).
  - `introwatch.test.js`: `canListen` trả về `false` trên `file:` (**D1**), `true` trên `http:`.
  - `session.test.js`: `captureVideoState` + `restoreVideoState` giữ đúng `controls` (`D2`).
- E2E Edge (`_scratch/verify_mediadoc_e2e.mjs`) trên `file:///.../sample.mp4` và `http://.../sample.mp4`:
  - Thứ tự: (1) default-OFF vertical drag parity; (2) bật switch _Vertical swipe (Dim / Volume)_ trong menu rồi test Dim/Volume; (3) sau Exit: `video.controls === true` (`D2`), volume giữ nguyên (`G1`), và trên `file://` không tạo `MediaElementSource` nên âm thanh vẫn thông (`paused === false`, `currentTime` tiến bình thường).
  - Giữ `_scratch/probe_media_doc.mjs` tới Stage 4 rồi dọn trước commit cuối (C3/A7).
- `git grep` scan `HEAD` sạch 0 path/tên máy cục bộ, `npm run lint`, `npm run build:clean`, `npm run validate:mv3`, `npm run package`, `npm test`, `npm run test:e2e`.
