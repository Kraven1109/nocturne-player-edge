# Plan: Public Release Readiness, Naming Convention, Icon Design & Community Setup

**Date:** 2026-11-16  
**Status:** Complete — Options Approved (N1, `0.10.0`, Eclipse Halo I1) & Stage 3–4 Verified  
**Prerequisite:** Stage 5 committed & pushed (`5fd2e0d`)

---

## 1. Hiện trạng & Vấn đề phát hiện khi rà soát repo (`[EMPIRICAL]`)

1. **GitHub CI/Release hiện bị gãy cho bản MV3:**
   - Chạy thử `npx web-ext lint -s dist` trên bản build MV3 hiện tại trả về `exit code 1` với `ADDON_ID_REQUIRED` + cảnh báo `MISSING_DATA_COLLECTION_PERMISSIONS` vì [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml#L45) và [`release.yml`](../../.github/workflows/release.yml#L25) vẫn chạy cấu hình Firefox AMO của upstream.
2. **Liên kết upstream cũ & sai chủ sở hữu ở nhiều file người dùng nhìn thấy:**
   - [`src/popup/popup.html`](../../src/popup/popup.html#L35): nút `"Source code"` trỏ về `https://github.com/pohoriletts/nocturne-player`.
   - [`src/manifest.mv3.json`](../../src/manifest.mv3.json#L3-L8): `"name": "Nocturne Player"`, `"version": "0.9.1"`, `"author": "Vlad Pohorilets"`, `"homepage_url": "https://github.com/kvachikk/nocturne-player"`.
   - [`package.json`](../../package.json#L8-L15): `repository`, `homepage`, `bugs` đều trỏ sang `kvachikk/nocturne-player`.
   - [`PRIVACY.md`](../../PRIVACY.md#L34-L80): còn nhắc `"Mozilla account"`, `"about:debugging"`, `"src/manifest.json"`, và contact `kvachikk/nocturne-player/issues`.
   - [`README.md`](../../README.md): còn là bản Firefox Android (badges upstream, `addons.mozilla.org`, ghi hạn chế `Volume stays on the phone's buttons` dù bản Edge đã hỗ trợ kéo volume).
   - [`CONTRIBUTING.md`](../../CONTRIBUTING.md#L46-L51): còn hướng dẫn `adb reverse` / `npm run start:android` thay vì Playwright Edge & `npm run test:e2e`.
   - [`.github/ISSUE_TEMPLATE/config.yml`](../../.github/ISSUE_TEMPLATE/config.yml#L4): trỏ security advisories về repo upstream.
3. **Tuân thủ MPL-2.0 (`LICENSE`):**
   - Giữ nguyên [`LICENSE`](../../LICENSE) (`MPL-2.0`), ghi rõ attribution nguồn gốc (`Vlad Pohorilets / kvachikk/nocturne-player v0.9.1, commit 0de5804`), công khai mọi file đã sửa dưới MPL-2.0, và thêm [`NOTICE`](../../NOTICE) hoặc mục Attribution minh bạch.

---

## 2. Đề xuất Naming Convention (Chốt tại Stage 2 Gate)

### 2.1. Tên Extension & Versioning (Edge Store + Public Brand)

| Hạng mục                                           | Phương án đề xuất                                                     | Ghi chú                                                                                                                                                                                                             |
| -------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Option N1 _(Khuyến nghị)_**                      | **`Nocturne Player for Edge`** _(hoặc `Nocturne Player (Edge Port)`)_ | Giữ nhận diện Nocturne Player cho người tìm kiếm, đồng thời minh bạch là bản port Chromium/Edge cộng đồng (không mạo danh bản Firefox gốc).                                                                         |
| **Option N2**                                      | **`Nocturne Touch Player`**                                           | Trung lập nền tảng nếu sau này muốn đưa chung lên cả Chrome Web Store & Edge Add-ons Store.                                                                                                                         |
| **Version (`manifest.mv3.json` & `package.json`)** | **`0.10.0`** _(hoặc **`0.9.2`**)_                                     | Bắt buộc dùng chuỗi số chuẩn `X.Y.Z` (Edge Store từ chối `-edge` suffix trong `manifest.json`). Đề xuất **`0.10.0`** vì đã vượt bản `0.9.1` gốc với Smart Badge, Direct Scrub, Mobile Chapters & Vertical Gestures. |
| **Popup & `homepage_url`**                         | Trỏ về `https://github.com/Kraven1109/nocturne-player-edge`           | Kèm attribution `Based on nocturne-player by Vlad Pohorilets (MPL-2.0)` trong `README.md`, `NOTICE`, và mô tả Store.                                                                                                |

### 2.2. Quy ước đặt tên kỹ thuật trong codebase (chuẩn hóa cho contributor)

- **DOM & Events:** Tiền tố duy nhất `data-nocturne*` (`data-nocturne`, `data-nocturne-player`), Shadow DOM classes `kebab-case` (`.is-dragging`, `.is-visible`, `.is-open`), Bridge events `nocturne:<noun>` (`nocturne:req`, `nocturne:res`), Bridge ops `<domain>.<verb>` hoặc `<verb>` (`quality.list`, `setVolume`).
- **Settings (`storage.local` key `'nocturne'`):** Boolean keys dùng `is<Feature>On` / `are<Plural><Adj>`; mọi key số phải khai báo biên trong `RANGES` của [`src/lib/settings.js`](../../src/lib/settings.js).
- **Branches & Commits:** Conventional Commits (`commitlint.config.js`, `lower-case`, tối đa 72 ký tự, phạm vi thuộc `scope-enum`), nhánh `feat/<slug>`, `fix/<slug>`, `docs/<slug>`, `ci/<slug>`.

---

## 3. Đề xuất Thiết kế Icon & Pipeline Xuất Ảnh

Hiện [`src/icons/icon.svg`](../../src/icons/icon.svg) là bản gốc (`#2f2757 -> #12101f` squircle, tam giác play `#f4f1ff`, trăng khuyết `#ffc46b` góc trên phải).

### 3.1. Các phương án thiết kế (`src/icons/icon.svg` là SSoT)

- **Option I1 _(Khuyến nghị — Eclipse Halo)_:** Giữ nền đêm tím than sâu (`#1d1740 -> #0c0a17`) + nút play giữa rõ nét tại `16px`, thay trăng khuyết nhỏ ở góc bằng **vầng trăng/nhật thực (`aurora crescent` vàng hổ phách `#ffc46b` kết hợp viền mảnh xanh ngọc Edge `#38bdf8`) bao quanh tâm nút play** — gợi trực tiếp hình ảnh badge tròn nổi trên video của Nocturne và tách biệt rõ với bản Firefox ở cỡ nhỏ trên thanh công cụ Edge.
- **Option I2 _(Crisp Minimal Refresh)_:** Giữ bố cục gốc (play + trăng khuyết góc), nâng tương phản viền sáng cyan/indigo nhẹ, căn lưới pixel chuẩn cho `16x16` & `32x32` để không bị nhòe trên thanh công cụ Edge light/dark mode.

### 3.2. Pipeline tạo asset tự động & tái lập (`tools/render-icons.mjs`)

- Dùng `playwright-core` (Chromium/Edge có sẵn) render `src/icons/icon.svg` thành PNG đúng chuẩn kích thước mà không thêm dependency nặng:
  - `src/icons/icon-16.png` (`16x16`) — toolbar & `manifest.mv3.json` `action.default_icon`
  - `src/icons/icon-32.png` (`32x32`) — toolbar HiDPI
  - `src/icons/icon-48.png` (`48x48`) — Extensions management page
  - `src/icons/icon-128.png` (`128x128`) — Edge Store & install dialog
  - `store/tile-300.png` (`300x300`, tùy chọn cho Microsoft Partner Center promo tile, nằm ngoài `dist/`)

---

## 4. Kế hoạch thực thi dự kiến (Stage 3 — Sau khi được duyệt)

| Scope            | File                                                                                     | Thay đổi dự kiến                                                                                                                                                                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand & Manifest | `src/manifest.mv3.json`, `package.json`, `src/popup/popup.html`                          | Cập nhật tên (N1/N2), version (`0.10.0` / `0.9.2`), `homepage_url`, `repository`, link `Source code` trong popup về repo port; giữ attribution MPL-2.0.                                                                                                                            |
| Legal & Docs     | `README.md`, `README-edge.md`, `PRIVACY.md`, `CONTRIBUTING.md`, `NOTICE`, `CHANGELOG.md` | Hợp nhất/định hướng `README.md` thành trang chính cho Edge MV3 (gỡ badge/nội dung Firefox Android cũ, ghi rõ contributor workflow + Naming Convention), cập nhật `PRIVACY.md` bỏ tham chiếu `Mozilla account` / `about:debugging` / `src/manifest.json`, bổ sung `NOTICE` MPL-2.0. |
| Store Kit        | `docs/store/EDGE_ADDONS_LISTING.md` (hoặc `STORE.md`)                                    | Soạn sẵn mô tả ngắn/dài, giải trình quyền `<all_urls>`, `storage`, `activeTab`, `world: "MAIN"` để copy thẳng vào Microsoft Partner Center, checklist screenshot `1280x800`.                                                                                                       |
| Icons            | `src/icons/icon.svg`, `src/icons/icon-{16,32,48,128}.png`, `tools/render-icons.mjs`      | Thiết kế SVG mới theo phương án đã chọn và render bộ PNG sắc nét (kiểm tra visual cả light/dark background).                                                                                                                                                                       |
| CI & Templates   | `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `.github/ISSUE_TEMPLATE/`   | Thay `web-ext lint` (Firefox-only) bằng kiểm tra MV3 manifest + `npm run package` (tạo `.zip` + `SHA256SUMS`) + `npm run test:e2e`; bổ sung Bug Report / Feature Request template và `SECURITY.md` trỏ đúng repo.                                                                  |

---

## 5. Kiểm thử & Nghiệm thu (Stage 4)

- `npm run lint` (ESLint, Prettier, `check-privacy.mjs` sạch 100%).
- `npm test` (tất cả unit test pass).
- `npm run build` + `npm run package` $\to$ verify `dist/manifest.json` hợp lệ MV3, đủ icon `16/32/48/128`, link `popup.html` trỏ đúng repo, và cài thử gói giải nén từ `artifacts/nocturne-edge.zip` trên Microsoft Edge.
- `npm run test:e2e` pass trên Edge.
