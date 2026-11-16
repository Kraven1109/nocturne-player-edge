# Plan / Ticket: Vertical Edge Gestures (Left Dim / AUTO & Right Volume)

**Date:** 2026-11-16  
**Status:** Stage 2 Gate Complete — Patches G1–G5 & §5 Edge Probes Done, Ready for Stage 3 Approval (0 Production Code Touched)  
**Prerequisite:** Batch 1 committed (`2436bc9`, `docs/plans/2026-11-16-smart-badge-and-direct-video-scrub.md`)

---

## 1. Mục tiêu & Giới hạn nền tảng (Trung thực kỹ thuật)

Cho phép người dùng **tùy chọn bật** (mặc định `OFF`) cử chỉ kéo dọc ở hai bên khung hình khi mở Nocturne Player:

- **Nửa phải (kéo lên/xuống):** Tăng / giảm âm lượng (`video.volume` `0..1`, tại `0` đặt `video.muted = true`), có HUD `%` và icon mute.
- **Nửa trái (kéo lên/xuống):** Tăng / giảm độ sáng **khung hình video bằng lớp phủ Dim** (không phải đèn nền phần cứng):
  - **Giới hạn Web/Extension API:** Trình duyệt và MV3 extension **không có quyền** chỉnh đèn nền (backlight) hệ thống hay đọc cảm biến ánh sáng mặc định (`AmbientLightSensor`).
  - **Cơ chế áp dụng:** Tận dụng chính phần tử **`layers.dim`** đã có sẵn trong [`session.js`](file:///DATA1/quang_dev/nocturne-player-edge/src/content/session.js#L446) & [`player.css`](file:///DATA1/quang_dev/nocturne-player-edge/src/content/player.css#L42-L46) (`div.layer.dim`, nền `#000`, đặt giữa `<video>` và toàn bộ controls/HUD trong Shadow DOM — `ui.shadow.append(layers.warm, layers.dim, loader)`).
  - **[EMPIRICAL — Patch G5c]:** `grep -rn "\.dim\b" src/` chỉ trả về đúng 2 vị trí (`src/content/player.css:42` và `src/content/session.js:446`); `layers.dim` hiện chưa được sử dụng bởi module nào khác nên không có xung đột sở hữu. (Lưu ý `player.css:45` hiện đặt `transition: opacity 200ms ease;` — sẽ kiểm tra ở Probe §5.2 và tắt transition khi đang kéo tích cực nếu cần.)
    - `AUTO` = `layers.dim.style.opacity = '0'` (gỡ lớp làm tối, độ sáng hoàn toàn theo hệ thống).
    - `10%..99%` = `opacity = clamp(1 - level, 0.01, 0.90)` (không bao giờ kéo xuống `1.0` đen kịt mất đường nhìn).
    - Tách biệt hoàn toàn với `settings.brightness` (`filter: brightness()`) trong `colorpanel.js` & `visuals.js`, tránh ảnh hưởng tới video DRM/hardware overlay và không làm tối controls/HUD. Đặt tên HUD & tài liệu là **Dim** (thay vì Brightness) để không gây nhầm lẫn với bộ lọc màu; nếu user chỉnh thêm `Brightness` trong Color Panel thì hai hiệu ứng cộng dồn trực tiếp (sẽ ghi rõ trong `README-edge.md`).
  - **Kéo xuống dưới cùng = `AUTO` theo system:** Khi ngón tay/chuột kéo vượt ngưỡng đáy (`AUTO_HYSTERESIS`), thoát chế độ dim về `opacity: 0` (hiển thị HUD `Dim: AUTO ☀` rõ ràng để phân biệt với mức tối nhất `10%`).

---

## 2. Tích hợp vào hệ thống Gesture sẵn có (`recognizer.js`, `zones.js`, `ui.js`)

Đối chiếu code thật của [`recognizer.js`](file:///DATA1/quang_dev/nocturne-player-edge/src/content/gestures/recognizer.js#L160-L204) và [`zones.js`](file:///DATA1/quang_dev/nocturne-player-edge/src/content/gestures/zones.js#L1-L36):

### 2.1. Phân xử xung đột với các gesture hiện tại

Hiện tại trong `recognizer.js`:

1. `handleMove` khi `mode === MODE.PENDING`:
   - Kiểm tra `Math.hypot(dx, dy) < MOVE_TOLERANCE_PX` (`12px`).
   - Vượt `12px` $\to$ `clearHoldTimer()` (tự động hủy hold-to-2x và không `registerTap`).
   - Dòng `180`: `if (isVerticalMove(dx, dy) && canSwipe()) { mode = MODE.SWIPE; return; }`
2. **Xung đột cần chốt rõ:**
   - **Feed dọc (`canSwipe() === true`, ví dụ Shorts/Reels/TikTok):** Ưu tiên `MODE.SWIPE` (chuyển video tiếp/trước) — **không** kích hoạt kéo sáng/volume để giữ nguyên hành vi lướt feed.
   - **Video thường (`!canSwipe()`) + `isVerticalDragEnabled === true`:**
     - Khi vượt `MOVE_TOLERANCE_PX` và `isVerticalMove(dx, dy)` (`|dy| > |dx|`):
       - Nếu `anchor.zone === ZONE.HOLD_LEFT` (cạnh trái `0..40%`, `y` từ `10%..72%`) $\to$ khóa trục dọc vào `ZONE.DRAG_LEFT` (hoặc phát `dragStart`/`dragMove`/`dragEnd` với `axis: 'vertical'`, `side: 'left'`).
       - Nếu `anchor.zone === ZONE.HOLD_RIGHT` (cạnh phải `60%..100%`, `y` từ `10%..72%`) $\to$ khóa trục dọc vào `ZONE.DRAG_RIGHT` (`side: 'right'`).
       - Vùng `ZONE.DEAD` (dải giữa `40%..60%`) và `ZONE.SEEK` (`72%..88%`) **không** nhận kéo sáng/volume.
       - Nếu kéo ngang (`!isVerticalMove(dx, dy)`) trên `HOLD_LEFT`/`HOLD_RIGHT`: rơi vào `MODE.ABANDONED` như cũ (chỉ `ZONE.SEEK` mới drag ngang).
   - **Đa chạm (Pinch):** Khi có ngón thứ 2 (`pointers.size === 2`), `startPinch()` ở `recognizer.js:116` đã tự phát `dragEnd` và chuyển sang `MODE.PINCH` — tự động an toàn.
   - **Ngắt pointer bất ngờ (`pointercancel` / `lostpointercapture`) — [Patch G3]:** `recognizer.js` hiện có `handleCancel` cho `pointercancel` nhưng chưa lắng nghe `lostpointercapture`. Cần bổ sung lắng nghe cả `pointercancel` và `lostpointercapture` trên stage để khi bị trình duyệt/OS cướp pointer giữa chừng trong lúc `MODE.DRAG_VERTICAL`, recognizer luôn phát `dragEnd` sạch (chốt nguyên giá trị Dim/Volume hiện tại, **không** revert, và tắt HUD toast theo chu kỳ `TOAST_MS = 900`).

### 2.2. Toán học & Cảm giác kéo — [Patch G1, G2, G4]

- **Mô hình tính từ điểm neo (anchor-based cumulative math, tránh trôi cộng dồn frame-delta — Patch G2):**
  - Độ nhạy: kéo quãng `0.75 * h` (75% chiều cao stage) đi hết dải `0..1`.
  - Lúc `dragStart`: snapshot `dragBase` từ trạng thái hiện tại (`dimBrightness ?? 1.0` cho bên trái; `video.muted ? 0 : video.volume` cho bên phải).
  - Trong suốt `dragMove`: nhận **tổng dịch chuyển `dy` tính từ anchor ban đầu** (`dy < 0` khi kéo lên, `dy > 0` khi kéo xuống) và tính giá trị thô **không clamp**:
    `raw = dragBase - dy / (h * 0.75)`
  - **Chỉ clamp khi áp dụng** lên DOM/audio (`clamp` chỉ ở bước output, **không** clamp `raw`), để người dùng kéo quá đỉnh/đáy rồi đảo chiều vẫn phản hồi đối xứng đúng quãng tay.
- **Dim (trái):**
  - Giá trị nội bộ của session: `dimBrightness` (`null` = `AUTO`, hoặc số `0.10..0.99`). Khởi tạo mỗi session = `null` (`AUTO`) để không bao giờ kẹt màn hình tối sang video/phiên sau.
  - **Hysteresis 2 chiều quanh ngưỡng `AUTO`:**
    - Dải hoạt động Dim: `[0.10, 1.00)`. Nếu `raw >= 1.0` $\to$ `dimBrightness = null` (`AUTO ☀`, `layers.dim.style.opacity = '0'`).
    - Khi đang ở chế độ Dim (`dimBrightness !== null`) và kéo xuống dưới đáy (`0.10`): chỉ chuyển sang `AUTO` khi vượt hysteresis đáy (`AUTO_HYSTERESIS_PX = 24`):
      - Điều kiện **vào `AUTO`**: `(raw < 0.10 && (0.10 - raw) * h * 0.75 >= 24) || raw < 0.05` $\to$ `dimBrightness = null` (`AUTO ☀`, `opacity = '0'`).
    - Khi đang ở `AUTO` (do mới vào từ đáy trong **cùng cú kéo**) và kéo ngược lên: giữ `AUTO` cho tới khi qua ngưỡng thoát:
      - Điều kiện **thoát `AUTO`**: `raw >= 0.10 + 24 / (h * 0.75)` (xấp xỉ `0.14` tại `h = 800`) mới quay lại mức Dim tương ứng `clamp(raw, 0.10, 0.99)`.
    - Nếu bắt đầu một cú kéo **mới** từ `AUTO` (`dragBase = 1.0`): kéo lên (`raw >= 1.0`) giữ `AUTO ☀`; kéo xuống (`raw < 1.0`) giảm mượt `99% -> 10%`, kéo quá đáy lại vào `AUTO ☀`.
  - **Không persist** `dimBrightness` vào `storage` (chỉ có hiệu lực trong phiên xem hiện tại; reset về `null` / `AUTO` khi thoát stage hoặc đóng phiên).
- **Volume (phải):**
  - Snapshot `dragBase = video.muted ? 0 : video.volume` ở `dragStart`.
  - Khi kéo: `raw = dragBase - dy / (h * 0.75)`, áp `next = clamp(raw, 0, 1)`.
  - Áp lên `<video>`: `video.volume = next; video.muted = next === 0;`.
  - **[EMPIRICAL — Patch G1]:** Đã xác nhận tại [`src/content/session.js:79-96`](file:///DATA1/quang_dev/nocturne-player-edge/src/content/session.js#L79-L96) rằng `captureVideoState` lưu `volume: video.volume, isMuted: video.muted` và `restoreVideoState` (`session.js:94-95`) **có khôi phục** `video.volume = state.volume; video.muted = state.isMuted;` khi `exit()`. Vì vậy **bắt buộc** sửa `session.js`: khi user kết thúc kéo volume bên phải (`dragEnd`), cập nhật lại `state.volume = video.volume; state.isMuted = video.muted;` (qua callback `onVolumeCommit` từ `ui.js` $\to$ `session.js`) để `exit()` không rollback âm lượng mà user vừa chỉnh.
  - **[EMPIRICAL — Patch G4 Confirmed]:** Probe §5.1 trên YouTube (`aircAruvnKk`) cho thấy set trực tiếp `video.volume` / `video.muted` bắn `volumechange` và không bị YouTube ghi đè ngược, **nhưng** `#movie_player.getVolume()` / `.ytp-volume-panel[aria-valuenow]` vẫn kẹt ở `100` / `isMuted: false`. Ngược lại gọi `#movie_player.setVolume(35)` đồng bộ cả `<video>` lẫn UI/store của YouTube (`videoVol: 0.35`, `ytVol: 35`, `ytBarAria: "35"`). Vì vậy **bổ sung** `op === 'setVolume'` trong `src/content/pageagent.js` (`setVolume` + `mute`/`unMute`, gọi ở `dragEnd` trong khi `dragMove` vẫn update trực tiếp `video.volume` tức thời 60fps).

---

## 3. Tùy chọn người dùng (Settings & UI) — [Patch G5]

- Trong [`src/lib/settings.js`](file:///DATA1/quang_dev/nocturne-player-edge/src/lib/settings.js):
  - Thêm key vào `DEFAULTS`: `isVerticalGesturesOn: false` (default `OFF`, `normalize()` tự nhận key mới mà không cần phá schema v2).
- Nơi bật/tắt cho user (v1 — **chỉ đặt trong Settings menu**, không sửa `popup.html`):
  - Thêm switch **"Vertical swipe (Dim / Volume)"** trong **Settings menu** ([`src/content/controls/menu.js`](file:///DATA1/quang_dev/nocturne-player-edge/src/content/controls/menu.js), lưu qua `onPersist({ isVerticalGesturesOn })`).
  - Trong `ui.js`, truyền `canVerticalDrag: () => isVerticalGesturesOn` vào `createRecognizer` (cập nhật động ngay khi gạt switch).
- HUD hiển thị khi kéo:
  - Dùng lại `.toast` (`showToast(...)` ở `ui.js:229`, duration `null` trong lúc kéo, tự ẩn sau `TOAST_MS = 900` khi `dragEnd`):
    - Trái: `Dim: AUTO ☀` (khi `null`) hoặc `Dim: 65%`
    - Phải: `Muted` (khi `0`) hoặc `Volume: 72%`

---

## 4. File dự kiến thay đổi

| Action | File                                                                                                                 | Mô tả                                                                                                                                                |
| ------ | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modify | `src/lib/settings.js`                                                                                                | Thêm `isVerticalGesturesOn: false` vào `DEFAULTS`                                                                                                    |
| Modify | `src/content/gestures/zones.js`                                                                                      | Giữ/xác nhận phân vùng `HOLD_LEFT` / `HOLD_RIGHT` cho vertical drag                                                                                  |
| Modify | `src/content/gestures/recognizer.js`                                                                                 | Vertical drag ở `HOLD_LEFT`/`HOLD_RIGHT` khi `!canSwipe() && canVerticalDrag()`, phát anchor `dy`, lắng nghe `lostpointercapture` (G3)               |
| Modify | `src/content/controls/menu.js`                                                                                       | Thêm toggle `"Vertical swipe (Dim / Volume)"` (v1 chỉ trong menu, default OFF)                                                                       |
| Modify | `src/content/ui.js`                                                                                                  | Toán anchor `raw` + 2-way `AUTO` hysteresis, `layers.dim`, `video.volume`/`muted`, HUD `Dim:` / `Volume:`, gọi `onVolumeCommit` + bridge ở `dragEnd` |
| Modify | `src/content/session.js`                                                                                             | Cập nhật `savedState.volume` / `savedState.isMuted` khi nhận `onVolumeCommit` để `restoreVideoState` không revert volume khi `exit()` (G1)           |
| Modify | `src/content/pageagent.js`                                                                                           | Thêm `op: 'setVolume'` (`player.setVolume` + `mute`/`unMute`) để sync UI & volume store của YouTube ở `dragEnd` (G4 đã xác nhận cần thiết)           |
| Modify | `src/content/player.css`                                                                                             | Tắt `transition` của `.dim` khi đang kéo (`.dim.is-dragging { transition: none; }`) để tránh lag 200ms theo kết quả Probe §5.2                       |
| Modify | `test/unit/recognizer.test.js`, `test/unit/settings.test.js`, `test/unit/session.test.js` (hoặc unit test `ui`/math) | Unit test direction-lock, `lostpointercapture`/`pointercancel` (G3), `canSwipe()`, anchor math + 2-way hysteresis (G2), `restoreVideoState` (G1)     |
| Modify | `README-edge.md`, `CHANGELOG.md`, `docs/changelogs/`                                                                 | Cập nhật tài liệu, giải thích cơ chế **Dim** (không phải backlight) và cộng dồn với Color Panel Brightness (C5, G5)                                  |

---

## 5. Kết quả Probe thực nghiệm trước Stage 3 (C3/C10 — Edge `msedge`)

Chạy thực tế trên Edge (`channel: 'msedge'`, `1280x800`, live `https://www.youtube.com/watch?v=aircAruvnKk` + `dist/` qua `_scratch/probe_gesture_prereqs.mjs`):

1. **[EMPIRICAL] YouTube `volumechange` sync (G4 gate):**
   - Khởi đầu: `videoVol: 1, videoMuted: false, ytVol: 100, ytMuted: false, ytBarAria: "100"`.
   - Set trực tiếp `video.volume = 0.35`, `0 / muted: true`, `0.72 / muted: false`: event `volumechange` bắn đủ (5 events) và YouTube không ghi đè lại `<video>`, **nhưng** `#movie_player` và thanh slider `.ytp-volume-panel` vẫn đứng im tại `ytVol: 100, ytMuted: false, ytBarAria: "100"`.
   - Gọi `#movie_player.setVolume(35)`: cập nhật đồng bộ cả hai (`videoVol: 0.35, ytVol: 35, ytBarAria: "35"`).
   - $\Rightarrow$ **Chốt kiến trúc (G4):** Dùng `video.volume` / `video.muted` trong `dragMove` để phản hồi mượt tức thời, và gọi bridge `setVolume` trong `pageagent.js` tại `dragEnd` (ngoài `onVolumeCommit` của `session.js`) để sync UI/player của YouTube.
2. **[EMPIRICAL] `layers.dim`, stack Shadow DOM & `requestVideoFrameCallback`:**
   - Thứ tự lớp ShadowRoot (`[data-nocturne-player] > [data-nocturne]`): `style` $\to$ `div.layer.warm` $\to$ `div.layer.dim` $\to$ `div.feed-loader` $\to$ `div.layer.surface` (`touchAction: "none"`) $\to$ `skip-feedback` $\to$ `cue` $\to$ `chrome` $\to$ `intro-skip` $\to$ `toast`.
   - Thuộc tính computed ban đầu của `.dim`: `bg: "rgb(0, 0, 0)"`, `opacity: "0"`, **`transition: "opacity 0.2s"`**, `pointerEvents: "none"`.
   - Khi thay đổi liên tục `.dim.style.opacity` (`0..0.7`) trong `450ms` khi video đang phát: `requestVideoFrameCallback` vẫn tiến bình thường (`14` khung hình / `450ms` ~30fps, `videoPaused: false`), `.chrome` / `.toast` không bị dim ảnh hưởng.
   - $\Rightarrow$ **Tinh chỉnh Stage 3:** Thêm class `.dim.is-dragging { transition: none; }` khi kéo để bỏ độ trễ `200ms` lúc tay đang vuốt, giữ `transition: opacity 0.2s` khi mở/đóng/về `AUTO`.
3. **[EMPIRICAL] Gesture surface & Pointer Interruption (G3):**
   - Bề mặt nhận pointer của Nocturne là `div.layer.surface` với `touch-action: none`.
   - Trên Edge Chromium, gọi `setPointerCapture(id)` bằng `PointerEvent` giả lập ném `NotFoundError: No active pointer with the given id is found` (chỉ hoạt động với active pointer thật hoặc mock trong unit test).
   - Lắng nghe `lostpointercapture` và `pointercancel` trên `div.layer.surface` nhận đủ cả hai event (`seen: ["lost:1", "cancel:1"]`), xác nhận kế hoạch bắt cả `pointercancel` + `lostpointercapture` trong `recognizer.js` để phát `dragEnd` sạch.

---

## 6. Kiểm thử & Nghiệm thu (Stage 4)

- **Unit (`npm test`):**
  - `recognizer.test.js`: vertical drag trái/phải chỉ phát khi `!canSwipe() && canVerticalDrag()`; horizontal trên `HOLD_LEFT` vẫn bị bỏ qua (`ABANDONED`); pinch 2 ngón kết thúc vertical drag gọn; **`pointercancel` & `lostpointercapture` phát `dragEnd` không revert (G3)**.
  - `settings.test.js`: `isVerticalGesturesOn` mặc định `false`, chấp nhận boolean hợp lệ.
  - Anchor-based math + **2-way `AUTO` hysteresis** (kéo từ `AUTO` lên giữ `AUTO`, kéo xuống qua `0.10` + `24px` vào `AUTO`, kéo ngược lên qua `~0.14` mới thoát `AUTO`) & volume clamp `[0, 1]` (**G2**).
  - **`session.js` `restoreVideoState` (G1):** Xác nhận khi user chỉnh volume trong stage rồi `exit()`, volume mới **không bị revert** về volume lúc vào stage.
- **E2E Edge (tại viewport `h = 800`, dải `0.75 * h = 600px` — G2):**
  - Mặc định OFF không đổi hành vi cũ.
  - Bật switch trong Settings menu (`menu.js`) $\to$ kéo trái xuống `dy = +300px` từ `AUTO`: `Dim: 50%`, `layers.dim.style.opacity === '0.5'`; kéo tiếp xuống `dy = +580px` (`raw ≈ 0.033 < 0.05`): bật `Dim: AUTO ☀`, `layers.dim.style.opacity === '0'`.
  - Kéo phải lên/xuống đổi `video.volume` & `muted`, HUD `Volume: 72%` / `Muted`; thoát stage vẫn giữ volume mới.
  - `npm run build`, `npm run lint` sạch.
