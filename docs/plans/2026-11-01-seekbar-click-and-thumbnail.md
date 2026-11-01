# Plan: Click-to-Seek & Seekbar Thumbnail Preview

**Date:** 2026-11-01  
**Status:** Stage 2 Gate (Awaiting Approval)

---

## 1. Root Cause Analysis `[EMPIRICAL]`

### 1.1. Tại sao click lên seekbar không jump tới vị trí mong muốn?

1. Trong [`src/content/player.css:235`](file:///DATA1/quang_dev/BorderlessFullscreen_Rust/nocturne-player-edge/src/content/player.css#L235), `.seekbar` đang đặt `pointer-events: none;`. Mọi thao tác chuột/chạm đều rơi xuống lớp `.surface` của [`src/content/gestures/recognizer.js`](file:///DATA1/quang_dev/BorderlessFullscreen_Rust/nocturne-player-edge/src/content/gestures/recognizer.js).
2. Trong `recognizer.js:173-189`:
   - Chỉ khi kéo (drag) vượt quá ngưỡng `MOVE_TOLERANCE_PX = 12` trong vùng `ZONE.SEEK` (`y` từ `72%` đến `88%` chiều cao màn hình) thì sự kiện `dragStart` / `dragMove` mới được phát ra.
   - Khi người dùng **click** (hoặc chạm nhả tại chỗ `< 12px`) lên thanh seekbar, `mode` giữ nguyên là `MODE.PENDING` và khi nhả chuột (`pointerup`), `recognizer.js:228` gọi `registerTap(anchor.zone, anchor)`.
   - Trong [`src/content/ui.js:413-419`](file:///DATA1/quang_dev/BorderlessFullscreen_Rust/nocturne-player-edge/src/content/ui.js#L413-L419), sự kiện `tap` chỉ gọi `setChromeVisible(...)` (ẩn/hiện thanh điều khiển) chứ **không hề thực hiện seek**.
3. Ngay cả khi bắt đầu kéo (`seekBar.start()` tại [`src/content/controls/seekbar.js:106-112`](file:///DATA1/quang_dev/BorderlessFullscreen_Rust/nocturne-player-edge/src/content/controls/seekbar.js#L106-L112)), `scrubTime` khởi tạo bằng `video.currentTime` (tính độ lệch tương đối `dx`), không nhảy tới vị trí ngang `x` trên `.seek-track`.

### 1.2. Tại sao chưa có Thumbnail khi seek?

- Upstream `nocturne-player` v0.9.1 chỉ thiết kế một nhãn chữ `.seek-time` (`0:00`) trượt theo `--progress` khi đang kéo (`seekbar.js:30,96` & `player.css:960-982`), hoàn toàn chưa có thành phần hiển thị khung hình thu nhỏ (thumbnail preview).
- Kiểm chứng thực nghiệm trên Edge 156 (`_scratch/probe_seek_thumb.mjs`):
  - Với video trực tiếp (`sample.mp4`), dùng một thẻ `<video muted playsinline preload="auto">` ẩn để seek tới thời điểm preview và vẽ lên `<canvas width="160" height="90">` qua `ctx.drawImage()` trích xuất chính xác khung hình tại từng mốc thời gian (`0.5s` vs `2.5s`, `framesDiffer: true`, `nonZeroPixels > 13000`) mà không vi phạm CSP hay privacy check.

---

## 2. Thiết kế giải pháp (Surgical Changes)

### 2.1. Click-to-Seek & Direct Track Scrubbing (`src/content/controls/seekbar.js`, `src/content/ui.js`, `src/content/player.css`)

- Bật `pointer-events: auto` và `cursor: pointer` trên `.seek-area` (khi `.chrome` không bị `[hidden]`), tăng vùng đệm cảm ứng/click (`padding: 10px 0; margin: -10px 0;`) để dễ bấm.
- Tính thời gian đích từ vị trí con trỏ trên `.seek-track`:
  $$\text{ratio} = \text{clamp}\left(\frac{\text{clientX} - \text{rect.left}}{\text{rect.width}}, 0, 1\right), \quad \text{targetTime} = \text{ratio} \times \text{duration}$$
- **Hành vi Click & Kéo trực tiếp trên `.seek-area`:**
  - `pointerdown`: bắt `setPointerCapture`, chuyển sang trạng thái scrubbing, nhảy `scrubTime` ngay tới vị trí vừa bấm (`targetTime`), hiển thị preview + gọi `seek(scrubTime, false)`. Dùng `event.stopPropagation()` để không kích hoạt `tap` ẩn controls của `.surface`.
  - `pointermove`:
    - Nếu đang giữ chuột kéo (`isTrackDragging`): cập nhật `scrubTime` theo vị trí chuột trên thanh (hỗ trợ cả giảm tốc chính xác `precisionFor` nếu kéo lệch dọc), gọi `seek(scrubTime, false)` theo nhịp `PREVIEW_INTERVAL_MS`.
    - Nếu chỉ **di chuột (hover)** trên `.seek-area`: hiển thị hộp **Thumbnail + Timestamp** tại vị trí con trỏ (`--preview`) mà không làm gián đoạn video đang phát.
  - `pointerup` / `pointercancel`: nếu đang kéo/click, chốt vị trí bằng `seek(scrubTime, true)` và thoát trạng thái scrubbing.
- **Giữ tương thích cử chỉ vuốt ngang vùng `ZONE.SEEK`:** Cử chỉ kéo ngang trên `.surface` (ngoài `.seek-area`) vẫn hoạt động như cũ cho người dùng quen vuốt kiểu điện thoại.

### 2.2. Seekbar Thumbnail Preview (`src/content/controls/seekbar.js`, `src/content/player.css`)

Thay thế/nâng cấp `.seek-time` thành hộp preview `.seek-preview` đặt phía trên `.seek-track` (di chuyển theo biến CSS `--preview`, kẹp biên trái/phải để không tràn khỏi thanh):

- Cấu trúc DOM (dùng helper `el()`, không dùng `innerHTML`):
  - `.seek-preview`
    - `.seek-thumb` (khung 160×90 bo góc, chứa `<canvas class="seek-thumb-canvas" width="160" height="90">` và lớp `.seek-thumb-sprite` cho storyboard)
    - `.seek-preview-chapter` (tên chapter tại mốc thời gian đang trỏ, nếu có)
    - `.seek-time` (mốc thời gian `formatClock(time)`)
- **3 tầng lấy hình Thumbnail (100% tuân thủ `check-privacy.mjs`, không `fetch`/`XMLHttpRequest`):**
  1. **Tầng 1 — Offscreen `<video>` Preview (cho stream trực tiếp `http:`, `https:`, `file:` không phải `blob:`):**
     - Tạo một `<video muted playsinline preload="auto">` ẩn trong bộ nhớ khi `video.currentSrc` là URL trực tiếp.
     - Khi hover/scrub tới mốc `t` (làm tròn theo bước `0.5s` và lưu cache `Map` tối đa 60 khung hình), seek `previewVideo.currentTime = t` và khi `seeked` vẽ lên `<canvas>` (`ctx.drawImage(previewVideo, 0, 0, 160, 90)`).
  2. **Tầng 2 — YouTube Storyboard DOM Mirror (cho YouTube MSE `blob:`):**
     - Giống cơ chế DOM mirror của `sitecaptions.js` và `playlist.js`: khi trang có `.ytp-progress-bar` và `.ytp-tooltip-bg`, phát sự kiện `mousemove` tương ứng tỷ lệ `ratio` lên `.ytp-progress-bar` của trang để player YouTube tự tính sprite storyboard, sau đó đọc `backgroundImage`, `backgroundPosition`, `backgroundSize` của `.ytp-tooltip-bg` áp vào `.seek-thumb-sprite`.
  3. **Tầng 3 — Fallback `<video>` chính (`ctx.drawImage(video, ...)`):**
     - Khi đang kéo seek (`seek(scrubTime, false)`) trên các nguồn MSE `blob:` khác (hls.js/dash.js) hoặc khi frame đã có trong `<video>` chính, vẽ trực tiếp khung hình hiện tại của `video` lên `<canvas>`.

---

## 3. Danh sách file dự kiến thay đổi

| Action | File                                                        | Mô tả                                                                                                                                  |
| ------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Modify | `src/content/controls/seekbar.js`                           | Thêm xử lý click-to-seek, hover/drag trên `.seek-area`, và bộ tạo thumbnail preview 3 tầng + dọn dẹp trong `destroy()`                 |
| Modify | `src/content/ui.js`                                         | Truyền callback `onInteract` (làm mới idle timer của chrome) vào `createSeekBar` để click/kéo seekbar không làm tự ẩn thanh điều khiển |
| Modify | `src/content/player.css`                                    | Bật `pointer-events: auto` cho `.seek-area`, thêm style cho `.seek-preview`, `.seek-thumb`, `.seek-thumb-canvas`, `.seek-thumb-sprite` |
| Create | `test/unit/seekbar.test.js`                                 | Unit test cho toán học tính tỷ lệ click-to-seek và kẹp biên preview                                                                    |
| Create | `docs/changelogs/2026-11-01-seekbar-click-and-thumbnail.md` | Ghi nhận tính năng/fix sau Phase 3 theo đúng Rule A0                                                                                   |
