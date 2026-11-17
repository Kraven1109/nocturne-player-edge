# Plan: Temporary fullscreen-on-rotate debug log

**Date:** 2026-11-17 · **Status:** implemented as a TEMPORARY diagnostic (user approved: "chắc phải thêm debug log thôi").

## Evidence driving this

`_scratch/probe_rotate_fullscreen.html` on Edge Canary Android 160 `[EMPIRICAL]`: `requestFullscreen({navigationUI:'hide'})` followed by two `screen.orientation.lock()` calls keeps `fullscreenElement` unchanged. Fullscreen is only lost in our extension, so something in the extension or the host page takes it away on rotate. Firefox (original) is unaffected.

## Change (diagnostic only, no behavior change)

- New `src/content/debuglog.js`: on-screen log box (tap "copy log"), gated by `DEBUG_FULLSCREEN`.
- `src/content/page/fullscreen.main.js`: reports each `requestFullscreen`/`exitFullscreen` call (PASS/BLOCKED, caller stack) via `nocturne:dbg` CustomEvent while the lock is on.
- `src/content/session.js`: `dbg(...)` at `exit()` (with stack), rotate lock call/result/failure, and the fullscreen-lost decision.

## Exit criteria

Remove `debuglog.js`, the `reportCall` code and all `dbg(...)` calls once the cause is found; the real fix goes in its own plan.
