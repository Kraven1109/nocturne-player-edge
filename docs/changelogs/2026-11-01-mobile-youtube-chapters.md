# Changelog: Mobile YouTube Chapters Parity

**Date:** 2026-11-01  
**Category:** fix (Tier 2)  
**Affects:** `src/content/page/chapters.main.js`, `test/unit/chapters.test.js`

---

## 1. Problem `[EMPIRICAL]` (Edge, Pixel 7 emulation, `m.youtube.com`)

The live watch data that `readChaptersSnapshot` reads after an SPA navigation lives in `<ytd-watch-flexy>` on desktop, but that element does not exist on the phone site. There it is `<ytm-watch>`, with the same shape: `data.currentVideoEndpoint.watchEndpoint.videoId` and the chapters under `data.playerOverlays`. `ytInitialData` stays frozen on the first video (probed: 36 → 15 markers on `ytm-watch.data` after a navigation, `ytInitialData` still on the first id). With only `ytd-watch-flexy` queried, the stale-id guard correctly rejected the frozen blob and the phone site got **no chapters** after any navigation.

## 2. Solution

`chapters.main.js` queries `ytd-watch-flexy, ytm-watch`. Nothing else changes: the same id guard, ad guard and source order apply.

## 3. Verification

- `npm test` (99), `npm run lint`, `npm run build`.
- Unit: chapters read from `<ytm-watch>` ahead of a stale `ytInitialData`; a phone video without chapters inherits none. The test double matches a selector list by tag name.
- `test/e2e/chapters-spa.mjs --mobile` (Edge, `m.youtube.com`, Pixel 7 emulation, Nocturne open):
  - with the change: 11 dividers on load, cleared on navigation, 4 dividers of the next video once its pre-roll ad ended;
  - control, same script on the previous commit: **0** dividers of the next video after 90 s.

## 4. Not done

- Mid-roll ads: chapters already on the bar stay while an ad plays.
- `m.youtube.com` thumbnail hover sprite: `.ytp-progress-bar` is absent on the phone site, so the canvas tier is used (see the post-audit plan).
