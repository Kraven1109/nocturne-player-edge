# Plan: Mobile YouTube (`m.youtube.com`) Chapters Parity (Tier 2)

**Date:** 2026-11-01  
**Status:** Completed (Stage 5). See `docs/changelogs/2026-11-01-mobile-youtube-chapters.md`  
**Base commit:** `d6b2fdd`

---

## 1. Context & Problem Statement

In the desktop YouTube implementation, live watch data after an SPA navigation is read from `<ytd-watch-flexy>.data`.

On mobile YouTube (`m.youtube.com`):

1. `<ytd-watch-flexy>` does not exist in the DOM.
2. Mobile YouTube renders `<ytm-watch>` instead.
3. In [`chapters.main.js`](file:///DATA1/quang_dev/nocturne-player-edge/src/content/page/chapters.main.js), `flexy` is selected via `document.querySelector('ytd-watch-flexy')`, returning `null` on `m.youtube.com`.
4. While the initial video load can fall back to `ytInitialData`, any subsequent SPA navigation on mobile cannot read updated chapters because `ytInitialData` is frozen on the first video and `<ytd-watch-flexy>` is absent.

---

## 2. Empirical Verification (Edge on Pixel 7 Emulation)

Running headless Microsoft Edge with mobile viewport and Android Pixel 7 User-Agent against `https://m.youtube.com/watch?v=aircAruvnKk`:

- `document.querySelector('ytd-watch-flexy')` $\to$ `null` `[EMPIRICAL]`
- `document.querySelector('ytm-watch')` $\to$ `<ytm-watch>` `[EMPIRICAL]`
- `document.querySelector('ytm-watch').data` $\to$ `Object` with live watch data identical to desktop `[EMPIRICAL]`
- Re-probed by audit 2 across an SPA navigation: `ytm-watch.data` follows the video (id and chapters change), `ytInitialData` stays on the first id `[EMPIRICAL]`

---

## 3. Surgical Implementation Plan (Minimal Diff)

### 3.1. Update Watch Element Selector in [`chapters.main.js`](file:///DATA1/quang_dev/nocturne-player-edge/src/content/page/chapters.main.js)

Change:

```javascript
const flexy =
  typeof document === 'undefined'
    ? null
    : document.querySelector('ytd-watch-flexy');
const sources = [
  playerResponse,
  read(flexy, 'data'),
  read(scope, 'ytInitialData'),
  read(scope, 'ytInitialPlayerResponse'),
];
```

To:

```javascript
const watchElement =
  typeof document === 'undefined'
    ? null
    : document.querySelector('ytd-watch-flexy, ytm-watch');
const sources = [
  playerResponse,
  read(watchElement, 'data'),
  read(scope, 'ytInitialData'),
  read(scope, 'ytInitialPlayerResponse'),
];
```

### 3.2. Unit Tests in [`chapters.test.js`](file:///DATA1/quang_dev/nocturne-player-edge/test/unit/chapters.test.js)

Add test case verifying `readChaptersSnapshot` extracts chapters from mock `ytm-watch.data` when `ytd-watch-flexy` is absent.

### 3.3. Documentation Updates (Rule C5)

- Update `README-edge.md` acknowledging mobile YouTube chapter support.
- Add changelog record `docs/changelogs/2026-11-01-mobile-youtube-chapters.md`.
- Update `docs/plans/2026-11-01-mobile-youtube-chapters.md` to `Completed (Stage 5)`.

---

## 4. Verification & Criteria

1. `npm test`: all unit tests pass (including new mobile watch test).
2. `npm run lint`: 100% clean (ESLint + Prettier + Privacy check).
3. `npm run build`: builds 3 bundles into `dist/`.
4. Edge Playwright mobile e2e (`_scratch/verify_chapters_spa_e2e.mjs --mobile`) passes, and fails on the previous commit (control).
