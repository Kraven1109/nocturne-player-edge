# Plan: Smart Auto-Hide Badge & Direct Main-Video Scrubbing

**Date:** 2026-11-16  
**Status:** Completed (Stage 5 — Implemented & Verified on Edge 156)  
**Base commit:** `4af732a`

---

## 1. Mục tiêu & Bối cảnh

Khắc phục 2 điểm bất tiện UI/UX được phản ánh khi sử dụng trên Edge:

1. **Smart Auto-Hide Badge (`src/content/controls/badge.js`):** Hiện tại nút tròn 44×44px luôn hiển thị `opacity: 1` suốt thời gian video nằm trong viewport (`>= 35%`), che một phần khung hình khi đang xem bình thường. Chuyển sang tự ẩn khi đang play và hiện lại theo ngữ cảnh (di chuột trong vùng video, chạm, focus bàn phím, hoặc pause).
2. **Bỏ Seekbar Thumbnail, Preview trực tiếp trên video chính (`src/content/controls/seekbar.js`, `src/content/player.css`, `src/content/pageagent.js`):** Loại bỏ ô thumbnail nhỏ (`.seek-thumb`) và bộ `createThumbnailer` (vốn tạo thêm thẻ `<video preload="auto">` ẩn, giữ cache 60 `ImageData` từ `getImageData`, và bắn synthetic `mousemove` lên `.ytp-progress-bar`). Thay bằng cơ chế **pause-while-scrubbing + `seeked`-gated preview** ngay trên `<video>` chính khi đang kéo, còn khi chỉ rê chuột (hover) chỉ hiện pill giờ + tên chapter.

---

## 2. Cơ chế đa video trên cùng trang & Ai quản lý việc tải video

### 2.1. Multi-video trên cùng một webpage

