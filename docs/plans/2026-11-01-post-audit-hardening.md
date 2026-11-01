# Plan: Post-audit hardening (P1–P4 của dev agent, sau audit 1 + audit 2)

**Date:** 2026-11-01  
**Status:** Completed (Stage 5)  
**Base commit:** `c0aec1e`

---

## 1. Kết quả audit (đối chiếu code thật)

| ID  | Claim của dev                               | Verdict audit 2                                                                                                                                                                                                                                                                                                                                                                                                     | Nhãn                                             |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| P1  | `rid` tuần tự → thêm prefix ngẫu nhiên      | Đồng ý audit 1: **bỏ**. `nocturne:req` có `bubbles: true` nên page script đọc được `rid` thật rồi spoof; fix không tạo ranh giới bảo mật. Response chỉ là DTO, không thực thi code ở ISOLATED.                                                                                                                                                                                                                      | `[DESIGN CHOICE]` ghi nhận residual risk         |
| P2  | Chapters không refresh khi autoplay/next    | **Đúng, nhưng fix của dev/audit 1 chưa đủ** (xem 2.1).                                                                                                                                                                                                                                                                                                                                                              | `[UNVERIFIED]` trên YouTube thật, code-read khớp |
| P3  | Layout thrashing do `getBoundingClientRect` | **Đúng một nửa.** Cache rect hợp lý nhưng lợi ích chưa đo; rAF cho canvas không cần (đã throttle 120ms).                                                                                                                                                                                                                                                                                                            | `[UNVERIFIED]` lợi ích                           |
| P4  | `closest()` fail trên `m.youtube.com`       | **Bác bỏ.** Probe Edge (Pixel 7 emulation, `m.youtube.com/watch`): `#movie_player` **có** (`.html5-video-player` cũng có), nên chuỗi `closest ?? #movie_player` vẫn tìm được. Ngoài ra `.ytp-progress-bar` = 0 trên mobile → nhánh sprite no-op sẵn, rơi xuống canvas tier. Thêm nữa chuỗi còn fallback `?? document`. Đề xuất `anchor.closest()` còn **ném TypeError** (anchor là Comment node, `session.js:294`). | `[EMPIRICAL]`                                    |

Chỉ P2 và (tuỳ chọn) P3 đáng làm. P1, P4: không làm.

---

## 2. Thiết kế

### 2.1. P2 — Làm mới chapters khi `<video>` đổi nguồn (`src/content/ui.js`, có thể `src/content/page/chapters.main.js`)

Hiện trạng: `chapterTimers` (`CHAPTER_TRIES_MS`) chỉ arm 1 lần trong `createOverlay`; `session.show` chỉ chạy ở `enter`/`step`.

Vấn đề audit 1 bỏ sót — chỉ thêm listener `loadedmetadata` là **chưa đủ**:

1. **Chapters cũ không bị xoá.** Callback chỉ gọi `seekBar.setChapters(...)` khi `length > 0`. Video mới không có chapter → vạch/tiêu đề chapter của bài trước vẫn vẽ trên duration mới. Phải `setChapters([])` khi nguồn đổi.
2. **Fallback stale.** `readSiteChapters` thử `getPlayerResponse` → `ytInitialData` → `ytInitialPlayerResponse`. Hai global sau chỉ phản ánh trang **load đầu tiên** (không cập nhật khi SPA nav/autoplay). Với video mới không có chapter, `tidy()` trả `[]` rồi rơi xuống global stale → re-scan sẽ **gắn lại chapters của video cũ**. Cần chặn.
3. Race: `loadedmetadata` có thể bắn trước khi `getPlayerResponse` cập nhật → giữ cơ chế retry nhiều nhịp.

Thiết kế đề xuất:

