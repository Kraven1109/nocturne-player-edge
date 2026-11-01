# Changelog: SPA Chapters Hardening

**Date:** 2026-11-01  
**Category:** fix / hardening (P2)  
**Affects:** `src/content/page/chapters.main.js`, `src/content/ui.js`, `src/content/controls/seekbar.js`, `test/unit/chapters.test.js`

---

## 1. Problem `[EMPIRICAL]` (Edge 156, real youtube.com)

1. On a YouTube SPA navigation (Next / autoplay) the same `<video>` is reused (`emptied` → `loadstart` → `durationchange` → `loadedmetadata`, `currentSrc` changes) but the overlay kept the previous film's chapters.
2. `window.ytInitialData` / `ytInitialPlayerResponse` stay frozen on the first page loaded, so re-reading them after a navigation returns the previous video's chapters.
3. `getPlayerResponse()` names the video but contains **no** `chapterRenderer`; the chapters live in the watch data. The live copy after navigation is `document.querySelector('ytd-watch-flexy').data`.
4. `seekBar.setChapters([])` returned early and left the old dividers and chapter title on screen.

## 2. Solution

- `chapters.main.js`: `readChaptersSnapshot(host)` returns `{ videoId, isAd, chapters }`.
  - Sources, in order: `getPlayerResponse()` → `<ytd-watch-flexy>.data` → `ytInitialData` → `ytInitialPlayerResponse`. A blob naming a video id different from the playing one is skipped; a blob naming none is read as before.
  - The playing id is `getPlayerResponse().videoDetails.videoId` ?? `getVideoData().video_id` ?? the `v` parameter of the address (all three agree on youtube.com, probed).
  - While `#movie_player` has `ad-showing` (probed: the class is set, the id stays the film's, `duration` is the ad's) no chapters are returned.
- Bridge: op `chapters.list` → `chapters.snapshot`; `chaptersSnapshot(video)` rebuilds the DTO field by field. `PORT_PLAN.md` contract table updated.
- `ui.js`: what is on the bar is tied to the video id, not the source. `loadedmetadata` / `durationchange` re-arm the scan (`[0, ...CHAPTER_TRIES_MS]`; the page's data lands ~1 s after the id changes, so the retries stay). The bar is cleared only when the id changes; chapters are cached per id in the overlay, unchanged chapters are not re-applied (no blink on quality switch or ad → film). Listeners and timers are removed in `destroy()`.
- `seekbar.js`: `setChapters([])` removes the dividers and the chapter title; dividers are re-placed on `durationchange`.

## 3. Verification

- `npm test` (97), `npm run lint`, `npm run build`.
- `_scratch/verify_chapters_spa_e2e.mjs` (Edge, local fixture with the real YouTube data shapes — `getPlayerResponse` without chapters, live `ytd-watch-flexy.data`, frozen `ytInitialData`): navigation A→B→C→A, quality switch (no blink), pre-roll ad.
- `_scratch/verify_chapters_spa_e2e.mjs --live` (Edge, youtube.com, Nocturne open): 11 dividers on the first video; after an SPA navigation they clear and the next video's chapters appear once its pre-roll ad ends. The first draft of this work (return `[]` whenever `getPlayerResponse()` answered) showed 0 dividers on the same video.

## 4. Not done

- `getBoundingClientRect` caching (P3): the benchmark measured the call in isolation; the real argument is that Chromium aligns `pointermove` to frames. No change.
- `rid` randomisation (P1) and `anchor.closest()` (P4): rejected in audit, see `docs/plans/2026-11-01-post-audit-hardening.md`.
- Mid-roll ads: chapters already on the bar stay while an ad plays.
- `m.youtube.com`: handled afterwards, see `2026-11-01-mobile-youtube-chapters.md`.