- Toàn trang (trong một frame) chỉ khởi tạo **duy nhất 1 instance `badge`** (`src/content/index.js:47`).
- [`createVideoWatcher`](../../src/content/detect.js#L72-L134) quét các `<video>` hợp lệ (`isPlayable`: `rect >= 200x150`, không bị ẩn, `readyState >= HAVE_METADATA || currentSrc !== ''`) và chọn **duy nhất 1 `primary` video** theo điểm:
  $$\text{score} = \text{visibleArea}(rect) \times (\text{paused} ? 1 : 3) \times (\text{readyState} \ge 1 ? 1.5 : 1)$$
- Khi có nhiều video trên trang:
  - Video đang play có trọng số `3×` nên **thường** trở thành `primary` khi các video có diện tích hiển thị tương đương (lưu ý: `score` vẫn nhân `visibleArea`, nên một video lớn đang pause vẫn thắng video nhỏ đang play).
  - Khi user cuộn sang video khác hoặc bấm play một video khác, `watcher` bắn `onPrimaryChange(nextVideo)` $\to$ `badge.show(nextVideo)`.
  - Trong Smart Badge mới, `badge.js` phải **gỡ listener `play`/`pause` khỏi `target` cũ và gắn sang `target` mới** mỗi khi `show(video)` đổi đối tượng, đồng thời tính lại trạng thái ẩn/hiện theo `target.paused`.
  - Khi đã bấm mở Nocturne, [`session.js`](../../src/content/session.js) chỉ lấy duy nhất `firstVideo` đưa lên `stage`; các `<video>` khác không bị chạm tới.

### 2.2. Ai quản lý việc load dữ liệu video? Extension hay Trình duyệt?

- **Trên trang web gốc (chưa mở Nocturne):** Việc nạp/pre-buffer các `<video>` là **100% do website và cơ chế `HTMLMediaElement` của trình duyệt (Chromium)** quản lý.
  - `detect.js` chỉ **đọc** DOM và thuộc tính sẵn có (`getBoundingClientRect`, `getComputedStyle`, `readyState`, `currentSrc`, `paused`). Extension **không gọi** `.load()`, `.play()`, không sửa `preload`, và không tạo thẻ `<video>` mới cho các video trên trang.
- **Ngoại lệ duy nhất hiện tại nằm ở `createThumbnailer` (`seekbar.js:156-194`):** Khi _đã mở_ Nocturne trên một URL trực tiếp (không phải `blob:`), chính extension tạo thêm một `<video preload="auto">` ẩn thứ hai để lấy khung hình thumbnail. Khi bỏ `createThumbnailer` trong kế hoạch này, extension sẽ **không tự tạo thêm bất kỳ luồng tải `<video>` phụ nào nữa**.

---

## 3. Thiết kế chi tiết

### 3.1. Smart Auto-Hide Badge (`src/content/controls/badge.js`)

#### Trạng thái & Tham số

- `IDLE_HIDE_MS = 2000` (thời gian chờ trước khi ẩn khi đang play).
- `MOVE_THROTTLE_MS = 100` (giới hạn tần suất đọc `getBoundingClientRect()`).
- Trạng thái nội bộ:
  - `isRevealed` (`boolean`): `true` khi video `paused` hoặc vừa có tương tác hợp lệ.
  - `isPointerOnBadge` (`boolean`): giữ badge không tự ẩn khi con trỏ đang đậu trên nút.
  - `isFocused` (`boolean`): giữ badge hiện khi đang nhận focus bàn phím (`focusin`/`focusout`).
  - `idleTimer` (`number | null`).
  - `moveTrailingTimer` (`number | null`).
  - `lastMoveCheckAt` (`number`).
  - `lastPointer` (`{ x: number, y: number } | null`).

#### Luồng chuyển trạng thái

1. **Khi `show(video)` được gọi:**
   - Nếu `target !== video`: gỡ listener `play` / `pause` ở `target` cũ (nếu có), gán `target = video`, gắn listener `play` / `pause` vào `target` mới.
   - `mount()` ngoài gắn listener phải **đảm bảo host hiện diện trong DOM**: nếu `!shell.host.isConnected` $\to$ `document.body.append(shell.host)` (đối xứng với `shell.host.remove()` của `hide()`).
   - Gắn global & badge listener một lần khi mount (`!isMounted` $\to$ `mount()`, set `isMounted = true`):
     - `window` `scroll` (`{ passive: true, capture: true }`), `resize` (`{ passive: true }`) $\to$ `scheduleReposition()`
     - `document` `pointermove` (`{ passive: true, capture: true }`) $\to$ `handleDocumentPointerMove(event)`
     - `document` `pointerdown` (`{ passive: true, capture: true }`) $\to$ `handleDocumentPointerDown(event)`
     - Trên `button` (badge root):
       - `pointerenter` $\to$ `isPointerOnBadge = true`, `clearIdleTimer()`
       - `pointerleave` $\to$ `isPointerOnBadge = false`; nếu `target && !target.paused && !isFocused` $\to$ `scheduleIdleHide()`
       - `focusin` $\to$ `isFocused = true`, `reveal()`, `clearIdleTimer()` (badge ẩn vẫn nằm trong tab order — **không** đặt `aria-hidden` khi concealed; Tab tới là tự hiện)
       - `focusout` $\to$ `isFocused = false`; nếu `target && !target.paused && !isPointerOnBadge` $\to$ `scheduleIdleHide()`
   - Nếu `target.paused`: gọi `reveal()`, `clearIdleTimer()` (hiện vĩnh viễn cho tới khi play).
   - Nếu `!target.paused`: gọi `reveal()` rồi đặt `scheduleIdleHide()` (hiện 2s để user biết nút có mặt, sau đó tự ẩn nếu không di chuột trong video).

2. **Khi `play` / `pause` trên `target` và `scheduleIdleHide()`:**
   - `pause`: gọi `reveal()`, `clearIdleTimer()`.
   - `play`: gọi `scheduleIdleHide()`. Hàm expire phải tự guard (trường hợp chuột đang đậu trên badge, đang focus bàn phím, hoặc `target` đã pause / đổi video qua `show()`):

   ```js
   const clearIdleTimer = () => {
     if (idleTimer === null) return;
     clearTimeout(idleTimer);
     idleTimer = null;
   };

   const scheduleIdleHide = () => {
     clearIdleTimer();
     if (!target || target.paused) return;
     idleTimer = setTimeout(() => {
       idleTimer = null;
       if (!target || target.paused || isPointerOnBadge || isFocused) return;
       isRevealed = false;
       conceal();
     }, IDLE_HIDE_MS);
   };
   ```

3. **Khi `handleDocumentPointerMove(event)`:**
   - Throttle theo `MOVE_THROTTLE_MS` **áp dụng cho mọi lần đọc bbox, kể cả khi badge đang hidden** (lúc hidden chuột chạy ngoài video mới là cao-frequency nhất). Bắt buộc có **trailing edge**: move cuối rơi vào cửa sổ throttle phải được hẹn kiểm tra lại, vì chuột có thể DỪNG HẲN trong video rect (leading-only sẽ không bao giờ reveal).

   ```js
   const checkPointer = () => {
     if (!isMounted || !target || target.paused || !lastPointer) return;
     const rect = target.getBoundingClientRect();
     const inside =
       lastPointer.x >= rect.left &&
       lastPointer.x <= rect.right &&
       lastPointer.y >= rect.top &&
       lastPointer.y <= rect.bottom;
     if (inside) {
       reveal();
       scheduleIdleHide();
     } else if (!isPointerOnBadge && !isFocused && isRevealed) {
       clearIdleTimer();
       isRevealed = false;
       conceal();
     }
   };

   const handleDocumentPointerMove = (event) => {
     if (
       !isMounted ||
       !target ||
       target.paused ||
       event.pointerType !== 'mouse'
     ) {
       return;
     }
     lastPointer = { x: event.clientX, y: event.clientY };
     const wait = MOVE_THROTTLE_MS - (performance.now() - lastMoveCheckAt);
     if (wait <= 0) {
       if (moveTrailingTimer !== null) {
         clearTimeout(moveTrailingTimer);
         moveTrailingTimer = null;
       }
       lastMoveCheckAt = performance.now();
       checkPointer();
     } else if (moveTrailingTimer === null) {
       moveTrailingTimer = setTimeout(() => {
         moveTrailingTimer = null;
         lastMoveCheckAt = performance.now();
         checkPointer();
       }, wait);
     }
   };
   ```

4. **Khi `handleDocumentPointerDown(event)`:**
   - Nếu `!isMounted || !target || target.paused`: bỏ qua.
   - Nếu `(event.clientX, event.clientY)` nằm trong `target.getBoundingClientRect()`: gọi `reveal()` + `scheduleIdleHide()` (giúp user cảm ứng hoặc click chạm video đánh thức được nút).

5. **Trong `reposition()`, `conceal()`, và `reveal()`:**
   - `reposition()`: nếu `!target?.isConnected || rect.width === 0 || !isMostlyVisible(rect) || !isRevealed` $\to$ `conceal()` và thoát.
   - `conceal()` đặt `opacity: '0'`, `'pointer-events': 'none'` (để **không nuốt click** vào video gốc), **mirror `shell.host.dataset.revealed = 'false'`** (test-hook công khai cho E2E vì button nằm trong closed Shadow DOM), và **đồng thời reset `isPointerOnBadge = false`** (tránh kẹt cờ khi conceal cưỡng bức lúc con trỏ đang trên badge vì `pointer-events: none` có thể chặn `pointerleave`).
   - `reveal()` đặt `isRevealed = true`, mirror `shell.host.dataset.revealed = 'true'`, khôi phục `'pointer-events': 'auto'` (qua `reposition()`), và áp trạng thái hiển thị ngay nếu đang mount.

6. **Trong `hide()`:**
   - Gỡ `play`/`pause` khỏi `target`; gỡ `pointermove`/`pointerdown` khỏi `document`; gỡ `scroll`/`resize` khỏi `window`; gỡ `pointerenter`/`pointerleave`/`focusin`/`focusout` khỏi `button`;
   - Xóa `idleTimer` (`clearIdleTimer()`) và `moveTrailingTimer` (kèm `= null`);
   - Cancel rAF pending của `scheduleReposition()` (`frame = 0`);
   - Reset `isPointerOnBadge = false`, `isFocused = false`, `lastPointer = null`;
   - Gán `target = null`, `shell.host.remove()`, và **`isMounted = false`** để lần `show()` kế tiếp mount lại toàn bộ listener.

---

### 3.2. Direct Main-Video Scrubbing không cần Thumbnail (`src/content/controls/seekbar.js`, `src/content/player.css`, `src/content/pageagent.js`)

#### Loại bỏ phần Thumbnail thừa

- Xóa `createThumbnailer`, `PREVIEW_INTERVAL_MS`, `THUMB_WIDTH`, `THUMB_HEIGHT`, `BUCKET_STEP_SEC`, `MAX_CACHED_FRAMES`, `isDirectMediaUrl`, `fitThumb`.
- Trong DOM `.seek-preview` của `createSeekBar`: chỉ giữ `previewChapter` (`.seek-preview-chapter`) và `headTime` (`.seek-time`). Bỏ `thumbCanvas`, `thumbSprite`, `thumbBox`.
- Trong `player.css`: xóa các rule `.seek-thumb`, `.seek-thumb.is-ready`, `.seek-thumb-canvas`, `.seek-thumb-sprite`, `.seek-thumb.is-sprite ...`. Giữ nguyên `.seek-preview`, `.seek-preview-chapter`, `.seek-time` và `.seek-area`.

#### Phát hiện thực nghiệm quan trọng trên YouTube (`pageagent.js`)

- Probe thực nghiệm trên Edge 156 + `youtube.com` (`_scratch/probe_yt_scrub_paused.mjs`, `_scratch/probe_yt_seek_modes.mjs`, `_scratch/probe_yt_rapid_true.mjs`) cho thấy:
  - `player.seekTo(seconds, false)` (`isFinal = false`) trên YouTube **KHÔNG hề di chuyển `<video>.currentTime`** (đứng yên ở `0.021` kể cả trong vùng đã buffer `[0, 20s]`), **không bắn `seeked`**, và tự pause video nếu đang play.
  - Ngược lại, khi `<video>` đã `pause()`, gọi `player.seekTo(seconds, true)` (hoặc gán `video.currentTime` trong vùng buffer): cập nhật ngay `currentTime`, bắn `seeked` sau **5–124ms**, giữ nguyên `paused === true`, không xé bỏ phần tử `<video>` (`emptied === 0, sameEl === true`).
- Vì vậy, để preview trực tiếp lên video chính hoạt động cả trên **YouTube**, trong [`pageagent.js`](../../src/content/pageagent.js#L216-L222) (`op === 'seek'`):
  - Nếu là YouTube host có `seekTo`: gọi `call(state.host, 'seekTo', seconds, true)` (vì tốc độ gọi preview nay đã được `seekbar.js` **pause + `seeked`-gate** điều tiết, không còn bắn mù mỗi 100ms lúc đang play nữa).
  - **Trade-off định lượng (chấp nhận):** Preview ngoài buffer sẽ kích hoạt fetch segment thật (tối đa ~2.5 seek/s nhờ stall-gate 400ms + coalesce-latest, chỉ 1 chuỗi seek in-flight tại một thời điểm); trong buffer đạt ~5–15 seek/s và không tốn network thêm. E2E Stage 3 phải assert không gây `session.js` exit.
  - **V-2 Verified (`grep`):** Toàn bộ các caller `seek(...)` khác trong `src/content/` (`introskip.js:34`, `ui.js:342`, `ui.js:374`) đều giữ mặc định `isFinal = true`; chỉ `seekbar.js` gọi `seek(..., false)`.

#### Tách rạch ròi Hover vs Scrub

- **Hover (`pointermove` trên `.seek-area` khi `!isScrubbing`):**
  - Guard theo **`!isScrubbing`** (chặn cả pointer scrub lẫn gesture `ZONE.SEEK` — nếu chỉ chặn `!isPointerScrub`, hover sẽ paint đè `--preview` và chữ giờ lên gesture scrub đang chạy).
  - Tính `ratio = ratioFromPointer(event.clientX, rect)`, `hoverTime = ratio * total`.
  - Cập nhật `root.classList.add('is-hovering')` và `updatePreview(hoverTime, ratio)` (di chuyển `--preview`, cập nhật chữ giờ + chapter).
  - **Tuyệt đối không gọi `seek()`** lúc hover để không phá vị trí đang phát và buffer hiện tại.
- **Scrubbing (cả kéo trực tiếp trên `.seek-area` lẫn cử chỉ `ZONE.SEEK` qua `start()`/`move()`/`end()`):**
  1. **Tạm `pause()` khi bắt đầu scrub (`beginScrub()`):**
     - Lưu `wasPlayingBeforeScrub = !video.paused`.
     - Đặt `isScrubbing = true`, `root.classList.add('is-scrubbing')` (đối xứng với `end()`).
     - Nếu `wasPlayingBeforeScrub`, gọi `video.pause()` để khung hình chính đứng yên sạch sẽ khi tua, không bị phát âm thanh vụn.
  2. **`seeked`-gated preview (`requestPreviewSeek(targetTime)`):**
     - Thay timer mù `120ms` bằng cơ chế khóa theo sự kiện `seeked` (`SEEK_SETTLE_MS = 60`, `SEEK_STALL_MS = 400`).
     - **BẤT BIẾN (bắt buộc): sau MỌI `clearTimeout(previewTimer)` và trong MỌI callback timer (`onSeekStall`, `flushPendingPreview`) phải gán `previewTimer = null`.**
     - Chặn `seeked` mồ côi từ seek trước scrub: lưu `lastDispatchedTime`, trong `onPreviewSeeked()` chỉ nhận khi `isScrubbing && isPreviewSeeking && Math.abs(video.currentTime - lastDispatchedTime) < 0.5` (nếu seek bị player làm tròn ngoài 0.5s, stall timer 400ms vẫn mở khóa an toàn).

     ```js
     const requestPreviewSeek = (t) => {
       if (isPreviewSeeking || previewTimer !== null) {
         pendingPreviewTime = t;
         return;
       }
       dispatchPreviewSeek(t);
     };

     const dispatchPreviewSeek = (t) => {
       isPreviewSeeking = true;
       lastDispatchedTime = t;
       previewTimer = setTimeout(onSeekStall, SEEK_STALL_MS);
       seek(t, false);
     };

     const onPreviewSeeked = () => {
       if (!isScrubbing || !isPreviewSeeking) return;
       if (
         lastDispatchedTime !== null &&
         Math.abs(video.currentTime - lastDispatchedTime) >= 0.5
       ) {
         return;
       }
       clearTimeout(previewTimer);
       previewTimer = null;
       isPreviewSeeking = false;
       if (pendingPreviewTime !== null) {
         previewTimer = setTimeout(flushPendingPreview, SEEK_SETTLE_MS);
       }
     };

     const flushPendingPreview = () => {
       previewTimer = null;
       if (!isScrubbing || pendingPreviewTime === null) return;
       const t = pendingPreviewTime;
       pendingPreviewTime = null;
       dispatchPreviewSeek(t);
     };

     const onSeekStall = () => {
       previewTimer = null;
       isPreviewSeeking = false;
       if (isScrubbing && pendingPreviewTime !== null) {
         flushPendingPreview();
       }
     };
     ```

  3. **Kết thúc scrub (`end()`):**
     - Hủy `previewTimer` (`if (previewTimer !== null) clearTimeout(previewTimer); previewTimer = null;`), reset `isPreviewSeeking = false`, `pendingPreviewTime = null`, `lastDispatchedTime = null`.
     - Đặt `isScrubbing = false`, `root.classList.remove('is-scrubbing')`.
     - Nếu `duration() > 0`: gọi `seek(scrubTime, true)` trước, sau đó nếu `wasPlayingBeforeScrub` thì gọi `video.play().catch(() => {})`, và reset `wasPlayingBeforeScrub = false`.
     - Gọi `paint(scrubTime)`.
     - **Known limitation:** Nếu user chủ động pause giữa lúc đang scrub (bằng phím `k` hoặc media key), `end()` vẫn resume theo `wasPlayingBeforeScrub` đã lưu lúc đầu.
  4. **Dọn dẹp (`destroy()`):**
     - **Nếu `isScrubbing === true` khi `destroy()`** (Esc đóng Nocturne giữa lúc đang kéo, hoặc SPA navigation thay `<video>`): chạy finalize như `end()` trước (`seek(scrubTime, true)` nếu `duration() > 0`, và `video.play().catch(() => {})` nếu `wasPlayingBeforeScrub`) — nếu không video gốc sẽ kẹt paused vĩnh viễn tại vị trí preview dở dang.
     - Sau đó hủy `previewTimer` (`if (previewTimer !== null) clearTimeout(previewTimer); previewTimer = null;`), gỡ listener `seeked` (`onPreviewSeeked`).

---

## 4. Các file dự kiến thay đổi & Inventory tham chiếu cũ

Kết quả grep inventory trên toàn repo (`seek-thumb`, `createThumbnailer`, `fitThumb`, `thumbCanvas`, `thumbSprite`):

- `src/content/controls/seekbar.js`, `src/content/player.css`, `test/unit/seekbar.test.js`
- `_scratch/verify_seek_thumb_e2e.mjs`, `_scratch/probe_seek_thumb.mjs` (script kiểm chứng cũ của thumbnailer)
- `README-edge.md` (dòng 88 mục `Seekbar thumbnails`)

| Action         | File                                                                                                      | Mô tả                                                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Modify         | `src/content/controls/badge.js`                                                                           | Smart auto-hide state machine, trailing throttle, hover/focus guards, lifecycle `hide()`/`show()`                              |
| Verify (no-op) | `src/content/controls/badge.css`                                                                          | Không cần sửa: `transition: opacity 200ms ease` đã có; conceal/reveal dùng inline style. Verify `:focus-visible` khi implement |
| Modify         | `src/content/controls/seekbar.js`                                                                         | Bỏ `createThumbnailer` & `fitThumb`, thêm pause-while-scrubbing + `seeked`-gated preview                                       |
| Modify         | `src/content/player.css`                                                                                  | Xóa style `.seek-thumb*` không còn dùng                                                                                        |
| Modify         | `src/content/pageagent.js`                                                                                | `op === 'seek'`: truyền `true` vào `seekTo` trên YouTube (vì `seekTo(t, false)` không seek `<video>`)                          |
| Modify         | `test/unit/seekbar.test.js`                                                                               | Cập nhật bỏ `fitThumb`, thêm unit test cho `createSeekBar` (hover, scrub pause/resume, `seeked`-gate, `destroy`)               |
| Create         | `test/unit/badge.test.js`                                                                                 | Unit test cho Smart Badge (đủ các case B2, M1, M2, ẩn/hiện theo play/pause/pointer/focus)                                      |
| Modify         | `test/e2e/chapters-spa.mjs`                                                                               | Cập nhật `clickBadge()` đánh thức badge bằng trusted `page.mouse.move()` / `touchscreen.tap()` + chờ `opacity === '1'`         |
| Delete         | `_scratch/verify_seek_thumb_e2e.mjs`, `_scratch/probe_seek_thumb.mjs`, `_scratch/seek_thumb_verified.png` | Script/ảnh verify `.seek-thumb` cũ (sẽ fail sau khi bỏ thumbnailer)                                                            |
| Modify         | `README-edge.md`, `CHANGELOG.md`, `docs/changelogs/`                                                      | Cập nhật tài liệu theo Rule C5/A0                                                                                              |

Không đụng: `src/content/detect.js`, `src/content/page/bridge.js`, `src/content/ui.js` (trừ khi Stage 3 phát hiện bất thường với `handlePlaybackChange` lúc scrub).

---

## 5. Kết quả Probe bắt buộc (Stage 1, trên Edge 156)

Đã chạy trực tiếp trên Microsoft Edge (`channel: 'msedge'`, `{ HOME: '/tmp', XDG_CONFIG_HOME: '/tmp' }`) với `https://www.youtube.com/watch?v=aircAruvnKk`:

1. **YouTube `seekTo` & Pause-while-scrub (`_scratch/probe_yt_rapid_true.mjs` + probe trước đó):** `[EMPIRICAL]`
   - (a)(b)(c) `player.seekTo(t, false)`: **không đổi `video.currentTime`** (kẹt `0.021` / `0.559` kể cả trong vùng buffer `[0, 20s]`), không bắn `seeked`, và tự pause video đang play.
   - `player.seekTo(t, true)` khi `video.paused === true` trong vùng buffer (`4, 9, 14, 7, 2`): bắn `seeked` sau **5–124ms**, giữ nguyên `paused: true`, `sameEl: true`, `emptied: 0`.
   - **V-1 (`|currentTime - requested|`):** Ở tất cả các mốc buffered (`4->4`, `9->9`, `14->14`, `7->7`, `2->2`) và unbuffered (`5->5`, `300->300`, `450->450`), `|currentTime - requested| = 0.00s` (epsilon `0.5s` an toàn, không làm rớt `seeked` về stall-gate). `[EMPIRICAL]`
   - (d) `player.seekTo(t, true)` vào vùng chưa buffer (`200s, 300s, 450s`) khi `paused === true`: cập nhật `currentTime` ngay, `emptied: 0`, `sameEl: true`, `readyState: 1` (chưa có chunk trong headless SABR nên stall timer `400ms` mở khóa chuẩn, không deadlock).
   - (e) Khi gọi `v.pause()` rồi `seekTo(t, true)`, `<video>` giữ nguyên trạng thái `paused: true`, site không tự ý `play()`.
2. **Smart Badge Overlay & Focus (`_scratch/probe_badge_overlay.mjs`):** `[EMPIRICAL]`
   - (a) `document.addEventListener('pointermove', ..., { passive: true, capture: true })` nhận đầy đủ `pointerType: 'mouse'` và tọa độ xuyên qua các lớp overlay của YouTube (`lastMove: { pointerType: 'mouse', x: 820, y: 314, targetTag: 'VIDEO' }`).
   - (b) Khi badge đặt `opacity: 0; pointer-events: none`, `page.mouse.click` tại tâm badge không mở Nocturne (`stageOpened: false`), đi thẳng xuống video bên dưới.
   - (c) Button trong closed Shadow DOM host có `opacity: 0; pointer-events: none` vẫn nhận `focus()` và bắn `focusin: true` (`activeIsHost: true`).

---

## 6. Kiểm thử & Nghiệm thu (Stage 4)

- **Unit tests bắt buộc (`npm test`):**
  - `test/unit/badge.test.js`:
    1. Hiện khi video `paused`; tự ẩn sau `IDLE_HIDE_MS` khi video `playing`.
    2. `hide()` $\to$ `show()` lại phải re-append `shell.host` (`isConnected === true`) và re-attach listener `document`/`window`/`button` `[B2, A2-1]`.
    3. Idle expire KHÔNG ẩn khi `isPointerOnBadge` hoặc `isFocused` `[M2]`.
    4. Chuột dừng hẳn trong rect đúng cửa sổ throttle vẫn reveal nhờ trailing edge `[M1]`.
    5. `conceal()` reset `isPointerOnBadge` và mirror `dataset.revealed = 'false'` `[M2, A2-2]`.
    6. Đổi `target` qua `show(video2)` gỡ listener khỏi `video1` và gắn sang `video2`.
  - `test/unit/seekbar.test.js`:
    1. Hover (`!isScrubbing`) chỉ cập nhật `--preview` + text, không gọi `seek()`.
    2. Hover bị chặn hoàn toàn khi `isScrubbing === true` từ gesture `start()` `[B3]`.
    3. Scrub (cả `handleTrackDown`/`Move`/`Up` và gesture `start`/`move`/`end`) tạm `video.pause()` và gọi `video.play()` lại lúc `end()` nếu trước đó đang play.
    4. Chuỗi 2+ lần scrub liên tiếp — `previewTimer = null` sau settle, preview không bị đóng băng `[B1]`.
    5. `flushPendingPreview` reset `pendingPreviewTime` và `previewTimer` về `null`; `seeked` khi `!isScrubbing` (hoặc lệch >0.5s) không làm kẹt gate.
    6. `destroy()` clear `previewTimer`, gỡ listener `seeked`; nếu `isScrubbing === true` lúc `destroy()`, tự chốt `seek(scrubTime, true)` và gọi `video.play()` lại đúng 1 lần nếu `wasPlayingBeforeScrub` `[A2-4]`.
- **E2E (`npm run test:e2e` + script kiểm chứng mới trong `_scratch/`):**
  - `clickBadge()` dùng trusted `page.mouse.move(x, y)` vào tâm video (hoặc `touchscreen.tap` ở chế độ mobile), chờ test-hook `dataset.revealed === 'true'` trên `[data-nocturne]` rồi mới click `[M3, A2-2]`.

  ```js
  const r = await page.evaluate(() => {
    const b = document.querySelector('video').getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.mouse.move(r.x, r.y);
  await page.waitForFunction(
    () =>
      document.querySelector('[data-nocturne]')?.dataset.revealed === 'true',
    { timeout: 2000 },
  );
  await page.click('[data-nocturne]');
  ```

  - Verify: badge cuộn ra khỏi viewport (`hide`) rồi cuộn lại (`show`) vẫn reveal khi di chuột `[B2]`; click xuyên qua badge đã ẩn chạm video bên dưới; khi scrub `document.querySelectorAll('video').length` không tăng và không còn `.seek-thumb` trong DOM.

- **Build & Lint:** `npm run build`, `npm run lint` (ESLint + Prettier + Privacy check).

---

## 7. Ngoài phạm vi (Tách riêng nếu làm sau)

- Keyboard shortcuts cho Edge Desktop (`Space`, `←`/`→`, `↑`/`↓`, `M`, `F`, `C`, `Esc`).
- Cử chỉ dọc trái/phải (tùy chọn — xem plan riêng `docs/plans/2026-11-16-gesture-vertical-brightness-volume.md`): trái = độ sáng khung hình (`layers.dim` passthrough ở đáy = AUTO), phải = volume/mute.
- Nút `"Open Nocturne Player"` trong `popup.html` & nối `doubleTapSeconds` / `holdSpeed` từ `settings.js` vào `ui.js`.
