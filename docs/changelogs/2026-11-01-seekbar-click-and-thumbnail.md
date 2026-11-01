# Changelog: Click-to-Seek & Seekbar Thumbnail Preview

**Date:** 2026-11-01  
**Plan:** [`docs/plans/2026-11-01-seekbar-click-and-thumbnail.md`](../plans/2026-11-01-seekbar-click-and-thumbnail.md)

## Summary

1. **Click-to-Seek & Direct Track Scrubbing (`src/content/controls/seekbar.js`, `src/content/ui.js`, `src/content/player.css`):**
   - Enabled `pointer-events: auto` on `.seek-area` when player chrome is visible.
   - Clicking anywhere on `.seek-area` calculates `ratioFromPointer(event.clientX, track.getBoundingClientRect())` and jumps directly to `ratio * duration`, stopping propagation so the underlying `.surface` recognizer does not interpret the click as a screen tap that hides controls.
   - Dragging along `.seek-area` tracks pointer position directly (and transitions to vertical-distance precision scrubbing when dragging away vertically).
2. **3-Tier Seekbar Thumbnail Preview (`src/content/controls/seekbar.js`, `src/content/player.css`):**
   - Added `.seek-preview` above `.seek-track` showing a 160×90 thumbnail frame (`.seek-thumb`), chapter name (`.seek-preview-chapter`), and timestamp (`.seek-time`) on both hover (`is-hovering`) and scrub (`is-scrubbing`).
   - **Tier 1:** Offscreen muted `<video>` + `<canvas>` frame extraction with 60-entry `0.5s` bucket LRU cache for direct media URLs (`http:`, `https:`, `file:`).
   - **Tier 2:** YouTube `.ytp-progress-bar` / `.ytp-tooltip-bg` sprite DOM mirror for YouTube `blob:` MSE streams.
   - **Tier 3:** Direct `ctx.drawImage(video, ...)` fallback for buffered MSE frames.