- Trong `ui.js` gom thành `scanChapters()` + `armChapterScan()` (clear timers cũ, arm lại `CHAPTER_TRIES_MS`).
- Gọi `armChapterScan()` lúc tạo overlay (giữ hành vi cũ) và trên `video` event `emptied`/`loadstart` (đổi nguồn) kèm `seekBar.setChapters([])`; hoặc `loadedmetadata` theo pattern `introwatch.js:155`. Gỡ listener + clear timers trong `destroy`.
- Chặn stale: **chọn một** sau probe (mục 4):
  - (a) thêm field `strict: true` cho op `chapters.list` khi re-scan → `readSiteChapters` chỉ dùng `getPlayerResponse`;
  - (b) so videoId của blob global với `getVideoData().video_id`;
  - (c) sanity check: bỏ danh sách nếu `last.start >= video.duration`.
- Không `await` mới (C2); `chaptersList` giữ đồng bộ.

### 2.2. P3 — Cache rect khi scrub (`src/content/controls/seekbar.js`) — TUỲ CHỌN

- Chỉ cache `track.getBoundingClientRect()` lúc `pointerdown`, dùng trong `handleTrackMove` nhánh `isPointerScrub`, xoá khi `end()`. Đồng thời `barCenter()` ở `move()` (đường gesture/swipe) — dev bỏ sót — cũng đọc rect mỗi move.
- **Không** cache cho nhánh hover (không có sự kiện reset đáng tin nếu layout đổi) và **không** thêm rAF.
- Điều kiện làm: probe đo trước (2.3). Chromium căn `pointermove` theo frame (≤1/frame) và forced layout chỉ kéo layout lên sớm trong cùng frame; nếu không đo được cải thiện → bỏ P3 (A4/C8: không tối ưu mù).

### 2.3. Bảng nhãn cho báo cáo dev (A9)

Các mục "SoTA" trong báo cáo dev là đánh giá chủ quan `[DESIGN CHOICE]`; chỉ "đồng bộ, <0.1ms" mới là `[EMPIRICAL]` và cần số đo đi kèm.

---

## 3. File dự kiến thay đổi

| File                                                                                            | Thay đổi                                                                     |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `src/content/ui.js`                                                                             | `scanChapters`/`armChapterScan`, listener đổi nguồn, cleanup trong `destroy` |
| `src/content/page/chapters.main.js` + `src/content/page/bridge.js` + `src/content/pageagent.js` | Chỉ nếu chọn hướng (a) `strict`                                              |
| `src/content/controls/seekbar.js`                                                               | Chỉ P3 nếu probe cho thấy có lợi                                             |
| `test/unit/*.test.js`                                                                           | Test mới (viết trước)                                                        |
| `PORT_PLAN.md`, `README-edge.md`, `CHANGELOG.md`, `docs/changelogs/`                            | C5                                                                           |

Không đụng: `bridge.js` rid (P1), `seekbar.js` sprite scope (P4).

---

## 4. Probe bắt buộc trước khi code (C3/C10, đặt trong `_scratch/`)

1. **P2 trên Edge thật:** bật Nocturne trên YouTube playlist, để autoplay/Next → xác nhận (i) overlay còn sống, (ii) `<video>` giữ nguyên element hay bị thay, (iii) `src` đổi bằng sự kiện nào (`emptied`/`loadstart`/`loadedmetadata`), (iv) `getPlayerResponse()` trả đúng video mới ở thời điểm nào, (v) `ytInitialData` có stale không, và videoId ở đâu để so.
2. **P2 fixture:** stub `#movie_player.getPlayerResponse` + đổi `video.src` để test tái lập không phụ thuộc mạng.
3. **P3:** đo bằng `performance` trace/`PerformanceObserver` (long task, layout count) khi scrub trên fixture, trước/sau.

## 5. Test (viết trước, đỏ → xanh)

- Unit: re-scan khi đổi nguồn; chapters bị xoá khi video mới rỗng; **không** re-apply chapters stale; timers được clear khi `destroy`.
- (P3 nếu làm) test đếm số lần `getBoundingClientRect` trên track trong 1 lần scrub = 1.
- `npm run build`, `npm test` (hiện 88/88), `npm run lint`, Playwright Edge theo C10.

## 6. Ngoài phạm vi

P1 (rid prefix), P4 (đổi scope sprite), rAF cho thumbnail.
